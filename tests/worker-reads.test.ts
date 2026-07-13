import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { WorkerSearch } from '../src/search.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

/** validateEvents off: get({ssn}) wire-format tests want the POST at calls[1]. */
function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, validateEvents: false });
  return { client, calls };
}

const WORKER = { associateOID: 'G0FAKEFAKEFAKE1A' };

const READ_HIT = {
  status: 200,
  json: { events: [{ data: { output: { workers: [WORKER] } } }] },
};

describe('worker.get by aoid', () => {
  it('accepts the string shorthand', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [WORKER] } }]);
    expect(await client.worker.get('G0FAKEFAKEFAKE1A')).toEqual(WORKER);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/G0FAKEFAKEFAKE1A');
    expect(calls[1].method).toBe('GET');
  });

  it('accepts { aoid } and percent-encodes it', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [WORKER] } }]);
    await client.worker.get({ aoid: 'A/B' });
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/A%2FB');
  });

  it('returns undefined on 204', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.worker.get('G0FAKEFAKEFAKE1A')).toBeUndefined();
  });
});

describe('worker.get by ssn (worker.read event)', () => {
  it('POSTs the recorded worker.read envelope', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, READ_HIT]);

    const found = await client.worker.get({ ssn: '123-45-6789' });

    expect(found).toEqual(WORKER);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.read');
    const event = JSON.parse(calls[1].body!).events[0];
    expect(event.serviceCategoryCode).toEqual({ codeValue: 'hr' });
    expect(event.eventNameCode).toEqual({ codeValue: 'worker.read' });
    expect(event.data.transform.queryParameter).toBe(
      "$filter=person/governmentIDs[0]/idValue eq '123-45-6789' and person/governmentIDs[0]/nameCode eq 'SSN'",
    );
  });

  it('doubles single quotes in the ssn value', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, READ_HIT]);
    await client.worker.get({ ssn: "12'3" });
    expect(JSON.parse(calls[1].body!).events[0].data.transform.queryParameter).toContain("eq '12''3'");
  });

  it('returns undefined when the output has no workers', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { events: [{ data: { output: { workers: [] } } }] } },
    ]);
    expect(await client.worker.get({ ssn: '000-00-0000' })).toBeUndefined();
  });
});

describe('worker.get input validation', () => {
  it('rejects null with a clear error', async () => {
    const { client } = makeClient([TOKEN_RESPONSE]);
    await expect(client.worker.get(null as never)).rejects.toThrow(/requires an aoid/);
  });

  it('rejects { ssn: undefined } with a clear error', async () => {
    const { client } = makeClient([TOKEN_RESPONSE]);
    await expect(client.worker.get({ ssn: undefined as never })).rejects.toThrow(/non-empty ssn/);
  });

  it('rejects {} (neither aoid nor valid ssn) with a clear error', async () => {
    const { client } = makeClient([TOKEN_RESPONSE]);
    await expect(client.worker.get({} as never)).rejects.toThrow(/requires an aoid/);
  });
});

describe('worker.search', () => {
  it('returns a lazy WorkerSearch handle without fetching', async () => {
    const { client, calls } = makeClient([]);
    const handle = client.worker.search({ familyName: 'Last' });
    expect(handle).toBeInstanceOf(WorkerSearch);
    expect(calls).toHaveLength(0); // nothing fetched until a method is called
  });

  it('forwards the familyName query as a single server-side $filter', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    await client.worker.search({ familyName: 'Last', pageSize: 5 }).page(0);
    expect(calls[1].url).toBe(
      'https://api.adp.com/hr/v2/workers?$top=5&$skip=0&$filter=' +
        encodeURIComponent("workers/person/legalName/familyName1 eq 'Last'"),
    );
  });
});

describe('worker.get({ssn}) with validation on', () => {
  it('lets the POST through despite the overdeclared readOnly/hidden queryParameter rule', async () => {
    const metaResponse = {
      status: 200,
      json: {
        meta: {
          '/data/transforms': [{ '/queryParameter': { optional: false, readOnly: true, hidden: true } }],
        },
      },
    };
    const { transport, calls } = makeFakeTransport([TOKEN_RESPONSE, metaResponse, READ_HIT]);
    // No `validateEvents: false` here — this pins behavior under the DEFAULT
    // (on) validated pipeline, unlike the wire-format tests above which use
    // makeClient()'s validateEvents:false shortcut.
    const client = new Client(PEM, PEM, { credentials: CREDS, transport });

    const found = await client.worker.get({ ssn: '123-45-6789' });

    expect(found).toEqual(WORKER);
    expect(calls[1].url.endsWith('/events/hr/v1/worker.read/meta')).toBe(true);
    expect(calls[2].method).toBe('POST');
  });
});

describe('removed 2.x surface', () => {
  it('one/page/pages/all/find/hireMeta are gone from Worker', () => {
    const { client } = makeClient([]);
    for (const name of ['one', 'page', 'pages', 'all', 'find', 'hireMeta']) {
      expect((client.worker as unknown as Record<string, unknown>)[name]).toBeUndefined();
    }
  });
});
