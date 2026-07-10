import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startMtlsServer } from '../helpers/mtls-server.mjs';
import { createNodeTransport } from '../../dist/transport/node.js';

const cert = readFileSync(new URL('../fixtures/tls/cert.pem', import.meta.url), 'utf8');
const key = readFileSync(new URL('../fixtures/tls/key.pem', import.meta.url), 'utf8');

test('node transport completes a real mTLS request with a multi-byte body', async () => {
  const server = await startMtlsServer({ cert, key });
  try {
    const transport = createNodeTransport({ cert, key, ca: cert });
    const response = await transport.request(`${server.url}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renée' }),
    });
    assert.equal(response.status, 200);
    const echo = await response.json();
    assert.equal(echo.authorized, true);
    assert.equal(echo.method, 'POST');
    assert.equal(JSON.parse(echo.body).name, 'Renée');
    // ADP's token endpoint rejects chunked bodies: the adapter must send an
    // explicit byte-accurate Content-Length instead of Transfer-Encoding.
    assert.equal(echo.headers['content-length'], String(Buffer.byteLength(JSON.stringify({ name: 'Renée' }))));
    assert.equal(echo.headers['transfer-encoding'], undefined);
  } finally {
    await server.close();
  }
});

test('node transport returns a well-formed 204 Response', async () => {
  const server = await startMtlsServer({ cert, key });
  try {
    const transport = createNodeTransport({ cert, key, ca: cert });
    const response = await transport.request(`${server.url}/empty`, {
      method: 'GET',
      headers: {},
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  } finally {
    await server.close();
  }
});
