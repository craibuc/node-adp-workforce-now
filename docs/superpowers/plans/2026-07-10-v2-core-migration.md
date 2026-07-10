# adp-workforce-now v2 Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CommonJS/jest v1 library with a TypeScript/ESM v2 that runs on Bun and Node: transport seam, lazy OAuth with pluggable token stores, one centralized error extractor, fixed pagination, and a public-repo-ready tree.

**Architecture:** A `Client` owns auth and HTTP orchestration behind an `AdpTransport` seam (Bun fetch+tls adapter; Node `node:https` adapter). Domain methods hang off `client.worker`. All error mapping goes through one `raiseForAdp()` extractor tested against recorded fixtures.

**Tech Stack:** TypeScript 5 (strict, NodeNext), Bun ≥ 1.2 (`bun test`), Node ≥ 20 (consumers) / 24 (CI `node --test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-10-v2-core-migration-design.md` — read it before starting any task.

## Global Constraints

- Zero runtime dependencies. Dev dependencies: `typescript`, `@types/node` only.
- ESM only: `"type": "module"`; relative imports in `src/` use `.js` extensions (tsc does not rewrite specifiers; Bun resolves them to `.ts`).
- `CachedToken` JSON shape is a cross-language interop contract: `{"access_token": string, "expires_at": number}`, `expires_at` in **epoch seconds UTC**. Never change it.
- Token endpoint: `POST https://accounts.adp.com/auth/oauth/v2/token`. API base: `https://api.adp.com`. mTLS on every call.
- Never log or embed tokens, client secrets, or PEM contents in error messages.
- No employer-, tenant-, or workspace-identifying strings anywhere in committed files (this plan included). Personal-name attribution (`Craig Buchanan`, `@craibuc`) is fine — it's the public npm handle.
- Certs/keys stay in-memory strings; never write them to disk.
- Work on branch `v2-core`. Commit after every task (steps say when).
- Run tests with `bun test` from the repo root; Node-runtime tests with `npm run test:node`.

---

### Task 1: Toolchain scaffold

**Files:**
- Create: `tsconfig.json`, `LICENSE`, `src/index.ts` (placeholder)
- Modify: `package.json` (full rewrite)
- Delete: `.babelrc`, `package-lock.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a repo where `bun install`, `bun run typecheck`, and `bun test` run. Scripts: `test`, `test:node`, `typecheck`, `build`. Later tasks add files under `src/` and `tests/` without touching config.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b v2-core
```

- [ ] **Step 2: Rewrite package.json**

Replace the entire contents of `package.json` with:

```json
{
  "name": "@craibuc/adp-workforce-now",
  "version": "2.0.0-dev.0",
  "description": "TypeScript client for ADP Workforce Now: mTLS transport, lazy OAuth, typed errors. Runs on Bun and Node.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./windmill": {
      "bun": "./src/token-store/windmill.ts",
      "types": "./dist/token-store/windmill.d.ts",
      "default": "./dist/token-store/windmill.js"
    }
  },
  "files": ["dist", "src"],
  "sideEffects": false,
  "scripts": {
    "test": "bun test",
    "test:node": "npm run build && node --test tests/node/",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "engines": { "node": ">=20" },
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/craibuc/node-adp-workforce-now.git"
  },
  "keywords": ["adp", "workforce-now", "api", "typescript", "bun", "node"],
  "author": "Craig Buchanan",
  "license": "ISC",
  "bugs": { "url": "https://github.com/craibuc/node-adp-workforce-now/issues" },
  "homepage": "https://github.com/craibuc/node-adp-workforce-now#readme",
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.5.0"
  }
}
```

Note what disappeared: the `"https"` stub dependency (v1 bug #1), jest, babel, nock, dotenv.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`include: ["src"]` is deliberate: tests are type-checked by Bun at runtime, not by tsc, so `bun:test` types are not needed here.

- [ ] **Step 4: Create LICENSE**

```
ISC License

Copyright (c) 2026 Craig Buchanan

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

- [ ] **Step 5: Placeholder entry point**

Create `src/index.ts`:

```typescript
export {};
```

(Task 10 replaces this with the real export surface; tsc needs at least one input file until then.)

- [ ] **Step 6: Delete obsolete toolchain files and reinstall**

```bash
rm .babelrc package-lock.json
rm -rf node_modules
bun install
```

Expected: `bun install` succeeds and writes `bun.lock`. Do NOT gitignore `bun.lock` — CI uses it.

- [ ] **Step 7: Verify the toolchain**

```bash
bun run typecheck && bun test
```

Expected: typecheck passes; `bun test` reports no test files found (exit code may be non-zero for "no tests" — that's acceptable at this point).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: TS/ESM/Bun toolchain scaffold; drop babel/jest/nock and https stub dep"
```

---

### Task 2: Centralized errors (`errors.ts`)

**Files:**
- Create: `src/errors.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Consumes: fixture JSON under `tests/fixtures/` (committed, do not modify in this task).
- Produces (later tasks import these from `../src/errors.js`):
  - `class AdpError extends Error` with readonly `statusCode: number`, `endpoint: string`, `adpMessage?: string`, `adpCode?: string`, `raw?: unknown`; constructor takes a single `AdpErrorArgs` object with those fields.
  - `class BadRequestError/UnauthorizedError/ForbiddenError/NotFoundError extends AdpError` (400/401/403/404).
  - `function raiseForAdp(status: number, json: unknown, endpoint: string): never`.

- [ ] **Step 1: Write the failing tests**

Create `tests/errors.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import {
  AdpError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  raiseForAdp,
} from '../src/errors.js';

import rehireAlreadyActive from './fixtures/worker.rehire/400.already-active.json';
import rehireInvalidAoid from './fixtures/worker.rehire/400.invalid-aoid.json';
import terminateAlreadyTerminated from './fixtures/worker.work-assignment.terminate/400.already-terminated.json';
import terminateInvalidAoid from './fixtures/worker.work-assignment.terminate/400.invalid-aoid.json';
import workerForbidden from './fixtures/workers/aoid/403.json';

function capture(fn: () => never): AdpError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdpError) return error;
    throw error;
  }
  throw new Error('unreachable');
}

