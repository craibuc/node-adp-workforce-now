import type { AdpTransport, TransportInit, TransportTls } from './types.js';

export function createBunTransport(tls: TransportTls): AdpTransport {
  return {
    request(url: string, init: TransportInit): Promise<Response> {
      // Redirects are returned as-is to match Node adapter semantics.
      return fetch(url, { ...init, redirect: 'manual', tls } as unknown as RequestInit);
    },
  };
}
