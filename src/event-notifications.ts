import type { Client } from './client.js';

export interface EventNotificationMessage {
  /** Delete handle from the adp-msg-msgid response header. */
  messageId: string;
  /** ADP's response body, untouched (typically an event envelope). */
  payload: unknown;
}

const QUEUE_PATH = '/core/v1/event-notification-messages';

/**
 * ADP's event-notification queue. It serves ONE message at a time: next()
 * returns the head of the queue — the SAME message until it is deleted —
 * and delete(messageId) acknowledges it, making the next one available.
 * Delete after successful processing for at-least-once semantics.
 *
 * Empty values are `null`, not `undefined` (unlike the rest of the
 * library): flow-step results are JSON-serialized, and null survives the
 * round trip while undefined vanishes.
 */
export class EventNotifications {
  constructor(private readonly client: Client) {}

  /** Head of the queue, or null when the queue is empty. */
  async next(): Promise<EventNotificationMessage | null> {
    const { status, headers, body } = await this.client.raw('GET', QUEUE_PATH);
    if (status === 204) return null;
    const messageId = headers.get('adp-msg-msgid');
    if (!messageId) {
      // A message that cannot be acknowledged would silently jam the queue.
      throw new Error('event-notification response is missing the adp-msg-msgid header');
    }
    return { messageId, payload: body };
  }

  /** Acknowledge (delete) a message. ADP echoes the deleted record on 200; null otherwise. */
  async delete(messageId: string): Promise<unknown> {
    const { body } = await this.client.raw('DELETE', `${QUEUE_PATH}/${encodeURIComponent(messageId)}`);
    return body ?? null;
  }
}