describe('raiseForAdp', () => {
  it('maps 400 confirmMessage shape (already active)', () => {
    const e = capture(() => raiseForAdp(400, rehireAlreadyActive, 'POST /events/hr/v1/worker.rehire'));
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.statusCode).toBe(400);
    expect(e.adpMessage).toBe(
      'The employee cannot be rehired because he or she has an Active or On Leave position.',
    );
    expect(e.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
    expect(e.endpoint).toBe('POST /events/hr/v1/worker.rehire');
    expect(e.raw).toBe(rehireAlreadyActive);
  });

  it('maps 400 confirmMessage shape (invalid aoid)', () => {
    const e = capture(() => raiseForAdp(400, rehireInvalidAoid, 'POST /events/hr/v1/worker.rehire'));
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toBe('associateOID is invalid.');
    expect(e.adpCode).toBe('errors.invalid');
  });

  it('maps 400 exceptionMessages shape (already terminated)', () => {
    const e = capture(() =>
      raiseForAdp(400, terminateAlreadyTerminated, 'POST /events/hr/v1/worker.work-assignment.terminate'),
    );
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toContain('is already terminated');
    expect(e.adpCode).toBeUndefined();
  });

  it('maps 400 exceptionMessages shape (invalid item id)', () => {
    const e = capture(() =>
      raiseForAdp(400, terminateInvalidAoid, 'POST /events/hr/v1/worker.work-assignment.terminate'),
    );
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toBe('Item ID is invalid');
  });

  it('maps 403 confirmMessage variant without processMessageID', () => {
    const e = capture(() => raiseForAdp(403, workerForbidden, 'GET /hr/v2/workers/XXX'));
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(e.adpMessage).toBe('Forbidden');
    expect(e.adpCode).toBeUndefined();
  });

  it('maps the newer applicationCode shape', () => {
    const json = { response: { applicationCode: { message: 'Invalid request', code: 'ERR_01' } } };
    const e = capture(() => raiseForAdp(400, json, 'POST /x'));
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toBe('Invalid request');
    expect(e.adpCode).toBe('ERR_01');
  });

  it('maps OAuth token-endpoint errors', () => {
    const json = { error: 'invalid_client', error_description: 'The given client credentials were not valid' };
    const e = capture(() => raiseForAdp(401, json, 'POST /auth/oauth/v2/token'));
    expect(e).toBeInstanceOf(UnauthorizedError);
    expect(e.adpMessage).toBe('The given client credentials were not valid');
    expect(e.adpCode).toBe('invalid_client');
  });

  it('maps 404 to NotFoundError', () => {
    const e = capture(() => raiseForAdp(404, undefined, 'GET /x'));
    expect(e).toBeInstanceOf(NotFoundError);
  });

  it('throws base AdpError for unmapped statuses (429)', () => {
    const e = capture(() => raiseForAdp(429, {}, 'GET /x'));
    expect(e).toBeInstanceOf(AdpError);
    expect(e).not.toBeInstanceOf(BadRequestError);
    expect(e.statusCode).toBe(429);
  });

  it('never produces a bare Error and message names the endpoint', () => {
    const e = capture(() => raiseForAdp(500, 'Internal Server Error', 'GET /hr/v2/workers'));
    expect(e).toBeInstanceOf(AdpError);
    expect(e.message).toContain('GET /hr/v2/workers');
    expect(e.name).toBe('AdpError');
  });

  it('subclass errors carry the subclass name', () => {
    const e = capture(() => raiseForAdp(400, undefined, 'POST /x'));
    expect(e.name).toBe('BadRequestError');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/errors.test.ts`
Expected: FAIL — cannot resolve `../src/errors.js`.

- [ ] **Step 3: Implement `src/errors.ts`**

```typescript
export interface AdpErrorArgs {
  statusCode: number;
  endpoint: string;
  adpMessage?: string;
  adpCode?: string;
  raw?: unknown;
}

export class AdpError extends Error {
  readonly statusCode: number;
  readonly endpoint: string;
  readonly adpMessage?: string;
  readonly adpCode?: string;
  readonly raw?: unknown;

  constructor(args: AdpErrorArgs) {
    super(`${args.statusCode}${args.adpMessage ? ` ${args.adpMessage}` : ''} (${args.endpoint})`);
    this.name = new.target.name;
    this.statusCode = args.statusCode;
    this.endpoint = args.endpoint;
    this.adpMessage = args.adpMessage;
    this.adpCode = args.adpCode;
    this.raw = args.raw;
  }
}

export class BadRequestError extends AdpError {}
export class UnauthorizedError extends AdpError {}
export class ForbiddenError extends AdpError {}
export class NotFoundError extends AdpError {}

interface Extracted {
  adpMessage?: string;
  adpCode?: string;
}

/** ADP returns errors in several shapes; try each known one in order. */
function extract(json: unknown): Extracted {
  if (typeof json !== 'object' || json === null) return {};
  // Optional chaining over `any`: every field access below is defensive.
  const body = json as Record<string, any>;

  // Shape 1 (newer APIs): response.applicationCode.{message,code}
  const app = body.response?.applicationCode;
  if (typeof app?.message === 'string') {
    return {
      adpMessage: app.message,
      adpCode: typeof app.code === 'string' ? app.code : undefined,
    };
  }

  // Shape 2 (legacy): confirmMessage.resourceMessages[0].processMessages[0]
  const processMessage = body.confirmMessage?.resourceMessages?.[0]?.processMessages?.[0];
  if (typeof processMessage === 'object' && processMessage !== null) {
    const adpMessage = processMessage.userMessage?.messageTxt;
    const adpCode = processMessage.processMessageID?.idValue;
    return {
      adpMessage: typeof adpMessage === 'string' ? adpMessage : undefined,
      adpCode: typeof adpCode === 'string' ? adpCode : undefined,
    };
  }

  // Shape 3 (terminate & some events): exceptionMessages[0].message
  const exception = body.exceptionMessages?.[0];
  if (typeof exception?.message === 'string') {
    return { adpMessage: exception.message };
  }

  // OAuth token endpoint: { error, error_description }
  if (typeof body.error_description === 'string') {
    return {
      adpMessage: body.error_description,
      adpCode: typeof body.error === 'string' ? body.error : undefined,
    };
  }

  return {};
}

export function raiseForAdp(status: number, json: unknown, endpoint: string): never {
  const { adpMessage, adpCode } = extract(json);
  const args: AdpErrorArgs = { statusCode: status, endpoint, adpMessage, adpCode, raw: json };
  switch (status) {
    case 400: throw new BadRequestError(args);
    case 401: throw new UnauthorizedError(args);
    case 403: throw new ForbiddenError(args);
    case 404: throw new NotFoundError(args);
    default: throw new AdpError(args);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/errors.test.ts && bun run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: centralized AdpError hierarchy and raiseForAdp extractor over fixture corpus"
```

---

### Task 3: Token store interface + MemoryTokenStore

**Files:**
- Create: `src/token-store/types.ts`, `src/token-store/memory.ts`
- Test: `tests/token-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (imported as `../src/token-store/types.js` / `memory.js`):
  - `interface CachedToken { access_token: string; expires_at: number }` (epoch seconds UTC).
  - `interface TokenStore { get(): Promise<CachedToken | undefined>; set(token: CachedToken): Promise<void> }`.
  - `class MemoryTokenStore implements TokenStore`.

- [ ] **Step 1: Write the failing test**

Create `tests/token-store.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { MemoryTokenStore } from '../src/token-store/memory.js';

describe('MemoryTokenStore', () => {
  it('returns undefined before any set', async () => {
    expect(await new MemoryTokenStore().get()).toBeUndefined();
  });

  it('returns the last token set', async () => {
    const store = new MemoryTokenStore();
    await store.set({ access_token: 'a', expires_at: 100 });
    await store.set({ access_token: 'b', expires_at: 200 });
    expect(await store.get()).toEqual({ access_token: 'b', expires_at: 200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/token-store.test.ts`
Expected: FAIL — cannot resolve `../src/token-store/memory.js`.

- [ ] **Step 3: Implement**

Create `src/token-store/types.ts`:

```typescript
export interface CachedToken {
  access_token: string;
  /**
   * Expiry as epoch seconds UTC — a number, never an ISO string.
   * This JSON shape is a cross-language cache interop contract; other
   * clients may read/write the same cache. Do not change it.
   */
  expires_at: number;
}

export interface TokenStore {
  get(): Promise<CachedToken | undefined>;
  set(token: CachedToken): Promise<void>;
}
```

Create `src/token-store/memory.ts`:

```typescript
import type { CachedToken, TokenStore } from './types.js';

export class MemoryTokenStore implements TokenStore {
  private token: CachedToken | undefined;

  async get(): Promise<CachedToken | undefined> {
    return this.token;
  }

  async set(token: CachedToken): Promise<void> {
    this.token = token;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/token-store.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/token-store/ tests/token-store.test.ts
git commit -m "feat: TokenStore contract and MemoryTokenStore"
```

---

### Task 4: Transport seam + Bun and Node adapters

**Files:**
- Create: `src/transport/types.ts`, `src/transport/bun.ts`, `src/transport/node.ts`
- Test: `tests/transport-bun.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (imported as `../src/transport/*.js`):
  - `interface TransportTls { cert: string; key: string; ca?: string }` (`ca` exists for tests against a local self-signed server).
  - `interface TransportInit { method: string; headers: Record<string, string>; body?: string }`.
  - `interface AdpTransport { request(url: string, init: TransportInit): Promise<Response> }`.
  - `function createBunTransport(tls: TransportTls): AdpTransport`.
  - `function createNodeTransport(tls: TransportTls): AdpTransport`.

- [ ] **Step 1: Write the failing test (Bun adapter)**

The Bun adapter is tested by monkeypatching `globalThis.fetch` — it verifies the wiring (URL, init passthrough, `tls` option). The real Bun mTLS handshake is covered by the live integration test (Task 11); the Node adapter gets a real local mTLS handshake test in Task 5.

Create `tests/transport-bun.test.ts`:

```typescript
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
    expect(captured?.init.tls).toEqual({ cert: 'CERT', key: 'KEY' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/transport-bun.test.ts`
Expected: FAIL — cannot resolve `../src/transport/bun.js`.

- [ ] **Step 3: Implement the three transport files**

Create `src/transport/types.ts`:

```typescript
export interface TransportTls {
  cert: string;
  key: string;
  /** Custom CA bundle; used by tests that talk to a local self-signed server. */
  ca?: string;
}

export interface TransportInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** The only runtime-specific seam: perform one mTLS HTTP request. */
export interface AdpTransport {
  request(url: string, init: TransportInit): Promise<Response>;
}
```

Create `src/transport/bun.ts`:

```typescript
import type { AdpTransport, TransportInit, TransportTls } from './types.js';

export function createBunTransport(tls: TransportTls): AdpTransport {
  return {
    request(url: string, init: TransportInit): Promise<Response> {
      // `tls` is Bun's non-standard fetch extension for client certificates.
      return fetch(url, { ...init, tls } as unknown as RequestInit);
    },
  };
}
```

Create `src/transport/node.ts`:

```typescript
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
        const req = httpsRequest(
          url,
          {
            method: init.method,
            headers: init.headers,
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
        if (init.body !== undefined) req.write(init.body);
        req.end();
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/transport-bun.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/transport/ tests/transport-bun.test.ts
git commit -m "feat: AdpTransport seam with Bun fetch+tls and node:https adapters"
```

---

### Task 5: Node-runtime verification + CI

**Files:**
- Create: `tests/fixtures/tls/cert.pem`, `tests/fixtures/tls/key.pem` (generated, obviously fake, test-only)
- Create: `tests/helpers/mtls-server.mjs`, `tests/node/transport.test.js`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `createNodeTransport(tls: TransportTls): AdpTransport` from Task 4 — imported from `dist/transport/node.js` (built output; this test verifies what ships).
- Produces: `startMtlsServer({ cert, key }): Promise<{ url: string; close(): Promise<void> }>` helper (echoes `{ method, url, authorized, headers, body }` as JSON; responds 204 to path `/empty`); a green `npm run test:node`; CI running both runtimes.

- [ ] **Step 1: Generate throwaway test certificates**

These are test-only, self-signed, and safe to commit (the repo convention is obviously-fake PEMs; these secure nothing).

```bash
mkdir -p tests/fixtures/tls
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout tests/fixtures/tls/key.pem -out tests/fixtures/tls/cert.pem \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Expected: both files exist; `openssl x509 -in tests/fixtures/tls/cert.pem -noout -subject` prints `subject=CN=localhost`.

- [ ] **Step 2: Write the mTLS echo-server helper**

Create `tests/helpers/mtls-server.mjs` (plain JS so both Bun and Node can import it without a build):

```javascript
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
```

- [ ] **Step 3: Write the failing Node test**

Create `tests/node/transport.test.js` (plain JS, `node:test`, imports the **built** adapter):

```javascript
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
```

- [ ] **Step 4: Run the Node tests**

Run: `npm run test:node`
Expected: builds `dist/` via tsc, then both tests PASS under `node --test`. (If the build fails, fix `src/` type errors first — the suite must stay green.)

- [ ] **Step 5: Add the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, v2-core]
  pull_request:

jobs:
  bun:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test

  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install
      - run: npm run test:node
```

- [ ] **Step 6: Full local verification**

Run: `bun test && npm run test:node`
Expected: all Bun tests and both Node tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/tls/ tests/helpers/mtls-server.mjs tests/node/ .github/
git commit -m "test: real mTLS handshake coverage for the Node adapter; dual-runtime CI"
```

---

### Task 6: Client — construction, PEM handling, auth, token lifecycle

**Files:**
- Create: `src/client.ts`, `src/worker.ts` (minimal stub — Task 8 fleshes it out)
- Create: `tests/helpers/fake-transport.ts`
- Test: `tests/client-auth.test.ts`

**Interfaces:**
- Consumes: `AdpTransport`/`TransportInit`/`TransportTls` (Task 4), `TokenStore`/`CachedToken`/`MemoryTokenStore` (Task 3), `raiseForAdp` (Task 2).
- Produces:
  - `class Client` — `new Client(certificate: string, privateKey: string, options?: ClientOptions)`; `interface ClientOptions { credentials?: { client_id: string; client_secret: string }; tokenStore?: TokenStore; transport?: AdpTransport; apiBaseUrl?: string; tokenUrl?: string; masked?: boolean }`; instance members `worker: Worker`, `authenticate(): Promise<CachedToken>`, `request(method: string, path: string, data?: unknown): Promise<unknown>`, `get(path: string): Promise<unknown>`, `post(path: string, data: unknown): Promise<unknown>`.
  - `function normalizePem(input: string): string` (exported for tests).
  - Test helper `makeFakeTransport(responses: Array<{ status: number; json?: unknown; text?: string }>): { transport: AdpTransport; calls: RecordedCall[] }` where `RecordedCall = { url: string; method: string; headers: Record<string, string>; body?: string }`.
- Note for Task 7: this task implements `request()` **without** 401-retry/204/masked/error-mapping refinements; Task 7 completes it. Tests here only cover construction, PEM, and token lifecycle.

- [ ] **Step 1: Write the fake transport helper**

Create `tests/helpers/fake-transport.ts`:

```typescript
import type { AdpTransport, TransportInit } from '../../src/transport/types.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CannedResponse {
  status: number;
  json?: unknown;
  text?: string;
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
        next.status === 204 ? null : next.text !== undefined ? next.text : JSON.stringify(next.json ?? null);
      return new Response(body, { status: next.status, headers: { 'content-type': 'application/json' } });
    },
  };
  return { transport, calls };
}

export const TOKEN_RESPONSE: CannedResponse = {
  status: 200,
  json: { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600, scope: 'api' },
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/client-auth.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { Client, normalizePem } from '../src/client.js';
import { MemoryTokenStore } from '../src/token-store/memory.js';
import { UnauthorizedError } from '../src/errors.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(responses: Parameters<typeof makeFakeTransport>[0], store = new MemoryTokenStore()) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, tokenStore: store, transport });
  return { client, calls, store };
}

describe('normalizePem', () => {
  it('passes raw PEM through unchanged', () => {
    expect(normalizePem(PEM)).toBe(PEM);
  });

  it('decodes base64-encoded PEM', () => {
    const encoded = Buffer.from(PEM, 'utf8').toString('base64');
    expect(normalizePem(encoded)).toBe(PEM);
  });
});

describe('Client token lifecycle', () => {
  it('lazily authenticates on first request and reuses the cached token', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { ok: 1 } },
      { status: 200, json: { ok: 2 } },
    ]);

    await client.get('/hr/v2/workers/AAA');
    await client.get('/hr/v2/workers/BBB');

    expect(calls).toHaveLength(3); // one token call, two GETs — no re-auth
    expect(calls[0].url).toBe('https://accounts.adp.com/auth/oauth/v2/token');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(calls[0].body);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('id-1');
    expect(params.get('client_secret')).toBe('secret-1');
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
    expect(calls[2].headers.Authorization).toBe('Bearer tok-1');
  });

  it('writes the token back to the store with epoch-seconds expiry', async () => {
    const { client, store } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);
    const before = Math.floor(Date.now() / 1000);

    await client.get('/x');

    const cached = await store.get();
    expect(cached?.access_token).toBe('tok-1');
    expect(cached?.expires_at).toBeGreaterThanOrEqual(before + 3600);
    expect(cached?.expires_at).toBeLessThanOrEqual(before + 3610);
  });

  it('uses a stored token that is still valid past the 300 s margin', async () => {
    const store = new MemoryTokenStore();
    await store.set({ access_token: 'stored', expires_at: Math.floor(Date.now() / 1000) + 1000 });
    const { client, calls } = makeClient([{ status: 200, json: {} }], store);

    await client.get('/x');

    expect(calls).toHaveLength(1); // no token call
    expect(calls[0].headers.Authorization).toBe('Bearer stored');
  });

  it('re-authenticates when the stored token is inside the 300 s margin', async () => {
    const store = new MemoryTokenStore();
    await store.set({ access_token: 'stale', expires_at: Math.floor(Date.now() / 1000) + 100 });
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }], store);

    await client.get('/x');

    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
  });

  it('throws UnauthorizedError with the OAuth description on bad credentials', async () => {
    const { client } = makeClient([
      { status: 401, json: { error: 'invalid_client', error_description: 'The given client credentials were not valid' } },
    ]);

    await expect(client.get('/x')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws a clear error when no credentials and no valid token exist', async () => {
    const { transport } = makeFakeTransport([]);
    const client = new Client(PEM, PEM, { transport });
    await expect(client.get('/x')).rejects.toThrow(/credentials/);
  });

  it('authenticate() can be called explicitly', async () => {
    const { client } = makeClient([TOKEN_RESPONSE]);
    const token = await client.authenticate();
    expect(token.access_token).toBe('tok-1');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/client-auth.test.ts`
Expected: FAIL — cannot resolve `../src/client.js`.

- [ ] **Step 4: Implement `src/worker.ts` stub and `src/client.ts`**

Create `src/worker.ts` (stub only — Task 8 replaces the body):

```typescript
import type { Client } from './client.js';

export class Worker {
  constructor(protected readonly client: Client) {}
}
```

Create `src/client.ts`:

```typescript
import { raiseForAdp } from './errors.js';
import { MemoryTokenStore } from './token-store/memory.js';
import type { CachedToken, TokenStore } from './token-store/types.js';
import { createBunTransport } from './transport/bun.js';
import { createNodeTransport } from './transport/node.js';
import type { AdpTransport, TransportTls } from './transport/types.js';
import { Worker } from './worker.js';

const DEFAULT_API_BASE_URL = 'https://api.adp.com';
const DEFAULT_TOKEN_URL = 'https://accounts.adp.com/auth/oauth/v2/token';
const REFRESH_MARGIN_SECONDS = 300;

export interface ClientOptions {
  /** Enables lazy auto-authentication. */
  credentials?: { client_id: string; client_secret: string };
  tokenStore?: TokenStore;
  transport?: AdpTransport;
  apiBaseUrl?: string;
  tokenUrl?: string;
  /** Default true. Pass false to receive unmasked government IDs. */
  masked?: boolean;
}

/** Accepts raw PEM or base64-encoded PEM (the `.env` convention). */
export function normalizePem(input: string): string {
  if (input.includes('-----BEGIN')) return input;
  return Buffer.from(input, 'base64').toString('utf8');
}

function detectTransport(tls: TransportTls): AdpTransport {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? createBunTransport(tls)
    : createNodeTransport(tls);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class Client {
  readonly worker: Worker;
  private readonly transport: AdpTransport;
  private readonly tokenStore: TokenStore;
  private readonly credentials?: { client_id: string; client_secret: string };
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly masked: boolean;

  constructor(certificate: string, privateKey: string, options: ClientOptions = {}) {
    const tls: TransportTls = { cert: normalizePem(certificate), key: normalizePem(privateKey) };
    this.transport = options.transport ?? detectTransport(tls);
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
    this.credentials = options.credentials;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.masked = options.masked ?? true;
    this.worker = new Worker(this);
  }

  async authenticate(): Promise<CachedToken> {
    if (!this.credentials) {
      throw new Error('No credentials configured and no valid token in the store; pass options.credentials.');
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.client_id,
      client_secret: this.credentials.client_secret,
    }).toString();
    const response = await this.transport.request(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await parseBody(response);
    if (!response.ok) raiseForAdp(response.status, json, 'POST /auth/oauth/v2/token');
    const { access_token, expires_in } = json as { access_token: string; expires_in: number };
    const token: CachedToken = {
      access_token,
      expires_at: Math.floor(Date.now() / 1000) + expires_in,
    };
    await this.tokenStore.set(token);
    return token;
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.tokenStore.get();
      if (cached && cached.expires_at - REFRESH_MARGIN_SECONDS > Date.now() / 1000) {
        return cached.access_token;
      }
    }
    return (await this.authenticate()).access_token;
  }

  private send(method: string, url: string, token: string, data?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: this.masked ? 'application/json' : 'application/json;masked=false',
      Authorization: `Bearer ${token}`,
    };
    let body: string | undefined;
    if (data !== undefined) {
      body = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
    }
    return this.transport.request(url, { method, headers, body });
  }

  async request(method: string, path: string, data?: unknown): Promise<unknown> {
    const url = `${this.apiBaseUrl}${path}`;
    const endpoint = `${method} ${path}`;
    const token = await this.getToken();
    const response = await this.send(method, url, token, data);
    const json = await parseBody(response);
    if (!response.ok) raiseForAdp(response.status, json, endpoint);
    return json;
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  post(path: string, data: unknown): Promise<unknown> {
    return this.request('POST', path, data);
  }
}
```

(`request()` is deliberately incomplete: 401 retry and explicit 204 handling arrive in Task 7.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/client-auth.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Run the whole suite**

Run: `bun test`
Expected: all tests from Tasks 2–6 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client.ts src/worker.ts tests/helpers/fake-transport.ts tests/client-auth.test.ts
git commit -m "feat: Client with lazy auth, PEM normalization, pluggable token store and transport"
```

---

### Task 7: Client — 401 retry, 204, masking, error mapping, UTF-8

**Files:**
- Modify: `src/client.ts` (the `request` method only)
- Test: `tests/client-request.test.ts`

**Interfaces:**
- Consumes: everything Task 6 produced; `BadRequestError`/`UnauthorizedError` (Task 2); fixture `tests/fixtures/worker.rehire/400.already-active.json`.
- Produces: final `request()` semantics relied on by Worker (Tasks 8–9): 204 → `undefined`; exactly one force-refresh retry on 401; non-2xx → `raiseForAdp`.

- [ ] **Step 1: Write the failing tests**

Create `tests/client-request.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { MemoryTokenStore } from '../src/token-store/memory.js';
import { BadRequestError, UnauthorizedError } from '../src/errors.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';
import rehireAlreadyActive from './fixtures/worker.rehire/400.already-active.json';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(
  responses: Parameters<typeof makeFakeTransport>[0],
  options: ConstructorParameters<typeof Client>[2] = {},
) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, {
    credentials: CREDS,
    tokenStore: new MemoryTokenStore(),
    transport,
    ...options,
  });
  return { client, calls };
}

const FRESH_TOKEN = {
  status: 200,
  json: { access_token: 'tok-2', token_type: 'Bearer', expires_in: 3600, scope: 'api' },
};

describe('Client.request semantics', () => {
  it('retries exactly once with a fresh token on 401', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 401, json: {} },
      FRESH_TOKEN,
      { status: 200, json: { ok: true } },
    ]);

    const result = await client.get('/hr/v2/workers/AAA');

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
    expect(calls[3].headers.Authorization).toBe('Bearer tok-2');
  });

  it('throws UnauthorizedError when the retry also 401s', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 401, json: {} },
      FRESH_TOKEN,
      { status: 401, json: {} },
    ]);

    await expect(client.get('/x')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls).toHaveLength(4); // no second retry
  });

  it('returns undefined for 204 responses', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.get('/hr/v2/workers?$top=100&$skip=500')).toBeUndefined();
  });

  it('sends masked Accept header by default', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);
    await client.get('/x');
    expect(calls[1].headers.Accept).toBe('application/json');
  });

  it('sends masked=false only when explicitly requested', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }], { masked: false });
    await client.get('/x');
    expect(calls[1].headers.Accept).toBe('application/json;masked=false');
  });

  it('maps ADP 400 bodies through raiseForAdp with endpoint context', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 400, json: rehireAlreadyActive }]);

    const error = await client.post('/events/hr/v1/worker.rehire', {}).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
    expect(error.endpoint).toBe('POST /events/hr/v1/worker.rehire');
  });

  it('serializes multi-byte UTF-8 bodies intact and sets no manual Content-Length', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);

    await client.post('/events/hr/v1/worker.hire', { givenName: 'Renée' });

    expect(JSON.parse(calls[1].body!).givenName).toBe('Renée');
    expect(Object.keys(calls[1].headers).map((h) => h.toLowerCase())).not.toContain('content-length');
  });
});
```

- [ ] **Step 2: Run tests to verify the retry/204 cases fail**

Run: `bun test tests/client-request.test.ts`
Expected: FAIL — the two 401-retry tests and (depending on `parseBody`) the 204 test fail against Task 6's `request()`.

- [ ] **Step 3: Complete `request()`**

In `src/client.ts`, replace the `request` method with:

```typescript
  async request(method: string, path: string, data?: unknown): Promise<unknown> {
    const url = `${this.apiBaseUrl}${path}`;
    const endpoint = `${method} ${path}`;

    let token = await this.getToken();
    let response = await this.send(method, url, token, data);

    // Exactly one force-refresh retry on 401.
    if (response.status === 401) {
      token = await this.getToken(true);
      response = await this.send(method, url, token, data);
    }

    // Empty result (end of pages, empty event queue) — callers detect undefined.
    if (response.status === 204) return undefined;

    const json = await parseBody(response);
    if (!response.ok) raiseForAdp(response.status, json, endpoint);
    return json;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test && bun run typecheck`
Expected: entire suite PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client-request.test.ts
git commit -m "feat: single 401 force-refresh retry, 204 passthrough, masked-by-default, centralized error mapping"
```

---

### Task 8: Worker reads — one, pages, all, find

**Files:**
- Modify: `src/worker.ts` (replace the stub)
- Test: `tests/worker-reads.test.ts`

**Interfaces:**
- Consumes: `Client.get(path)` semantics from Task 7 (204 → `undefined`); `makeFakeTransport`/`TOKEN_RESPONSE` helper (Task 6).
- Produces (on `client.worker`):
  - `interface WorkerRecord { associateOID: string; [key: string]: unknown }`
  - `one(associateOID: string): Promise<WorkerRecord | undefined>`
  - `pages(pageSize?: number): AsyncGenerator<WorkerRecord[], void, void>` (default 100)
  - `all(pageSize?: number): Promise<WorkerRecord[]>`
  - `find(predicate: (w: WorkerRecord) => boolean, pageSize?: number): Promise<WorkerRecord | undefined>`

- [ ] **Step 1: Write the failing tests**

Create `tests/worker-reads.test.ts`:

```typescript
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

const w = (id: string) => ({ associateOID: id });

describe('worker.one', () => {
  it('returns the first worker from the response', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('AAA')] } }]);
    const worker = await client.worker.one('AAA');
    expect(worker).toEqual(w('AAA'));
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/AAA');
  });

  it('returns undefined on 204', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.worker.one('AAA')).toBeUndefined();
  });
});

describe('worker.pages / worker.all', () => {
  it('walks $top/$skip pages until 204 and accumulates', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      { status: 200, json: { workers: [w('C')] } },
      { status: 204 },
    ]);

    const all = await client.worker.all(2);

    expect(all.map((x) => x.associateOID)).toEqual(['A', 'B', 'C']);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=0');
    expect(calls[2].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=2');
    expect(calls[3].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=4');
  });

  it('yields pages lazily', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }]);
    const iterator = client.worker.pages(1);
    const first = await iterator.next();
    expect(first.value).toEqual([w('A')]);
    expect(calls).toHaveLength(2); // token + one page; no eager second fetch
  });
});

describe('worker.find', () => {
  it('returns the first match without fetching later pages', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      // no more responses queued: fetching page 2 would throw "queue empty"
    ]);

    const match = await client.worker.find((worker) => worker.associateOID === 'B', 2);

    expect(match).toEqual(w('B'));
    expect(calls).toHaveLength(2);
  });

  it('returns undefined when nothing matches', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }, { status: 204 }]);
    expect(await client.worker.find(() => false, 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/worker-reads.test.ts`
Expected: FAIL — `client.worker.one is not a function` (stub Worker).

- [ ] **Step 3: Implement the read methods**

Replace `src/worker.ts` with:

```typescript
import type { Client } from './client.js';

/** Typed only where the library reads/writes; everything else passes through. */
export interface WorkerRecord {
  associateOID: string;
  [key: string]: unknown;
}

export class Worker {
  constructor(protected readonly client: Client) {}

  async one(associateOID: string): Promise<WorkerRecord | undefined> {
    const response = (await this.client.get(`/hr/v2/workers/${associateOID}`)) as
      | { workers?: WorkerRecord[] }
      | undefined;
    return response?.workers?.[0];
  }

  async *pages(pageSize = 100): AsyncGenerator<WorkerRecord[], void, void> {
    for (let page = 0; ; page++) {
      const response = (await this.client.get(
        `/hr/v2/workers?$top=${pageSize}&$skip=${page * pageSize}`,
      )) as { workers?: WorkerRecord[] } | undefined;
      const workers = response?.workers;
      if (!workers || workers.length === 0) return;
      yield workers;
    }
  }

  /** Convenience accumulation; memory grows with the full worker count. */
  async all(pageSize = 100): Promise<WorkerRecord[]> {
    const result: WorkerRecord[] = [];
    for await (const page of this.pages(pageSize)) result.push(...page);
    return result;
  }

  async find(
    predicate: (worker: WorkerRecord) => boolean,
    pageSize = 100,
  ): Promise<WorkerRecord | undefined> {
    for await (const page of this.pages(pageSize)) {
      const match = page.find(predicate);
      if (match) return match;
    }
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test && bun run typecheck`
Expected: full suite PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts tests/worker-reads.test.ts
git commit -m "feat: worker.one and AsyncGenerator pagination (pages/all/find) — fixes single-page bug"
```

---

### Task 9: Worker events — hire, rehire, terminate, hireMeta

**Files:**
- Modify: `src/worker.ts` (add param interfaces and four methods)
- Test: `tests/worker-events.test.ts`

**Interfaces:**
- Consumes: `Client.post/get` (Task 7), Task 8's `Worker` class.
- Produces (on `client.worker`):
  - `hire(params: HireParams): Promise<unknown>` — `HireParams { givenName: string; familyName: string; birthDate: string; genderCode: string; ssn: string; lineOne: string; lineTwo?: string; cityName: string; stateCode: string; postalCode: string; hireDate: string; payrollGroupCode: string; eventReasonCode?: string }` (default `eventReasonCode: "NEW"`).
  - `rehire(params: RehireParams): Promise<unknown>` — `RehireParams { associateOID: string; rehireDate: string; effectiveDate: string; reasonCode?: string }` (default `"IMPORT"`).
  - `terminate(params: TerminateParams): Promise<unknown>` — `TerminateParams { workAssignmentID: string; commentCode: string; terminationDate: string; reasonCode: string; rehireEligibleIndicator?: boolean; severanceEligibleIndicator?: boolean }` (both booleans default `true`).
  - `hireMeta(): Promise<unknown>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/worker-events.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient() {
  const { transport, calls } = makeFakeTransport([TOKEN_RESPONSE, { status: 200, json: { events: [] } }]);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport });
  return { client, calls };
}

