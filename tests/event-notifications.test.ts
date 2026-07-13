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

const ENVELOPE = { events: [{ eventNameCode: { codeValue: 'worker.hire' } }] };

describe('eventNotifications.next', () => {
  it('returns { messageId, payload } from the head of the queue', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: ENVELOPE, headers: { 'adp-msg-msgid': 'MSG-1' } },
    ]);

    const message = await client.eventNotifications.next();

    expect(message).toEqual({ messageId: 'MSG-1', payload: ENVELOPE });
    expect(calls[1].method).toBe('GET');
    expect(calls[1].url).toBe('https://api.adp.com/core/v1/event-notification-messages');
  });

  it('returns null (not undefined) when the queue is empty (204)', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    const message = await client.eventNotifications.next();
    expect(message).toBeNull();
  });

  it('throws loudly when the delete handle header is missing', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 200, json: ENVELOPE }]);
    await expect(client.eventNotifications.next()).rejects.toThrow(/adp-msg-msgid/);
  });
});

describe('eventNotifications.delete', () => {
  it('DELETEs by percent-encoded id and returns the echoed record', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { deleted: true } },
    ]);

    const echoed = await client.eventNotifications.delete('MSG/1=');

    expect(echoed).toEqual({ deleted: true });
    expect(calls[1].method).toBe('DELETE');
    expect(calls[1].url).toBe('https://api.adp.com/core/v1/event-notification-messages/MSG%2F1%3D');
  });

  it('returns null when ADP replies without a body', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.eventNotifications.delete('MSG-1')).toBeNull();
  });
});
