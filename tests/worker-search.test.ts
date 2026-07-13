import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { WorkerSearch, odataEscape, planQuery } from '../src/search.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport });
  return { client, calls };
}

const person = (given: string, family: string) => ({ legalName: { givenName: given, familyName1: family } });
const w = (id: string, given = 'First', family = 'Last', statusCode?: string) => ({
  associateOID: id,
  person: person(given, family),
  ...(statusCode ? { workAssignments: [{ assignmentStatus: { statusCode: { codeValue: statusCode } } }] } : {}),
});

describe('odataEscape', () => {
  it('doubles single quotes', () => {
    expect(odataEscape("O'Brien")).toBe("O''Brien");
    expect(odataEscape('plain')).toBe('plain');
  });
});

describe('planQuery — single server predicate with precedence', () => {
  it('empty query: no server filter, residual passes everything', () => {
    const plan = planQuery({});
    expect(plan.serverFilter).toBeUndefined();
    expect(plan.residual(w('A') as never)).toBe(true);
  });

  it('familyName becomes the server predicate', () => {
    expect(planQuery({ familyName: "O'Hara" }).serverFilter).toBe(
      "workers/person/legalName/familyName1 eq 'O''Hara'",
    );
  });

  it('both names: familyName server-side, givenName residual', () => {
    const plan = planQuery({ familyName: 'Last', givenName: 'First' });
    expect(plan.serverFilter).toContain('familyName1');
    expect(plan.serverFilter).not.toContain('givenName');
    expect(plan.residual(w('A', 'First', 'Last') as never)).toBe(true);
    expect(plan.residual(w('B', 'Other', 'Last') as never)).toBe(false);
  });

  it('raw filter outranks everything; named fields all become residual', () => {
    const plan = planQuery({ filter: 'custom eq 1', familyName: 'Last', status: 'A' });
    expect(plan.serverFilter).toBe('custom eq 1');
    expect(plan.residual(w('A', 'First', 'Last', 'A') as never)).toBe(true);
    expect(plan.residual(w('B', 'First', 'Last', 'T') as never)).toBe(false); // status residual
    expect(plan.residual(w('C', 'First', 'Nope', 'A') as never)).toBe(false); // family residual
  });

  it('status alone is the server predicate', () => {
    expect(planQuery({ status: 'T' }).serverFilter).toBe(
      "workers/workAssignments/assignmentStatus/statusCode/codeValue eq 'T'",
    );
  });
});

describe('WorkerSearch.page', () => {
  it('unfiltered: URL matches the classic $top/$skip shape', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }]);
    const page = await new WorkerSearch(client, { pageSize: 2 }).page(3);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=6');
    expect(page).toEqual({ workers: [w('A')] as never, index: 3, done: false, next: 4 });
  });

  it('server filter is percent-encoded into the URL', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [] } }]);
    await new WorkerSearch(client, { familyName: 'Last' }).page(0);
    expect(calls[1].url).toBe(
      'https://api.adp.com/hr/v2/workers?$top=100&$skip=0&$filter=' +
        encodeURIComponent("workers/person/legalName/familyName1 eq 'Last'"),
    );
  });

  it('204 → done page with empty workers and null next', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    const page = await new WorkerSearch(client).page(5);
    expect(page).toEqual({ workers: [], index: 5, done: true, next: null });
  });

  it('residual filtering can empty a page WITHOUT ending the stream', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A', 'Nope', 'Last'), w('B', 'Nada', 'Last')] } },
    ]);
    const page = await new WorkerSearch(client, { familyName: 'Last', givenName: 'First' }).page(0);
    expect(page.workers).toEqual([]);
    expect(page.done).toBe(false); // loop on done, never on workers.length
    expect(page.next).toBe(1);
  });
});

describe('WorkerSearch.pages', () => {
  it('yields every page including the terminal done page, then stops', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      { status: 200, json: { workers: [w('C')] } },
      { status: 204 },
    ]);
    const seen: Array<{ n: number; done: boolean }> = [];
    for await (const page of new WorkerSearch(client, { pageSize: 2 }).pages()) {
      seen.push({ n: page.workers.length, done: page.done });
    }
    expect(seen).toEqual([{ n: 2, done: false }, { n: 1, done: false }, { n: 0, done: true }]);
    expect(calls).toHaveLength(4); // token + 3 pages
  });
});

describe('deprecated conveniences', () => {
  it('all() accumulates residual-filtered workers across pages', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A', 'First', 'Last'), w('B', 'Nope', 'Last')] } },
      { status: 204 },
    ]);
    const all = await new WorkerSearch(client, { familyName: 'Last', givenName: 'First' }).all();
    expect(all.map((x) => x.associateOID)).toEqual(['A']);
  });

  it('find() early-exits without fetching later pages', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      // nothing else queued: fetching page 1 would throw "queue empty"
    ]);
    const match = await new WorkerSearch(client).find((x) => x.associateOID === 'B');
    expect(match?.associateOID).toBe('B');
    expect(calls).toHaveLength(2);
  });
});