const HIRE_PARAMS = {
  givenName: 'Renée',
  familyName: 'Duck',
  birthDate: '1990-01-01',
  genderCode: 'F',
  ssn: '111-22-3333',
  lineOne: '123 Maple Street',
  lineTwo: 'Apt 4',
  cityName: 'Minneapolis',
  stateCode: 'MN',
  postalCode: '55555',
  hireDate: '2026-08-01',
  payrollGroupCode: 'ABC',
};

describe('worker.hire', () => {
  it('posts the v1-compatible envelope with default eventReasonCode NEW', async () => {
    const { client, calls } = makeClient();

    await client.worker.hire(HIRE_PARAMS);

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.hire');
    const body = JSON.parse(calls[1].body!);
    const transform = body.events[0].data.transform;
    expect(transform.eventReasonCode.codeValue).toBe('NEW');
    expect(transform.worker.person.legalName).toEqual({ givenName: 'Renée', familyName1: 'Duck' });
    expect(transform.worker.person.governmentIDs[0]).toEqual({
      idValue: '111-22-3333',
      nameCode: { codeValue: 'SSN' },
    });
    expect(transform.worker.person.legalAddress.countrySubdivisionLevel1.codeValue).toBe('MN');
    expect(transform.worker.workAssignment).toEqual({ hireDate: '2026-08-01', payrollGroupCode: 'ABC' });
  });

  it('honors an eventReasonCode override', async () => {
    const { client, calls } = makeClient();
    await client.worker.hire({ ...HIRE_PARAMS, eventReasonCode: 'REHIRE' });
    expect(JSON.parse(calls[1].body!).events[0].data.transform.eventReasonCode.codeValue).toBe('REHIRE');
  });
});

