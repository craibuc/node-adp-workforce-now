import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport });
  return { client, calls };
}

const w = (id: string) => ({ associateOID: id });

describe('worker.one', () => {
  it('returns the first worker from the response', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('AAA')] } }]);
    const worker = await client.worker.one('AAA');
    expect(worker).toEqual(w('AAA'));
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/AAA');
  });

  it('returns undefined on 204', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.worker.one('AAA')).toBeUndefined();
  });

  it('percent-encodes an aoid containing a slash', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A/B')] } }]);
    await client.worker.one('A/B');
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/A%2FB');
  });
});

describe('worker.page', () => {
  it('fetches a single page by index with $top/$skip', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('E'), w('F')] } }]);

    const workers = await client.worker.page(2, 2);

    expect(workers).toEqual([w('E'), w('F')]);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=4');
  });

  it('returns undefined past the end (204)', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.worker.page(50, 100)).toBeUndefined();
  });

  it('defaults pageSize to 100', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }]);
    await client.worker.page(0);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers?$top=100&$skip=0');
  });
});

describe('worker.pages / worker.all', () => {
  it('walks $top/$skip pages until 204 and accumulates', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      { status: 200, json: { workers: [w('C')] } },
      { status: 204 },
    ]);

    const all = await client.worker.all(2);

    expect(all.map((x) => x.associateOID)).toEqual(['A', 'B', 'C']);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=0');
    expect(calls[2].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=2');
    expect(calls[3].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=4');
  });

  it('yields pages lazily', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }]);
    const iterator = client.worker.pages(1);
    const first = await iterator.next();
    expect(first.value).toEqual([w('A')]);
    expect(calls).toHaveLength(2); // token + one page; no eager second fetch
  });
});

describe('worker.find', () => {
  it('returns the first match without fetching later pages', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      // no more responses queued: fetching page 2 would throw "queue empty"
    ]);

    const match = await client.worker.find((worker) => worker.associateOID === 'B', 2);

    expect(match).toEqual(w('B'));
    expect(calls).toHaveLength(2);
  });

  it('returns undefined when nothing matches', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }, { status: 204 }]);
    expect(await client.worker.find(() => false, 1)).toBeUndefined();
  });
});
