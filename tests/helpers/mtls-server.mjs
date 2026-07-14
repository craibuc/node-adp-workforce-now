import { createServer } from 'node:https';

/**
 * HTTPS server that REQUIRES a client certificate signed by its own cert
 * (a self-signed cert is its own CA). Echoes request details as JSON.
 */
export function startMtlsServer({ cert, key }) {
  const server = createServer(
    { cert, key, ca: [cert], requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      if (req.url === '/empty') {
        res.writeHead(204);
        res.end();
        return;
      }
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            authorized: req.socket.authorized,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            bodyBase64: Buffer.concat(chunks).toString('base64'),
          }),
        );
      });
    },
  );
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `https://localhost:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