describe('worker.rehire', () => {
  it('posts the v1-compatible envelope with default reasonCode IMPORT', async () => {
    const { client, calls } = makeClient();

    await client.worker.rehire({ associateOID: 'AAA', rehireDate: '2026-08-01', effectiveDate: '2026-08-01' });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.rehire');
    const transform = JSON.parse(calls[1].body!).events[0].data.transform;
    expect(transform.effectiveDateTime).toBe('2026-08-01');
    expect(transform.worker.associateOID).toBe('AAA');
    expect(transform.worker.workerDates.rehireDate).toBe('2026-08-01');
    expect(transform.worker.workerStatus.reasonCode.codeValue).toBe('IMPORT');
  });
});

describe('worker.terminate', () => {
  it('posts the v1-compatible envelope with eligible-indicator defaults', async () => {
    const { client, calls } = makeClient();

    await client.worker.terminate({
      workAssignmentID: 'WA1',
      commentCode: 'GROWTH',
      terminationDate: '2026-08-15',
      reasonCode: 'T',
    });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.work-assignment.terminate');
    const data = JSON.parse(calls[1].body!).events[0].data;
    expect(data.eventContext.worker.workAssignment.itemID).toBe('WA1');
    expect(data.transform.comment.commentCode.codeValue).toBe('GROWTH');
    const assignment = data.transform.worker.workAssignment;
    expect(assignment.terminationDate).toBe('2026-08-15');
    expect(assignment.lastWorkedDate).toBe('2026-08-15');
    expect(assignment.assignmentStatus.reasonCode.codeValue).toBe('T');
    expect(assignment.rehireEligibleIndicator).toBe(true);
    expect(assignment.severanceEligibleIndicator).toBe(true);
  });

  it('honors indicator overrides', async () => {
    const { client, calls } = makeClient();

    await client.worker.terminate({
      workAssignmentID: 'WA1',
      commentCode: 'GROWTH',
      terminationDate: '2026-08-15',
      reasonCode: 'T',
      rehireEligibleIndicator: false,
      severanceEligibleIndicator: false,
    });

    const assignment = JSON.parse(calls[1].body!).events[0].data.transform.worker.workAssignment;
    expect(assignment.rehireEligibleIndicator).toBe(false);
    expect(assignment.severanceEligibleIndicator).toBe(false);
  });
});

