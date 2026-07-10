import { afterEach, describe, expect, it } from 'bun:test';
import { createBunTransport } from '../src/transport/bun.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('createBunTransport', () => {
  it('passes url, init, and the tls option through to fetch', async () => {
    let captured: { url: unknown; init: Record<string, unknown> } | undefined;
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      captured = { url, init: init as Record<string, unknown> };
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const transport = createBunTransport({ cert: 'CERT', key: 'KEY' });
    const response = await transport.request('https://example.invalid/x', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: '{"n":1}',
    });

    expect(response.status).toBe(200);
    expect(captured?.url).toBe('https://example.invalid/x');
    expect(captured?.init.method).toBe('POST');
    expect(captured?.init.body).toBe('{"n":1}');
    expect(captured?.init.redirect).toBe('manual');
    expect(captured?.init.tls).toEqual({ cert: 'CERT', key: 'KEY' });
  });
});
