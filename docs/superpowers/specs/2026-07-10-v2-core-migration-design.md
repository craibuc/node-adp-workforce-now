# adp-workforce-now v2 — Core Migration Design

**Date:** 2026-07-10
**Status:** Approved
**Scope:** Milestone 1 of the TypeScript/Bun migration: toolchain, transport,
auth/token stores, centralized errors, and the existing worker domain methods.
Meta validation and the base-remuneration change event are milestone 2.

## Context and goals

`@craibuc/adp-workforce-now` v1 is a CommonJS Node library (hand-rolled
`https.request`, babel + jest) for ADP Workforce Now. v2 is a clean break: a
public TypeScript/ESM npm package that runs on Bun and Node, with zero runtime
dependencies. The v1 architecture is sound and is adapted, not rewritten: a
`Client` owning transport/auth with domain namespaces hanging off it
(`client.worker.one(aoid)`), and typed errors.

Decisions made during design review:

- **Clean break (v2).** No compatibility shims for v1 signatures.
- **Public npm, same name** (`@craibuc/adp-workforce-now` v2.0.0), public
  GitHub repo. No employer- or tenant-identifying content anywhere in the repo.
- **In-place replace** on a feature branch: `src/*.ts` + `bun test` replace
  `lib/` + jest/babel/nock in one reviewed migration. v1 remains in git history.
- **Transport seam with both Bun and Node adapters** shipped from day one.

## Bugs in v1 fixed by this design

1. `package.json` depends on the npm stub package `"https"` — removed.
2. `Worker.all()` pagination is commented out and silently returns one page —
   replaced by an `AsyncGenerator`.
3. `Content-Length: body.length` is wrong for multi-byte UTF-8 — fetch computes
   it correctly.
4. `authenticate()` posts the token request to `api.adp.com`; ADP's token
   endpoint is `https://accounts.adp.com/auth/oauth/v2/token` — fixed
   (pending one live verification, see Testing).
5. Error matching via `error.message == '400'` string comparison — replaced by
   numeric status handling in one extractor.
6. Hardcoded business values in hire/rehire/terminate — promoted to parameters
   with the current values as defaults.

## Package & layout

TypeScript, ESM, `"type": "module"`, zero runtime dependencies.

```
src/
  index.ts              # public exports
  client.ts             # Client: auth, request orchestration, get/post
  worker.ts             # Worker domain namespace
  errors.ts             # AdpError + subclasses, raiseForAdp() extractor
  transport/
    types.ts            # AdpTransport interface
    bun.ts              # fetch + Bun tls option
    node.ts             # fetch + undici Agent
  token-store/
    types.ts            # TokenStore interface + CachedToken shape
    memory.ts           # MemoryTokenStore
    windmill.ts         # WindmillTokenStore (dynamic-imports windmill-client)
```

`package.json` `exports` map: `.` (main entry) and `./windmill` (Windmill token
store), so importing the main package never touches `windmill-client`.
`windmill-client` is not a dependency; the Windmill runtime provides it, and
the adapter loads it via dynamic import. Types and JS for Node consumers are
emitted to `dist/` by `tsc` in `prepublishOnly`; Bun consumers and the test
suite run the TS source directly. Deleted: `.babelrc`, babel deps, jest, nock,
`lib/`.

## Transport

The mTLS client-certificate handshake is the only runtime-specific code; each
runtime attaches client certs to fetch differently. It sits behind a seam:

```typescript
interface AdpTransport {
  request(url: string, init: RequestInit & { body?: string }): Promise<Response>;
}
```

- **Bun adapter:** `fetch(url, { ...init, tls: { cert, key } })`.
- **Node adapter:** `fetch(url, { ...init, dispatcher })` with an undici
  `Agent({ connect: { cert, key } })`.
- `Client` auto-detects the runtime at construction
  (`typeof Bun !== 'undefined'`); an explicit `transport` option overrides,
  which is also the mock seam for tests.
- Certificates and keys are in-memory PEM strings, never written to disk. The
  constructor accepts raw PEM or base64-encoded PEM, auto-detected by the
  `-----BEGIN` prefix (base64 is the `.env` convention because docker
  `--env-file` cannot carry multi-line values).

## Client

```typescript
const client = new Client(certificatePem, privateKeyPem, {
  credentials: { client_id, client_secret },   // enables lazy auto-auth
  tokenStore,                                  // default: new MemoryTokenStore()
  transport,                                   // default: auto-detected
  // apiBaseUrl / tokenUrl overridable for testing
});
```

- `request()` acquires the token lazily: ask the store; if the cached token is
  still valid past a 300-second refresh margin, use it; otherwise authenticate
  (`POST https://accounts.adp.com/auth/oauth/v2/token`,
  `grant_type=client_credentials`, mTLS required) and write back to the store.
- **Exactly one force-refresh retry on 401:** refresh the token, replay the
  request once; a second 401 throws `UnauthorizedError`.
- **204 responses return `undefined`** to the caller — never thrown. Callers
  rely on this for end-of-pages and empty-queue semantics.
- API base is `https://api.adp.com`.
- Tokens, client secrets, and PEM contents never appear in logs or error
  messages.

## Token stores

```typescript
interface TokenStore {
  get(): Promise<CachedToken | undefined>;
  set(token: CachedToken): Promise<void>;
}
type CachedToken = { access_token: string; expires_at: number };
```

