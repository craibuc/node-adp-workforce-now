import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';
import syntheticRehireMeta from './fixtures/meta/synthetic.worker.rehire.json';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(
  responses: Parameters<typeof makeFakeTransport>[0],
  options: ConstructorParameters<typeof Client>[2] = {},
) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, ...options });
  return { client, calls };
}

describe('worker.eventMeta', () => {
  it('fetches, parses, and caches the meta', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: syntheticRehireMeta }]);

    const first = await client.worker.eventMeta('worker.rehire');
    const second = await client.worker.eventMeta('worker.rehire');

    expect(calls).toHaveLength(2); // token + ONE meta GET
    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.rehire/meta');
    expect(first.rules.get('transform:/effectiveDateTime')).toEqual({ optional: false });
    expect(second).toBe(first); // cache hit returns the same object
  });

  it('refetches when the TTL has expired', async () => {
    const { client, calls } = makeClient(
      [TOKEN_RESPONSE, { status: 200, json: syntheticRehireMeta }, { status: 200, json: syntheticRehireMeta }],
      { metaCacheTtlMs: 0 },
    );

    await client.worker.eventMeta('worker.rehire');
    await client.worker.eventMeta('worker.rehire');

    expect(calls).toHaveLength(3); // token + two meta GETs
  });

  it('forceRefresh bypasses a fresh cache', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta },
      { status: 200, json: syntheticRehireMeta },
    ]);

    await client.worker.eventMeta('worker.rehire');
    await client.worker.eventMeta('worker.rehire', { forceRefresh: true });

    expect(calls).toHaveLength(3);
  });

  it('caches per event name', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta },
      { status: 200, json: syntheticRehireMeta },
    ]);

    await client.worker.eventMeta('worker.rehire');
    await client.worker.eventMeta('worker.hire');

    expect(calls).toHaveLength(3);
    expect(calls[2].url).toBe('https://api.adp.com/events/hr/v1/worker.hire/meta');
  });
});

describe('worker.hireMeta (deprecated)', () => {
  it('still returns the raw meta body', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 200, json: syntheticRehireMeta }]);
    const raw = await client.worker.hireMeta();
    expect(raw).toEqual(syntheticRehireMeta);
  });
});
