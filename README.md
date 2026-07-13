# adp-workforce-now

TypeScript client for [ADP Workforce Now](https://developers.adp.com/): mTLS
transport, lazy OAuth client-credentials auth, typed errors, paginated worker
reads, and lifecycle events (hire / rehire / terminate).

Runs on **Bun ≥ 1.2** (tested on 1.3) and **Node ≥ 20**. Zero runtime
dependencies (one optional-integration peer, `windmill-client`, is only
ever loaded by the `./windmill` token store).

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

// keyed lookup — one worker or undefined
const byAoid = await client.worker.get('G0FAKEFAKEFAKE1A');
const bySsn = await client.worker.get({ ssn: '123-45-6789' });

// search() is LAZY: it fetches nothing until you call a method on it
const search = client.worker.search({ familyName: 'Duck', status: 'A' });

const page = await search.page(0);       // one request — { workers, index, done, next }
for await (const p of search.pages()) {  // stream — one request per iteration
  console.log(p.workers.length, p.done);
}
```

Early-exit scan recipe (test each worker with arbitrary code, stop at the
first hit — this is what the deprecated `.find()` does internally):

```typescript
async function findByEmployeeNumber(id: string) {
  for await (const { workers } of client.worker.search({ status: 'A' }).pages()) {
    const match = workers.find((w) => (w.workerID as { idValue?: string } | undefined)?.idValue === id);
    if (match) return match;
  }
}
```

Flow-engine loops (e.g. a Windmill while-loop, one iteration per page): call
`search(query).page(n)` each iteration and loop on `done` — **never on
`workers.length`**, which can be 0 mid-stream when client-side residual
filters (e.g. the second name in a two-name query) empty a page.

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

### Event validation

Event POSTs are validated client-side against the event's metadata
(`GET /events/hr/v1/{event}/meta`, cached (default 12 h)) before anything is
sent — but only **code-list violations block the request**: a tenant
reason/type code that isn't in the allowed list fails fast with a readable
`EventValidationError` naming the allowed codes, instead of an opaque ADP
400. Other meta constraints (`required`, `readOnly`, `hidden`, `pattern`)
are computable via `eventMeta()` + `validateEnvelope()` for diagnostics, but
never block a POST — live verification against real tenant metas showed
ADP overdeclares those constraints on fields that battle-tested envelopes
have always sent successfully. On an ADP 400, the meta is refreshed once
and re-checked (self-healing after tenant validation-table edits, still
code-list-only); the request is never re-sent. When that self-heal upgrades
a stale-cache failure into an `EventValidationError`, the error's `cause`
is the original `BadRequestError` ADP returned. If an event's meta endpoint
is itself unavailable (some tenants return errors for specific metas),
validation is skipped and the request proceeds — the server remains the
authority. Opt out with:

```typescript
const client = new Client(cert, key, { credentials, validateEvents: false });
```

Any `worker.*` event not yet wrapped can use the same pipeline directly:

```typescript
await client.worker.postEvent('worker.work-assignment.modify', envelope);
```

### Event notifications

ADP's event-notification queue delivers subscribed events **one message at a
time**: `next()` returns the head of the queue — the *same* message until you
acknowledge it — and `delete(messageId)` is the acknowledgment that makes the
next message available. Delete after successful processing and you get
at-least-once semantics. Empty values are `null` (not `undefined`) so
flow-step results survive JSON serialization.

```typescript
// Process up to 50 queued notifications:
for (let i = 0; i < 50; i++) {
  const message = await client.eventNotifications.next();
  if (message === null) break;              // queue empty
  await handle(message.payload);            // your logic
  await client.eventNotifications.delete(message.messageId); // ack -> advances queue
}
```

In a Windmill flow, each iteration can be its own loop step — the queue holds
the position, so there is no index to carry between iterations.

Header-dependent endpoints like this one are built on the `client.raw`
escape hatch (`raw(method, path, data?)` → `{ status, headers, body }`),
which is public and carries the same auth, mTLS, retry, and typed-error
semantics as `get`/`post`.

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

## API coverage

Endpoint → `Class.method` mapping. `Worker` methods are reached via
`client.worker`; anything not wrapped yet is reachable through the
`Client.get` / `Client.post` escape hatches (auth, mTLS, and error
extraction still apply).

| Status | ADP endpoint | Library API | Description |
|:---:|---|---|---|
| ✅ | `POST accounts.adp.com/auth/oauth/v2/token` | `Client.authenticate` | OAuth client-credentials token over mTLS; called lazily on any request, cached in the `TokenStore`, refreshed 300 s before expiry |
| ✅ | `GET /hr/v2/workers` (`$top`/`$skip`, single `$filter` predicate) | `Worker.search` → `page` / `pages` (`all` / `find` deprecated) | Lazy search handle; stateless `WorkerPage {workers, index, done, next}` protocol; extra query fields filtered client-side (ADP's compound name filters are broken server-side) |
| ✅ | `GET /hr/v2/workers/{aoid}` | `Worker.get` | Fetch a single worker by associate OID (string or `{ aoid }`) |
| ✅ | `POST /events/hr/v1/worker.read` | `Worker.get({ ssn })` | Look up a single worker by government ID; ADP's read-event filter supports IDs but not name paths |
| ✅ | `POST /events/hr/v1/worker.hire` | `Worker.hire` | Hire a new worker (legal name, SSN, address, hire date, payroll group) |
| ✅ | `POST /events/hr/v1/worker.rehire` | `Worker.rehire` | Rehire a terminated worker as of an effective date |
| ✅ | `POST /events/hr/v1/worker.work-assignment.terminate` | `Worker.terminate` | Terminate a work assignment (reason code, termination/last-worked date, eligibility indicators) |
| ✅ | any other endpoint | `Client.get`, `Client.post` | Escape hatch for unwrapped endpoints — auth, mTLS, and typed-error extraction still apply |
| ✅ | any endpoint (with headers) | `Client.raw` | Escape hatch returning { status, headers, body } — same auth/retry/error semantics |
| ✅ | `POST /events/hr/v1/worker.work-assignment.base-remuneration.change` | `Worker.changeBaseRemuneration` | Change a worker's pay rate (hourly/daily/salary) as of an effective date |
| ✅ | `GET  /events/hr/v1/{event}/meta` | `Worker.eventMeta` (+ `Worker.postEvent` pipeline) | Event metadata for any worker.* event, cached (default 12 h); powers client-side envelope validation |
| ✅ | `POST /events/hr/v1/worker.legal-name.change` | `Worker.changeLegalName` | Change a worker's legal name as of an effective date |
| ✅ | `POST /events/hr/v1/worker.person.custom-field.string.change` | `Worker.changeCustomFieldString` | Change a string-typed custom field on a worker's record |
| ✅ | `POST /events/hr/v1/worker.leave.absence.request` | `Worker.requestLeaveAbsence` | Request a leave of absence (leave-type code, start/expected-return dates) |
| ✅ | `GET /core/v1/event-notification-messages` | `EventNotifications.next` | Head of the event-notification queue ({ messageId, payload }, null when empty); same message until deleted |
| ✅ | `DELETE /core/v1/event-notification-messages/{id}` | `EventNotifications.delete` | Acknowledge a message (echoes the deleted record); advances the queue |
| 🔜 | `GET /hr/v2/workers/{aoid}/worker-images/photo` + `POST /events/hr/v1/worker.photo.upload` | v2.4 | Read and upload a worker's photo |
| ⬜ | `POST /events/hr/v1/worker.work-assignment.modify` | roadmap | Modify an existing work assignment |
| ⬜ | contact-info change events | roadmap | Change a worker's phone/email contact info |
| ⬜ | address change events | roadmap | Change a worker's home/mailing address |
| ⬜ | `POST /events/hr/v1/worker.pay-distribution.change` | roadmap | Change a worker's pay distribution (direct deposit accounts) |
| ⬜ | legacy worker-profile v1 `PUT` endpoints | not planned | Superseded by the event-based writes above |

✅ implemented (2.0.0–3.1.0) · 🔜 planned (version noted per row) · ⬜ roadmap / no current plans — PRs welcome

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