`expires_at` is **epoch seconds UTC** — a number, never an ISO string. This
exact JSON shape is a cross-language interop contract: other clients (e.g. a
Python client in the same environment) may share the same cache, and ISO
serialization differs between languages. Do not change it unilaterally.

- **MemoryTokenStore:** in-process; default; used by tests.
- **WindmillTokenStore:** reads/writes a Windmill variable via
  `wmill.getVariable`/`setVariable` (env `WM_TOKEN`/`BASE_URL` exist inside
  workers). The variable path is a constructor argument — no tenant-specific
  defaults are baked into the library.
- Concurrent refresh races are benign: ADP client-credentials tokens do not
  invalidate each other; last write wins. Token lifetime is ~3600 s.

## Errors

```typescript
class AdpError extends Error {
  statusCode: number;
  endpoint: string;    // e.g. "POST /events/hr/v1/worker.rehire"
  adpMessage?: string; // human-readable text, any of the 3 shapes
  adpCode?: string;    // machine-readable, e.g. "API_REHIRE_EE_ALREADY_ACTIVE"
  raw?: unknown;       // original response body
}
// BadRequestError (400) | UnauthorizedError (401) | ForbiddenError (403) |
// NotFoundError (404) extend AdpError

function raiseForAdp(status: number, json: unknown, endpoint: string): never;
```

The hierarchy is shallow and status-based; semantic branching ("already
active", "already terminated") happens on the `adpCode` field, not via
subclasses — ADP's error codes come from tenant validation tables and are
open-ended, so a class per code would never be complete. Callers get three
levels of granularity: catch `AdpError` (any API failure), catch a status
subclass, or branch on `adpCode`.

`raiseForAdp` maps the numeric status to an error class and extracts
`adpMessage`/`adpCode` by trying ADP's three known error shapes in order:

1. `response.applicationCode.message` (newer APIs)
2. `confirmMessage.resourceMessages[0].processMessages[0].userMessage.messageTxt`
   for `adpMessage`, plus `processMessageID.idValue` for `adpCode` (legacy)
3. `exceptionMessages[0].message` (terminate and some events)

If no shape matches, the error still carries `statusCode`, `endpoint`, and
`raw`. **Unmapped statuses (e.g. 429, 5xx) throw the base `AdpError`** with
`statusCode` set — never a bare `Error`. Additional subclasses (e.g. a rate
limit class) can be added later without breaking consumers, since every error
already extends `AdpError`. The recorded payloads in `tests/fixtures/**` are the test corpus.
`worker.one()` keeps its friendly message for ADP's quirk of returning 403 for
a nonexistent AOID, now as a structured `ForbiddenError`.

## Worker domain

- `one(aoid)` — `GET /hr/v2/workers/{aoid}`, returns `workers[0]`.
- `pages(pageSize = 100)` — `AsyncGenerator` over `GET /hr/v2/workers` using
  `$top`/`$skip`, yielding each page's workers, stopping on 204/`undefined`.
- `all()` — `for await` accumulation over `pages()` (convenience; unbounded
  memory usage documented).
- `find(predicate)` — iterates pages, returns the first match, early exit.
- `hire`, `rehire`, `terminate` — same event envelopes as v1, with previously
  hardcoded business values promoted to parameters defaulting to the v1
  values: hire `eventReasonCode = "NEW"`; rehire `reasonCode = "IMPORT"`;
  terminate `rehireEligibleIndicator = true`,
  `severanceEligibleIndicator = true`.
- `hireMeta()` — raw passthrough of `GET /events/hr/v1/worker.hire/meta`.
  (Meta caching/validation is milestone 2.)

## Public-repo hygiene (in scope for this milestone)

- CLAUDE.md is reduced to generic project/API/ADP guidance; environment- and
  tenant-specific details move to a gitignored `CLAUDE.local.md`.
- Fixture sanitization: personal fields are already fake; real associate OIDs,
  a real session ID, and an internal ADP hostname are replaced with
  obviously-fake equivalents. JSON structure is untouched so the
  error-extractor corpus stays faithful.
- README rewritten for v2: install, construction, runtime support (Bun ≥ 1.2,
  tested on 1.3; Node ≥ 20), `.env` setup for integration tests.

## Testing

- Unit tests ported to `bun test` (near drop-in from jest). Mocking happens at
  the `transport` constructor-injection seam.
- Error extractor: one test per fixture file, asserting class, `statusCode`,
  `adpMessage`, and `adpCode` where present; plus an unmapped-status case
  (e.g. 429) asserting the base `AdpError` fallback.
- Pagination: fake transport returning two pages then 204. 401 retry: fake
  transport that 401s once then succeeds, and one that always 401s. UTF-8:
  POST body containing multi-byte characters.
- One `node --test` file exercising the Node transport adapter so Node support
  is verified, not assumed.
- Live integration test (token endpoint + mTLS handshake) is gated on
  `ADP_CLIENT_ID`/`ADP_CLIENT_SECRET`/`ADP_CERTIFICATE`/`ADP_PRIVATE_KEY` env
  vars and skipped when absent. **Before first production use, run it once on
  the target Bun version** — Bun had client-certificate bugs into early 2025 —
  and confirm the corrected token-endpoint host against the live API.

## Out of scope (milestone 2+)

- Event meta fetch/cache and client-side payload validation.
- `worker.work-assignment.base-remuneration.change` domain method.
- Publishing to npm and any deployment — both require the maintainer's
  explicit approval.
