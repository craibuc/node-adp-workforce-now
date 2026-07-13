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
| ✅ | `GET /hr/v2/workers` (`$top`/`$skip` paging) | `Worker.pages`, `Worker.all`, `Worker.find` | List workers: lazy page iterator, full accumulation, or first-match search with early exit |
| ✅ | `GET /hr/v2/workers/{aoid}` | `Worker.one` | Fetch a single worker by associate OID |
| ✅ | `POST /events/hr/v1/worker.hire` | `Worker.hire` | Hire a new worker (legal name, SSN, address, hire date, payroll group) |
| ✅ | `GET /events/hr/v1/worker.hire/meta` | `Worker.hireMeta` | Hire-event metadata (field constraints, code lists) — raw passthrough (deprecated — use `Worker.eventMeta`) |
| ✅ | `POST /events/hr/v1/worker.rehire` | `Worker.rehire` | Rehire a terminated worker as of an effective date |
| ✅ | `POST /events/hr/v1/worker.work-assignment.terminate` | `Worker.terminate` | Terminate a work assignment (reason code, termination/last-worked date, eligibility indicators) |
| ✅ | any other endpoint | `Client.get`, `Client.post` | Escape hatch for unwrapped endpoints — auth, mTLS, and typed-error extraction still apply |
| ✅ | `POST /events/hr/v1/worker.work-assignment.base-remuneration.change` | `Worker.changeBaseRemuneration` | Change a worker's pay rate (hourly/daily/salary) as of an effective date |
| ✅ | `GET  /events/hr/v1/{event}/meta` | `Worker.eventMeta` (+ `Worker.postEvent` pipeline) | Event metadata for any worker.* event, cached (default 12 h); powers client-side envelope validation |
| ✅ | `POST /events/hr/v1/worker.legal-name.change` | `Worker.changeLegalName` | Change a worker's legal name as of an effective date |
| ✅ | `POST /events/hr/v1/worker.person.custom-field.string.change` | `Worker.changeCustomFieldString` | Change a string-typed custom field on a worker's record |
| ✅ | `POST /events/hr/v1/worker.leave.absence.request` | `Worker.requestLeaveAbsence` | Request a leave of absence (leave-type code, start/expected-return dates) |
| 🔜 | `GET /core/v1/event-notification-messages` | `EventNotifications.next` / `delete` (`client.eventNotifications`, v2.2) | Event-notification queue (one message per call; delete handle in a response header) |
| 🔜 | `GET /hr/v2/workers?$filter=…` | `Worker.findByName` (v2.2) | Server-side filtered search by worker name |
| 🔜 | client-side SSN lookup | `Worker.findBySSN` (v2.2) | Search workers by SSN (client-side match over paged results) |
| 🔜 | `GET /hr/v2/workers/{aoid}/worker-images/photo` + `POST /events/hr/v1/worker.photo.upload` | v2.3 | Read and upload a worker's photo |
| ⬜ | `POST /events/hr/v1/worker.work-assignment.modify` | roadmap | Modify an existing work assignment |
| ⬜ | contact-info change events | roadmap | Change a worker's phone/email contact info |
| ⬜ | address change events | roadmap | Change a worker's home/mailing address |
| ⬜ | `POST /events/hr/v1/worker.pay-distribution.change` | roadmap | Change a worker's pay distribution (direct deposit accounts) |
| ⬜ | legacy worker-profile v1 `PUT` endpoints | not planned | Superseded by the event-based writes above |

✅ implemented (2.0.0–2.1.0) · 🔜 planned (version noted per row) · ⬜ roadmap / no current plans — PRs welcome

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
