// Drain ADP's event-notification queue: next() returns the head of the
// queue — the SAME message until it is deleted — and delete(messageId)
// acknowledges it, advancing to the next message. This loops until the
// queue is empty (next() returns null) or maxMessages is reached, which is
// the production drain pattern for a polling flow step. See the README's
// "Event notifications" section.
//
// Replace the `messages.push(message)` line with your real per-message
// handling; only delete() after that handling succeeds, for at-least-once
// semantics.

import { Client } from '@craibuc/adp-workforce-now';
import { WindmillTokenStore } from '@craibuc/adp-workforce-now/windmill';
import type { EventNotificationMessage } from '@craibuc/adp-workforce-now';

type CAdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
  // Windmill variable path for the shared token cache, e.g. "f/adp/access_token_cache".
  token_cache_path: string;
};

export async function main(
  adp: CAdpCredentials,
  // Safety cap on messages drained in a single run.
  maxMessages = 50,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    tokenStore: new WindmillTokenStore(adp.token_cache_path),
  });

  const messages: EventNotificationMessage[] = [];

  for (let i = 0; i < maxMessages; i++) {
    const message = await client.eventNotifications.next();
    if (message === null) break; // queue empty

    // --- your real handling logic goes here ---
    messages.push(message);

    await client.eventNotifications.delete(message.messageId); // ack -> advances queue
  }

  return { drained: messages.length, queueEmptied: messages.length < maxMessages, messages };
}
