import type { AdpTransport, TransportInit } from '../../src/transport/types.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

export interface CannedResponse {
  status: number;
  json?: unknown;
  text?: string;
  /** Binary response body; wins over json/text when set. */
  bytes?: Uint8Array;
  /** Extra response headers merged over the default content-type. */
  headers?: Record<string, string>;
}

export function makeFakeTransport(responses: CannedResponse[]) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const transport: AdpTransport = {
    async request(url: string, init: TransportInit): Promise<Response> {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const next = queue.shift();
      if (!next) throw new Error(`fake transport queue empty (call #${calls.length}: ${init.method} ${url})`);
      const body =
        next.status === 204 ? null : next.bytes ?? (next.text !== undefined ? next.text : JSON.stringify(next.json ?? null));
      return new Response(body, {
        status: next.status,
        headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
      });
    },
  };
  return { transport, calls };
}

export const TOKEN_RESPONSE: CannedResponse = {
  status: 200,
  json: { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600, scope: 'api' },
};