describe('worker.hireMeta', () => {
  it('GETs the hire event meta', async () => {
    const { client, calls } = makeClient();
    await client.worker.hireMeta();
    expect(calls[1].method).toBe('GET');
    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.hire/meta');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/worker-events.test.ts`
Expected: FAIL — `client.worker.hire is not a function`.

- [ ] **Step 3: Implement the event methods**

Add to `src/worker.ts` (param interfaces above the class, methods inside it):

```typescript
export interface HireParams {
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD */
  birthDate: string;
  genderCode: string;
  ssn: string;
  lineOne: string;
  lineTwo?: string;
  cityName: string;
  stateCode: string;
  postalCode: string;
  /** YYYY-MM-DD */
  hireDate: string;
  payrollGroupCode: string;
  /** Default "NEW". */
  eventReasonCode?: string;
}

export interface RehireParams {
  associateOID: string;
  /** YYYY-MM-DD */
  rehireDate: string;
  /** YYYY-MM-DD */
  effectiveDate: string;
  /** Default "IMPORT". */
  reasonCode?: string;
}

export interface TerminateParams {
  workAssignmentID: string;
  /** Lands in comment.commentCode.codeValue — a code, not free text. */
  commentCode: string;
  /** YYYY-MM-DD; also used as lastWorkedDate. */
  terminationDate: string;
  reasonCode: string;
  /** Default true. */
  rehireEligibleIndicator?: boolean;
  /** Default true. */
  severanceEligibleIndicator?: boolean;
}
```

Methods (inside `class Worker`):

```typescript
  hire(params: HireParams): Promise<unknown> {
    const { eventReasonCode = 'NEW' } = params;
    const data = {
      events: [
        {
          data: {
            transform: {
              eventReasonCode: { codeValue: eventReasonCode },
              worker: {
                person: {
                  governmentIDs: [{ idValue: params.ssn, nameCode: { codeValue: 'SSN' } }],
                  legalName: { givenName: params.givenName, familyName1: params.familyName },
                  legalAddress: {
                    nameCode: { codeValue: 'PersonalAddress1' },
                    lineOne: params.lineOne,
                    lineTwo: params.lineTwo,
                    cityName: params.cityName,
                    countrySubdivisionLevel1: { codeValue: params.stateCode },
                    countryCode: 'US',
                    postalCode: params.postalCode,
                  },
                  birthDate: params.birthDate,
                  genderCode: { codeValue: params.genderCode },
                },
                workAssignment: {
                  hireDate: params.hireDate,
                  payrollGroupCode: params.payrollGroupCode,
                },
              },
            },
          },
        },
      ],
    };
    return this.client.post('/events/hr/v1/worker.hire', data);
  }

  rehire(params: RehireParams): Promise<unknown> {
    const { reasonCode = 'IMPORT' } = params;
    const data = {
      events: [
        {
          data: {
            transform: {
              effectiveDateTime: params.effectiveDate,
              worker: {
                associateOID: params.associateOID,
                workerDates: { rehireDate: params.rehireDate },
                workerStatus: { reasonCode: { codeValue: reasonCode } },
              },
            },
          },
        },
      ],
    };
    return this.client.post('/events/hr/v1/worker.rehire', data);
  }

  terminate(params: TerminateParams): Promise<unknown> {
    const { rehireEligibleIndicator = true, severanceEligibleIndicator = true } = params;
    const data = {
      events: [
        {
          data: {
            eventContext: {
              contextExpressionID: '',
              worker: { workAssignment: { itemID: params.workAssignmentID } },
            },
            transform: {
              comment: { commentCode: { codeValue: params.commentCode } },
              worker: {
                workAssignment: {
                  terminationDate: params.terminationDate,
                  lastWorkedDate: params.terminationDate,
                  assignmentStatus: { reasonCode: { codeValue: params.reasonCode } },
                  rehireEligibleIndicator,
                  severanceEligibleIndicator,
                },
              },
            },
          },
        },
      ],
    };
    return this.client.post('/events/hr/v1/worker.work-assignment.terminate', data);
  }

  hireMeta(): Promise<unknown> {
    return this.client.get('/events/hr/v1/worker.hire/meta');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test && bun run typecheck`
Expected: full suite PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts tests/worker-events.test.ts
git commit -m "feat: hire/rehire/terminate/hireMeta with parameterized business codes"
```

---

### Task 10: WindmillTokenStore + public export surface

**Files:**
- Create: `src/token-store/windmill.ts`, `src/token-store/windmill-client.d.ts`
- Modify: `src/index.ts` (replace placeholder)
- Test: `tests/windmill-store.test.ts`, `tests/index.test.ts`

**Interfaces:**
- Consumes: `TokenStore`/`CachedToken` (Task 3).
- Produces:
  - `class WindmillTokenStore implements TokenStore` — `new WindmillTokenStore(variablePath: string)`; persists the `CachedToken` JSON in a Windmill variable via dynamic `import('windmill-client')`. NOT exported from `src/index.ts` — only via the `./windmill` subpath.
  - `src/index.ts` re-exports: `Client`, `ClientOptions`, `normalizePem`, `Worker`, `WorkerRecord`, `HireParams`, `RehireParams`, `TerminateParams`, `AdpError`, `AdpErrorArgs`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `raiseForAdp`, `MemoryTokenStore`, `TokenStore`, `CachedToken`, `AdpTransport`, `TransportInit`, `TransportTls`, `createBunTransport`, `createNodeTransport`.

- [ ] **Step 1: Write the failing Windmill-store test**

Create `tests/windmill-store.test.ts`:

```typescript
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getVariable = mock(async (_path: string): Promise<string | undefined> => undefined);
const setVariable = mock(async (_path: string, _value: string): Promise<void> => {});

mock.module('windmill-client', () => ({ getVariable, setVariable }));

import { WindmillTokenStore } from '../src/token-store/windmill.js';

describe('WindmillTokenStore', () => {
  beforeEach(() => {
    getVariable.mockClear();
    setVariable.mockClear();
    getVariable.mockResolvedValue(undefined);
  });

  it('reads and parses the interop JSON shape from the variable path', async () => {
    getVariable.mockResolvedValue('{"access_token":"tok","expires_at":1750000000}');
    const store = new WindmillTokenStore('u/some/path');

    expect(await store.get()).toEqual({ access_token: 'tok', expires_at: 1750000000 });
    expect(getVariable).toHaveBeenCalledWith('u/some/path');
  });

  it('returns undefined for empty or malformed variables', async () => {
    const store = new WindmillTokenStore('u/some/path');
    expect(await store.get()).toBeUndefined();

    getVariable.mockResolvedValue('not json');
    expect(await store.get()).toBeUndefined();

    getVariable.mockResolvedValue('{"access_token":"tok","expires_at":"2026-01-01T00:00:00Z"}');
    expect(await store.get()).toBeUndefined(); // ISO string violates the contract
  });

  it('writes the exact interop JSON shape', async () => {
    const store = new WindmillTokenStore('u/some/path');
    await store.set({ access_token: 'tok', expires_at: 1750000000 });

    expect(setVariable).toHaveBeenCalledWith('u/some/path', '{"access_token":"tok","expires_at":1750000000}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/windmill-store.test.ts`
Expected: FAIL — cannot resolve `../src/token-store/windmill.js`.

- [ ] **Step 3: Implement the store**

Create `src/token-store/windmill-client.d.ts`:

```typescript
declare module 'windmill-client' {
  export function getVariable(path: string): Promise<string | undefined>;
  export function setVariable(path: string, value: string): Promise<void>;
}
```

Create `src/token-store/windmill.ts`:

```typescript
import type { CachedToken, TokenStore } from './types.js';

/**
 * Persists the token in a Windmill variable so multiple scripts (and other
 * language clients) share one cache. `windmill-client` is provided by the
 * Windmill runtime — it is intentionally not a dependency of this package,
 * hence the dynamic import.
 */
export class WindmillTokenStore implements TokenStore {
  constructor(private readonly variablePath: string) {}

  async get(): Promise<CachedToken | undefined> {
    const wmill = await import('windmill-client');
    const raw = await wmill.getVariable(this.variablePath);
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as CachedToken).access_token === 'string' &&
        typeof (parsed as CachedToken).expires_at === 'number'
      ) {
        return parsed as CachedToken;
      }
    } catch {
      // fall through — treat unreadable cache as empty
    }
    return undefined;
  }

  async set(token: CachedToken): Promise<void> {
    const wmill = await import('windmill-client');
    await wmill.setVariable(
      this.variablePath,
      JSON.stringify({ access_token: token.access_token, expires_at: token.expires_at }),
    );
  }
}
```

- [ ] **Step 4: Write the export-surface test and index.ts**

Create `tests/index.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import * as api from '../src/index.js';

describe('public export surface', () => {
  it('exports the documented API', () => {
    expect(api.Client).toBeFunction();
    expect(api.Worker).toBeFunction();
    expect(api.normalizePem).toBeFunction();
    expect(api.AdpError).toBeFunction();
    expect(api.BadRequestError).toBeFunction();
    expect(api.UnauthorizedError).toBeFunction();
    expect(api.ForbiddenError).toBeFunction();
    expect(api.NotFoundError).toBeFunction();
    expect(api.raiseForAdp).toBeFunction();
    expect(api.MemoryTokenStore).toBeFunction();
    expect(api.createBunTransport).toBeFunction();
    expect(api.createNodeTransport).toBeFunction();
  });

  it('does NOT export WindmillTokenStore from the main entry', () => {
    expect('WindmillTokenStore' in api).toBe(false);
  });
});
```

Replace `src/index.ts` with:

```typescript
export { Client, normalizePem } from './client.js';
export type { ClientOptions } from './client.js';
export { Worker } from './worker.js';
export type { HireParams, RehireParams, TerminateParams, WorkerRecord } from './worker.js';
export {
  AdpError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  raiseForAdp,
} from './errors.js';
export type { AdpErrorArgs } from './errors.js';
export { MemoryTokenStore } from './token-store/memory.js';
export type { CachedToken, TokenStore } from './token-store/types.js';
export { createBunTransport } from './transport/bun.js';
export { createNodeTransport } from './transport/node.js';
export type { AdpTransport, TransportInit, TransportTls } from './transport/types.js';
```

- [ ] **Step 5: Run all verifications**

Run: `bun test && bun run typecheck && npm run test:node`
Expected: full Bun suite PASS (including both new files), typecheck clean, Node tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/token-store/windmill.ts src/token-store/windmill-client.d.ts src/index.ts tests/windmill-store.test.ts tests/index.test.ts
git commit -m "feat: WindmillTokenStore behind ./windmill subpath; public export surface"
```

---

### Task 11: Public-repo hygiene, live smoke test, delete v1

**Files:**
- Modify: `tests/fixtures/**` (value-only sanitization), `.gitignore`, `CLAUDE.md`, `README.md`
- Create: `CLAUDE.local.md` (gitignored — never committed), `tests/integration/live.test.ts`
- Delete: `lib/`, `tests/worker.test.js`, `tests/client.unit.test.js`, `tests/client.integration.test.js`

**Interfaces:**
- Consumes: the full v2 API (`Client`, `client.worker.one`) and the green suite from Tasks 1–10.
- Produces: a tree with no tenant-identifying strings in committed files, an env-gated live smoke test, and no v1 code.

- [ ] **Step 1: Sanitize fixture values**

Replace real identifiers across all fixture files (values only — never change JSON structure or message-text meaning):

```bash
cd tests/fixtures
grep -rl 'G30PZF2MFRV7184Y' . | xargs sed -i 's/G30PZF2MFRV7184Y/G0FAKEFAKEFAKE1A/g'
grep -rl 'G3BJDMRVTTP9GTMX' . | xargs sed -i 's/G3BJDMRVTTP9GTMX/G0FAKEFAKEFAKE2B/g'
grep -rl 'OuzqBm6XhM3xqMfbzkelC5jFFMA=' . | xargs sed -i 's|OuzqBm6XhM3xqMfbzkelC5jFFMA=|FAKESESSIONFAKESESSIONFAKE0=|g'
grep -rl 'pulsar-marketplace-prod.es.oneadp.com' . | xargs sed -i 's/pulsar-marketplace-prod.es.oneadp.com/wfn.example.invalid/g'
cd ../..
```

Then verify nothing real remains and the corpus still drives the tests:

```bash
grep -rn 'G30PZF2MFRV7184Y\|G3BJDMRVTTP9GTMX\|OuzqBm6Xh\|oneadp.com' tests/fixtures/ ; echo "grep exit: $?"
bun test
```

Expected: grep exit 1 (no matches); full suite still PASS (the already-terminated test uses `toContain('is already terminated')`, which survives ID replacement).

- [ ] **Step 2: Split CLAUDE.md**

1. Add to `.gitignore` (new section at the end):

```
# Private, machine-local agent context — never commit
CLAUDE.local.md
```

2. Create `CLAUDE.local.md` by MOVING (not copying) every environment- and tenant-specific detail out of the current `CLAUDE.md`: the deployment-workspace names and identifiers, resource/variable paths tied to that workspace, the sibling Python client specifics, and any company references. This file is local-only context; it is never committed. (The identifiers are deliberately not reproduced in this plan — the executor takes them from the current `CLAUDE.md` in the working tree.)

3. Rewrite `CLAUDE.md` to keep only generic, public-safe content: project purpose (public TS/Bun+Node ADP Workforce Now client), the spec pointer (`docs/superpowers/specs/2026-07-10-v2-core-migration-design.md`), ADP API notes (endpoints, event envelope, error shapes, meta behavior — nothing tenant-specific), the token-cache interop contract in generic terms ("other-language clients may share the cache"), style rules (zero deps, no secrets in logs, fake PEMs in fixtures), and testing commands (`bun test`, `npm run test:node`). Verify before committing:

```bash
# COMPANY = the company identifier recorded at the top of CLAUDE.local.md
grep -in "COMPANY" CLAUDE.md .gitignore README.md package.json; echo "exit: $?"
```

Expected: exit 1 (no matches). Record the identifier as the first line of
`CLAUDE.local.md` so this and Step 6's sweep know what to search for.

- [ ] **Step 3: Rewrite README.md**

Replace the entire `README.md` with:

````markdown
# adp-workforce-now

TypeScript client for [ADP Workforce Now](https://developers.adp.com/): mTLS
transport, lazy OAuth client-credentials auth, typed errors, paginated worker
reads, and lifecycle events (hire / rehire / terminate).

Runs on **Bun ≥ 1.2** (tested on 1.3) and **Node ≥ 20**. Zero runtime
dependencies.

## Install

```bash
npm install @craibuc/adp-workforce-now
# or
bun add @craibuc/adp-workforce-now
```

## Usage

```typescript
import { Client } from '@craibuc/adp-workforce-now';

// PEM strings may be raw or base64-encoded (auto-detected).
const client = new Client(certificatePem, privateKeyPem, {
  credentials: { client_id, client_secret }, // lazy auto-auth + 401 retry
});

const worker = await client.worker.one('G0FAKEFAKEFAKE1A');

for await (const page of client.worker.pages()) {
  console.log(page.length);
}

const match = await client.worker.find((w) => w.associateOID === 'G0FAKEFAKEFAKE1A');
```

ADP requires mutual TLS on every call, including the token endpoint. Keys and
certificates are kept in memory only.

### Masked data

GET responses arrive with government IDs masked by default. To receive
unmasked values (requires appropriate ADP scopes):

```typescript
const client = new Client(cert, key, { credentials, masked: false });
```

### Errors

All non-2xx responses throw a subclass of `AdpError` carrying `statusCode`,
`endpoint`, ADP's human-readable `adpMessage`, machine-readable `adpCode`,
and the `raw` body:

```typescript
import { AdpError, BadRequestError } from '@craibuc/adp-workforce-now';

try {
  await client.worker.rehire({ associateOID, rehireDate, effectiveDate });
} catch (error) {
  if (error instanceof BadRequestError && error.adpCode === 'API_REHIRE_EE_ALREADY_ACTIVE') {
    // already active — treat as success
  } else {
    throw error;
  }
}
```

### Token stores

Tokens are cached via a pluggable `TokenStore` (default: in-memory). The
cached JSON shape is `{"access_token": string, "expires_at": number}` with
`expires_at` in epoch seconds UTC — a cross-language contract shared with
other clients.

On [Windmill](https://www.windmill.dev/), share one token across scripts:

```typescript
import { WindmillTokenStore } from '@craibuc/adp-workforce-now/windmill';

const client = new Client(cert, key, {
  credentials,
  tokenStore: new WindmillTokenStore('f/adp/access_token_cache'),
});
```

## Development

```bash
bun install
bun test            # unit tests (Bun)
npm run test:node   # Node adapter tests against a local mTLS server
bun run typecheck
```

### Live integration test

Copy `.env.sample` to `.env` and fill in real ADP credentials (base64-encode
the PEMs). The live test then runs as part of `bun test`; without the
variables it is skipped.

## License

ISC
````

- [ ] **Step 4: Add the env-gated live smoke test**

Create `tests/integration/live.test.ts`:

```typescript
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
    const worker = await liveClient().worker.one(ADP_ASSOCIATE_OID!);
    expect(worker?.associateOID).toBe(ADP_ASSOCIATE_OID!);
  }, 15000);
});
```

Run: `bun test tests/integration/live.test.ts`
Expected: tests reported as skipped (no credentials in this environment). That is the pass condition here; the real run happens later with credentials.

- [ ] **Step 5: Delete v1**

```bash
git rm -r lib/
git rm tests/worker.test.js tests/client.unit.test.js tests/client.integration.test.js
```

- [ ] **Step 6: Full verification**

```bash
bun test && bun run typecheck && npm run test:node
# COMPANY = the identifier from CLAUDE.local.md's first line (see Task 11 Step 2)
grep -rin "COMPANY" --exclude-dir=.git --exclude-dir=node_modules --exclude=CLAUDE.local.md . ; echo "grep exit: $?"
git status --short   # confirm CLAUDE.local.md shows as ignored (absent), not staged
```

Expected: all suites PASS; grep exit 1; `CLAUDE.local.md` not in `git status` output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: public-repo hygiene — sanitized fixtures, scrubbed CLAUDE.md, v2 README, live smoke test; remove v1"
```

---

## Post-plan verification (manual, outside this plan)

1. Live smoke test with real credentials on the target Bun version (Bun had client-cert bugs into early 2025) — validates the token-endpoint host fix and Bun's mTLS.
2. During that smoke test, confirm what ADP expects in `comment.commentCode.codeValue` on terminate.
3. Publishing to npm and any deployment require the maintainer's explicit approval — not part of this plan.
