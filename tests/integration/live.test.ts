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
});
