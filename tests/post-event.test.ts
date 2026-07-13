import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { BadRequestError } from '../src/errors.js';
import { EventValidationError } from '../src/meta.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';
import syntheticRehireMeta from './fixtures/meta/synthetic.worker.rehire.json';
import rehireAlreadyActive from './fixtures/worker.rehire/400.already-active.json';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

/** Meta variant whose codeList no longer allows IMPORT (simulates a tenant table edit). */
const META_WITHOUT_IMPORT = JSON.parse(
  JSON.stringify(syntheticRehireMeta).replaceAll('"IMPORT"', '"OTHER"'),
);

function makeClient(
  responses: Parameters<typeof makeFakeTransport>[0],
  options: ConstructorParameters<typeof Client>[2] = {},
) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, ...options });
  return { client, calls };
}

const REHIRE = { associateOID: 'G0FAKEFAKEFAKE2B', rehireDate: '2026-08-01', effectiveDate: '2026-08-01' };

describe('postEvent pipeline', () => {
  it('validates against cached meta then POSTs', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta }, // meta GET
      { status: 200, json: { events: [] } },      // event POST
    ]);

    await client.worker.rehire(REHIRE);

    expect(calls).toHaveLength(3);
    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.rehire/meta');
    expect(calls[2].method).toBe('POST');
    expect(calls[2].url).toBe('https://api.adp.com/events/hr/v1/worker.rehire');
  });

  it('throws EventValidationError WITHOUT posting when validation fails', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta },
      // no POST response queued: posting would throw "queue empty"
    ]);

    const error = await client.worker.rehire({ ...REHIRE, reasonCode: 'BOGUS' }).catch((e) => e);

    expect(error).toBeInstanceOf(EventValidationError);
    expect(error.issues[0].code).toBe('codeList');
    expect(calls).toHaveLength(2); // token + meta only — no POST
  });

  it('self-heal: 400 + refreshed meta that now rejects -> EventValidationError, no re-POST', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta },   // initial meta: IMPORT allowed
      { status: 400, json: rehireAlreadyActive },   // ADP rejects anyway
      { status: 200, json: META_WITHOUT_IMPORT },   // refreshed meta: IMPORT gone (stale cache!)
    ]);

    const error = await client.worker.rehire(REHIRE).catch((e) => e);

    expect(error).toBeInstanceOf(EventValidationError);
    expect(calls).toHaveLength(4); // token, meta, POST, meta refresh — never a second POST
    expect(error.cause).toBeInstanceOf(BadRequestError);
    expect(error.cause.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
  });

  it('self-heal: 400 + refreshed meta that still accepts -> original BadRequestError rethrown', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta },
      { status: 400, json: rehireAlreadyActive },
      { status: 200, json: syntheticRehireMeta }, // refreshed meta unchanged
    ]);

    const error = await client.worker.rehire(REHIRE).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
    expect(calls).toHaveLength(4);
  });

  it('validateEvents: false restores 2.0 behavior — no meta traffic at all', async () => {
    const { client, calls } = makeClient(
      [TOKEN_RESPONSE, { status: 200, json: { events: [] } }],
      { validateEvents: false },
    );

    await client.worker.rehire(REHIRE);

    expect(calls).toHaveLength(2); // token + POST only
  });

  it('is public and accepts unwrapped worker.* events', async () => {
    const { client, calls } = makeClient(
      [TOKEN_RESPONSE, { status: 200, json: { events: [] } }],
      { validateEvents: false },
    );

    await client.worker.postEvent('worker.work-assignment.modify', { events: [] });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.work-assignment.modify');
  });

  it('self-heal: meta refresh 500 does not mask original 400', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: syntheticRehireMeta },   // initial meta: IMPORT allowed
      { status: 400, json: rehireAlreadyActive },   // ADP rejects
      { status: 500, json: {} },                     // meta refresh fails with 500
    ]);

    const error = await client.worker.rehire(REHIRE).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
    expect(calls).toHaveLength(4); // token, meta, POST, meta refresh — no re-POST
  });

  it('meta endpoint failure falls back to unvalidated POST (fail-open)', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 500, json: {} },                  // meta GET errors (live finding: some tenants 500 here)
      { status: 200, json: { events: [] } },      // POST proceeds unvalidated
    ]);

    await client.worker.rehire(REHIRE);

    expect(calls).toHaveLength(3);
    expect(calls[2].method).toBe('POST');
  });

  it('negative meta cache: a second call within the TTL skips the meta fetch entirely', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 500, json: {} },                  // meta GET errors on the first call
      { status: 200, json: { events: [] } },      // first POST proceeds unvalidated
      { status: 200, json: { events: [] } },      // second POST — no meta GET in between
    ]);

    await client.worker.rehire(REHIRE);
    await client.worker.rehire(REHIRE);

    expect(calls).toHaveLength(4); // token, meta(500), POST, POST — no second meta GET
    expect(calls[2].method).toBe('POST');
    expect(calls[3].method).toBe('POST');
  });
});
