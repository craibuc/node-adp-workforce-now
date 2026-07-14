import { request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { AdpTransport, TransportInit, TransportTls } from './types.js';

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  return headers;
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export function createNodeTransport(tls: TransportTls): AdpTransport {
  return {
    request(url: string, init: TransportInit): Promise<Response> {
      return new Promise((resolve, reject) => {
        // Without Content-Length, node:https sends the body chunked — which
        // ADP's token endpoint rejects (it sees an empty body). Byte length,
        // not string length, so multi-byte UTF-8 is framed correctly.
        const headers =
          init.body !== undefined
            ? { ...init.headers, 'Content-Length': String(Buffer.byteLength(init.body)) }
            : init.headers;
        const req = httpsRequest(
          url,
          {
            method: init.method,
            headers,
            cert: tls.cert,
            key: tls.key,
            ca: tls.ca,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const status = res.statusCode ?? 0;
              const body = NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks);
              resolve(new Response(body, { status, headers: toHeaders(res.headers) }));
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        if (init.body !== undefined) req.write(Buffer.from(init.body as never));
        req.end();
      });
    },
  };
}
