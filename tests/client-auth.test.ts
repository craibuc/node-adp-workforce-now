import { describe, expect, it } from 'bun:test';
import { Client, normalizePem } from '../src/client.js';
import { MemoryTokenStore } from '../src/token-store/memory.js';
import { UnauthorizedError } from '../src/errors.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(responses: Parameters<typeof makeFakeTransport>[0], store = new MemoryTokenStore()) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, tokenStore: store, transport });
  return { client, calls, store };
}

describe('normalizePem', () => {
  it('passes raw PEM through unchanged', () => {
    expect(normalizePem(PEM)).toBe(PEM);
  });

  it('decodes base64-encoded PEM', () => {
    const encoded = Buffer.from(PEM, 'utf8').toString('base64');
    expect(normalizePem(encoded)).toBe(PEM);
  });
});

describe('Client token lifecycle', () => {
  it('lazily authenticates on first request and reuses the cached token', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { ok: 1 } },
      { status: 200, json: { ok: 2 } },
    ]);

    await client.get('/hr/v2/workers/AAA');
    await client.get('/hr/v2/workers/BBB');

    expect(calls).toHaveLength(3); // one token call, two GETs — no re-auth
    expect(calls[0].url).toBe('https://accounts.adp.com/auth/oauth/v2/token');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(calls[0].body);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('id-1');
    expect(params.get('client_secret')).toBe('secret-1');
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
    expect(calls[2].headers.Authorization).toBe('Bearer tok-1');
  });

  it('writes the token back to the store with epoch-seconds expiry', async () => {
    const { client, store } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);
    const before = Math.floor(Date.now() / 1000);

    await client.get('/x');

    const cached = await store.get();
    expect(cached?.access_token).toBe('tok-1');
    expect(cached?.expires_at).toBeGreaterThanOrEqual(before + 3600);
    expect(cached?.expires_at).toBeLessThanOrEqual(before + 3610);
  });

  it('uses a stored token that is still valid past the 300 s margin', async () => {
    const store = new MemoryTokenStore();
    await store.set({ access_token: 'stored', expires_at: Math.floor(Date.now() / 1000) + 1000 });
    const { client, calls } = makeClient([{ status: 200, json: {} }], store);

    await client.get('/x');

    expect(calls).toHaveLength(1); // no token call
    expect(calls[0].headers.Authorization).toBe('Bearer stored');
  });

  it('re-authenticates when the stored token is inside the 300 s margin', async () => {
    const store = new MemoryTokenStore();
    await store.set({ access_token: 'stale', expires_at: Math.floor(Date.now() / 1000) + 100 });
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }], store);

    await client.get('/x');

    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
  });

  it('throws UnauthorizedError with the OAuth description on bad credentials', async () => {
    const { client } = makeClient([
      { status: 401, json: { error: 'invalid_client', error_description: 'The given client credentials were not valid' } },
    ]);

    await expect(client.get('/x')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws a clear error when no credentials and no valid token exist', async () => {
    const { transport } = makeFakeTransport([]);
    const client = new Client(PEM, PEM, { transport });
    await expect(client.get('/x')).rejects.toThrow(/credentials/);
  });

  it('authenticate() can be called explicitly', async () => {
    const { client } = makeClient([TOKEN_RESPONSE]);
    const token = await client.authenticate();
    expect(token.access_token).toBe('tok-1');
  });
});
