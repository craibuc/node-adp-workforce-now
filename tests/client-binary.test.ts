import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { NotFoundError } from '../src/errors.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport });
  return { client, calls };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('Client.binaryRequest', () => {
  it('sends a Uint8Array body with the caller-controlled Content-Type', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { ok: 1 } }]);

    const result = await client.binaryRequest({
      method: 'POST',
      path: '/events/hr/v1/worker.photo.upload',
      body: JPEG,
      contentType: 'multipart/form-data; boundary=xyz',
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: 1 });
    expect(calls[1].headers['Content-Type']).toBe('multipart/form-data; boundary=xyz');
    expect(calls[1].body).toBe(JPEG);
  });

  it('returns response bytes when bytesResponse is set', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } },
    ]);

    const result = await client.binaryRequest({
      method: 'GET',
      path: '/hr/v2/workers/AAA/worker-images/photo',
      bytesResponse: true,
    });

    expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(result.bytes).toEqual(JPEG);
    expect(result.body).toBeUndefined();
  });

  it('keeps the single 401 force-refresh retry', async () => {
    const FRESH = { status: 200, json: { access_token: 'tok-2', token_type: 'Bearer', expires_in: 3600, scope: 'api' } };
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 401, json: {} },
      FRESH,
      { status: 200, bytes: JPEG },
    ]);

    const result = await client.binaryRequest({ method: 'GET', path: '/x', bytesResponse: true });

    expect(result.bytes).toEqual(JPEG);
    expect(calls).toHaveLength(4);
    expect(calls[3].headers.Authorization).toBe('Bearer tok-2');
  });

  it('throws typed errors on non-2xx (parsed as text/JSON even in bytes mode)', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 404, json: {} }]);
    const error = await client
      .binaryRequest({ method: 'GET', path: '/hr/v2/workers/AAA/worker-images/photo', bytesResponse: true })
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it('204: status/headers real, no body, no bytes', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    const result = await client.binaryRequest({ method: 'GET', path: '/x', bytesResponse: true });
    expect(result.status).toBe(204);
    expect(result.bytes).toBeUndefined();
    expect(result.body).toBeUndefined();
  });
});
