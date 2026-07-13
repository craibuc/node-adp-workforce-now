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
| ✅ | `GET /events/hr/v1/worker.hire/meta` | `Worker.hireMeta` | Hire-event metadata (field constraints, code lists) — raw passthrough |
| ✅ | `POST /events/hr/v1/worker.rehire` | `Worker.rehire` | Rehire a terminated worker as of an effective date |
| ✅ | `POST /events/hr/v1/worker.work-assignment.terminate` | `Worker.terminate` | Terminate a work assignment (reason code, termination/last-worked date, eligibility indicators) |
| ✅ | any other endpoint | `Client.get`, `Client.post` | Escape hatch for unwrapped endpoints — auth, mTLS, and typed-error extraction still apply |
| 🔜 | `POST /events/hr/v1/worker.work-assignment.base-remuneration.change` | `Worker.changeBaseRemuneration` | Change a worker's pay rate (hourly/daily/salary) as of an effective date |
| 🔜 | `GET  /events/hr/v1/worker.work-assignment.base-remuneration.change/meta` | planned | Event metadata with tenant-level caching; used to validate payloads client-side before POSTing |
| ⬜ | `GET /core/v1/event-notification-messages` | unplanned | Event-notification queue (one message per call; delete handle in a response header) |
| ⬜ | legacy worker-profile v1 `PUT` endpoints | not planned | Superseded by the event-based writes above |

✅ implemented (2.0.0) · 🔜 planned (next milestone) · ⬜ no current plans — PRs welcome

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
