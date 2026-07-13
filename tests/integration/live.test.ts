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
});
