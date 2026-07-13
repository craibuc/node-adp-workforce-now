import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { MemoryTokenStore } from '../src/token-store/memory.js';
import { BadRequestError, UnauthorizedError } from '../src/errors.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';
import rehireAlreadyActive from './fixtures/worker.rehire/400.already-active.json';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(
  responses: Parameters<typeof makeFakeTransport>[0],
  options: ConstructorParameters<typeof Client>[2] = {},
) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, {
    credentials: CREDS,
    tokenStore: new MemoryTokenStore(),
    transport,
    ...options,
  });
  return { client, calls };
}

const FRESH_TOKEN = {
  status: 200,
  json: { access_token: 'tok-2', token_type: 'Bearer', expires_in: 3600, scope: 'api' },
};

describe('Client.request semantics', () => {
  it('retries exactly once with a fresh token on 401', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 401, json: {} },
      FRESH_TOKEN,
      { status: 200, json: { ok: true } },
    ]);

    const result = await client.get('/hr/v2/workers/AAA');

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
    expect(calls[3].headers.Authorization).toBe('Bearer tok-2');
  });

  it('throws UnauthorizedError when the retry also 401s', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 401, json: {} },
      FRESH_TOKEN,
      { status: 401, json: {} },
    ]);

    await expect(client.get('/x')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls).toHaveLength(4); // no second retry
  });

  it('returns undefined for 204 responses', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.get('/hr/v2/workers?$top=100&$skip=500')).toBeUndefined();
  });

  it('sends masked Accept header by default', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);
    await client.get('/x');
    expect(calls[1].headers.Accept).toBe('application/json');
  });

  it('sends masked=false only when explicitly requested', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }], { masked: false });
    await client.get('/x');
    expect(calls[1].headers.Accept).toBe('application/json;masked=false');
  });

  it('maps ADP 400 bodies through raiseForAdp with endpoint context', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 400, json: rehireAlreadyActive }]);

    const error = await client.post('/events/hr/v1/worker.rehire', {}).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
    expect(error.endpoint).toBe('POST /events/hr/v1/worker.rehire');
  });

  it('serializes multi-byte UTF-8 bodies intact and sets no manual Content-Length', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);

    await client.post('/events/hr/v1/worker.hire', { givenName: 'Renée' });

    expect(JSON.parse(calls[1].body!).givenName).toBe('Renée');
    expect(Object.keys(calls[1].headers).map((h) => h.toLowerCase())).not.toContain('content-length');
  });
});

describe('Client.raw', () => {
  it('returns status, headers, and parsed body', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { hello: 1 }, headers: { 'adp-msg-msgid': 'MSG-1' } },
    ]);

    const result = await client.raw('GET', '/core/v1/event-notification-messages');

    expect(result.status).toBe(200);
    expect(result.headers.get('adp-msg-msgid')).toBe('MSG-1');
    expect(result.body).toEqual({ hello: 1 });
    expect(calls[1].method).toBe('GET');
  });

  it('keeps status and headers on 204 (body undefined)', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204, headers: { 'x-probe': 'yes' } }]);

    const result = await client.raw('GET', '/core/v1/event-notification-messages');

    expect(result.status).toBe(204);
    expect(result.headers.get('x-probe')).toBe('yes');
    expect(result.body).toBeUndefined();
  });

  it('throws typed errors on non-2xx like request()', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 400, json: rehireAlreadyActive }]);
    const error = await client.raw('POST', '/events/hr/v1/worker.rehire', {}).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
  });

  it('performs the single 401 force-refresh retry', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 401, json: {} },
      FRESH_TOKEN,
      { status: 200, json: { ok: true }, headers: { 'adp-msg-msgid': 'MSG-2' } },
    ]);

    const result = await client.raw('GET', '/x');

    expect(result.headers.get('adp-msg-msgid')).toBe('MSG-2');
    expect(calls).toHaveLength(4);
    expect(calls[3].headers.Authorization).toBe('Bearer tok-2');
  });
});
