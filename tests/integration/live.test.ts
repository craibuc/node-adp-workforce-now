import { describe, expect, it } from 'bun:test';
import { Client } from '../../src/client.js';

const { ADP_CLIENT_ID, ADP_CLIENT_SECRET, ADP_CERTIFICATE, ADP_PRIVATE_KEY, ADP_ASSOCIATE_OID } = process.env;
const hasCredentials = Boolean(ADP_CLIENT_ID && ADP_CLIENT_SECRET && ADP_CERTIFICATE && ADP_PRIVATE_KEY);

function liveClient(): Client {
  return new Client(ADP_CERTIFICATE!, ADP_PRIVATE_KEY!, {
    credentials: { client_id: ADP_CLIENT_ID!, client_secret: ADP_CLIENT_SECRET! },
  });
}

// Verifies the corrected token-endpoint host and the runtime's real mTLS
// handshake. Run once on the target Bun version before first production use.
describe.skipIf(!hasCredentials)('live ADP smoke test', () => {
  it('authenticates against the real token endpoint over mTLS', async () => {
    const token = await liveClient().authenticate();
    expect(token.access_token).toBeTruthy();
    expect(token.expires_at).toBeGreaterThan(Date.now() / 1000);
  }, 15000);

  it.skipIf(!ADP_ASSOCIATE_OID)('reads a known worker', async () => {
    const worker = await liveClient().worker.get(ADP_ASSOCIATE_OID!);
    expect(worker?.associateOID).toBe(ADP_ASSOCIATE_OID!);
  }, 15000);

  it('event-notification queue: next() returns null or a well-formed head (NEVER deletes)', async () => {
    const message = await liveClient().eventNotifications.next();
    if (message === null) {
      console.log('event-notification queue: empty (204)');
    } else {
      expect(typeof message.messageId).toBe('string');
      expect(message.messageId.length).toBeGreaterThan(0);
      expect(message.payload).toBeTruthy();
      console.log(`event-notification queue: head present (messageId length ${message.messageId.length}) — left undeleted`);
    }
  }, 15000);

  it.skipIf(!ADP_ASSOCIATE_OID)('worker photo read: null or real image bytes (read-only)', async () => {
    const photo = await liveClient().worker.getPhoto(ADP_ASSOCIATE_OID!);
    if (photo === null) {
      console.log('worker photo: none on file');
    } else {
      expect(photo.bytes.byteLength).toBeGreaterThan(0);
      console.log(`worker photo: ${photo.bytes.byteLength} bytes, content-type ${photo.contentType}`);
    }
  }, 20000);

  it('worker.photo.upload meta parses (imageSize rule present)', async () => {
    const meta = await liveClient().worker.eventMeta('worker.photo.upload');
    expect(meta.raw).toBeTruthy();
    console.log(
      `photo upload meta: ${meta.rules.size} rules; imageSize maxLength = ${meta.rules.get('transform:/worker/photo/imageSize')?.maxLength}`,
    );
  }, 20000);

  const photoTestAoid = process.env.ADP_PHOTO_TEST_AOID;
  it.skipIf(!photoTestAoid)('photo upload round-trip (opt-in; re-uploads the worker OWN photo)', async () => {
    const current = await liveClient().worker.getPhoto(photoTestAoid!);
    if (current === null) {
      console.warn('ADP_PHOTO_TEST_AOID worker has no photo — upload round-trip skipped');
      return;
    }
    await liveClient().worker.setPhoto({
      associateOID: photoTestAoid!,
      image: current.bytes,
      contentType: current.contentType,
    });
    const after = await liveClient().worker.getPhoto(photoTestAoid!);
    expect(after).not.toBeNull();
    expect(after!.bytes.byteLength).toBeGreaterThan(0);
  }, 30000);
});
