import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(
  responses: Parameters<typeof makeFakeTransport>[0],
  options?: Partial<Parameters<typeof Client>[2]>,
) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, ...options, transport });
  return { client, calls };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** Synthetic upload meta with a small imageSize limit (mirrors the live rule shape). */
const PHOTO_META = (limit: number) => ({
  status: 200,
  json: { meta: { '/data/transforms': [{ '/worker/photo/imageSize': { optional: false, maxLength: limit } }] } },
});

describe('worker.getPhoto', () => {
  it('returns contentType + bytes', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } },
    ]);

    const photo = await client.worker.getPhoto('G0FAKEFAKEFAKE1A');

    expect(photo).toEqual({ contentType: 'image/jpeg', bytes: JPEG });
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/G0FAKEFAKEFAKE1A/worker-images/photo');
  });

  it('percent-encodes the aoid', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    await client.worker.getPhoto('A/B');
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/A%2FB/worker-images/photo');
  });

  it('returns null on 204 and on 404', async () => {
    const a = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await a.client.worker.getPhoto('X')).toBeNull();

    const b = makeClient([TOKEN_RESPONSE, { status: 404, json: {} }]);
    expect(await b.client.worker.getPhoto('X')).toBeNull();
  });

  it('non-404 errors still throw', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 403, json: {} }]);
    await expect(client.worker.getPhoto('X')).rejects.toThrow();
  });
});

describe('worker.setPhoto', () => {
  it('uploads multipart with the recorded envelope and sniffed content type', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      PHOTO_META(200000),
      { status: 200, json: { uploaded: true } },
    ]);

    const result = await client.worker.setPhoto({ associateOID: 'G0FAKEFAKEFAKE1A', image: JPEG });

    expect(result).toEqual({ uploaded: true });
    expect(calls[1].url).toContain('/events/hr/v1/worker.photo.upload/meta'); // preflight meta
    expect(calls[2].url).toBe('https://api.adp.com/events/hr/v1/worker.photo.upload');
    expect(calls[2].headers['Content-Type']).toStartWith('multipart/form-data; boundary=');

    const text = new TextDecoder('latin1').decode(calls[2].body as Uint8Array);
    expect(text).toContain('name="json"');
    expect(text).toContain(
      '{"events":[{"data":{"eventContext":{"worker":{"associateOID":"G0FAKEFAKEFAKE1A"}}}}]}',
    );
    expect(text).toContain('name="datafile"; filename="photo.jpg"');
    expect(text).toContain('Content-Type: image/jpeg');
  });

  it('accepts base64 image input and honors contentType/filename overrides', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      PHOTO_META(200000),
      { status: 200, json: {} },
    ]);

    await client.worker.setPhoto({
      associateOID: 'X',
      image: Buffer.from(JPEG).toString('base64'),
      contentType: 'image/png',
      filename: 'me.png',
    });

    const text = new TextDecoder('latin1').decode(calls[2].body as Uint8Array);
    expect(text).toContain('filename="me.png"');
    expect(text).toContain('Content-Type: image/png');
  });

  it('preflight: oversized image throws with both numbers, NO upload request', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      PHOTO_META(4), // limit smaller than JPEG.byteLength (7)
      // nothing else queued: an upload attempt would throw "queue empty"
    ]);

    const error = await client.worker.setPhoto({ associateOID: 'X', image: JPEG }).catch((e) => e);

    expect(error.message).toContain('7 bytes');
    expect(error.message).toContain('4');
    expect(error.message).toContain('resize');
    expect(calls).toHaveLength(2); // token + meta only
  });

  it('preflight fails open when the meta endpoint is unavailable', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 500, json: {} }, // meta fetch fails
      { status: 200, json: { uploaded: true } },
    ]);

    const result = await client.worker.setPhoto({ associateOID: 'X', image: JPEG });

    expect(result).toEqual({ uploaded: true });
    expect(calls).toHaveLength(3);
  });

  it('validateEvents: false skips preflight entirely, uploading oversized image without meta GET', async () => {
    const { client, calls } = makeClient(
      [
        TOKEN_RESPONSE,
        { status: 200, json: { uploaded: true } },
      ],
      { validateEvents: false },
    );

    const result = await client.worker.setPhoto({ associateOID: 'X', image: JPEG });

    expect(result).toEqual({ uploaded: true });
    expect(calls).toHaveLength(2); // token + upload only, NO meta GET
    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.photo.upload');
  });
});
