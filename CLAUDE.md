# CLAUDE.md

## What this project is

A TypeScript/Bun-first client library for the [ADP Workforce Now](https://developers.adp.com/)
API, runnable on Bun and Node. It grew out of a migration from an older
CommonJS/Node-`https` implementation; the full migration design and rationale
live in [`docs/superpowers/specs/2026-07-10-v2-core-migration-design.md`](docs/superpowers/specs/2026-07-10-v2-core-migration-design.md).

- `Client` = transport (mTLS, auth, HTTP) with domain namespaces hanging off
  it (`client.worker.get(aoid)`, `client.worker.hire({...})`).
- Typed errors (`BadRequestError`, `UnauthorizedError`, `ForbiddenError`,
  `NotFoundError`) carry structured fields (`statusCode`, `adpMessage`,
  `adpCode`, `endpoint`), not just formatted strings.
- `tests/fixtures/` contains recorded (sanitized) ADP error payloads covering
  all three error shapes ADP returns — treat these as the corpus for the
  centralized error extractor; never restructure them casually.
- A transport seam (`AdpTransport`) keeps auth, token stores, error handling,
  domain methods, and payload validation runtime-neutral; only the transport
  adapter (Bun `fetch`+`tls`, Node `node:https`, potentially Deno) is
  runtime-specific.

## ADP Workforce Now API notes (hard-won specifics)

- **mTLS is required on every call** (token endpoint included), PEM cert+key.
- Token: `POST https://accounts.adp.com/auth/oauth/v2/token`,
  `grant_type=client_credentials`. API base: `https://api.adp.com`.
- **Event-based write pattern** (current, per API Explorer — NOT the legacy
  worker-profile v1 PUT):
  - change: `POST /events/hr/v1/worker.work-assignment.base-remuneration.change`
  - meta:   `GET  /events/hr/v1/worker.work-assignment.base-remuneration.change/meta`
  - CAR scope: `hr/workerInformationManagement/workerManagement/workAssignmentManagement/worker.workAssignment.baseRemuneration.change`
- Event envelope: `{ events: [{ data: { eventContext: {...}, transform: {...} } }] }`.
  For base-remuneration: `eventContext.worker.associateOID` +
  `eventContext.worker.workAssignment.itemID`; transform carries
  `effectiveDateTime` (YYYY-MM-DD), `eventReasonCode.codeValue`, and
  `workAssignment.baseRemuneration.{hourlyRateAmount|dailyRateAmount|payPeriodRateAmount}`
  with `{ nameCode.codeValue (H/D/S), amountValue, currencyCode }`.
  This API family uses **`amountValue`** (matches Workers v2 GET reads), unlike
  the legacy PUT's `amount`.
- Assignment ID: from `GET /hr/v2/workers/{aoid}` →
  `workAssignments[].itemID`. **Filter `primaryIndicator === true`** (and
  active `assignmentStatus`) — never take index 0 blindly.
- `effectiveDate` is chosen by the caller (usually next pay period start), not
  read from anywhere; backdating does NOT auto-calculate retro pay.
- **Workers v2 `$filter`** (recorded working examples, values sanitized):
  - by status: `$filter=workers/workAssignments/assignmentStatus/statusCode/codeValue eq 'T'`
  - by last name: `$filter=workers/person/legalName/familyName1 eq 'Last'`
  - by first name: `$filter=workers/person/legalName/givenName eq 'First'`
  - by org unit (compound `and` WITHIN one param — observed working):
    `$filter=workers/workAssignments/homeOrganizationalUnits/typeCode/codeValue eq 'Department' and workers/workAssignments/homeOrganizationalUnits/nameCode/codeValue eq '000001'`
  - **Gotcha:** sending TWO separate `$filter=` query params does NOT combine
    them — one is silently ignored. Compound `and` INSIDE one param works for
    org-unit fields but returns a 500 (`sp_filter` exception) for name-field
    combos (live-tested 2026-07-13) — which is why the library sends at most
    ONE server-side predicate and filters the rest client-side (see the v3
    spec's Evidence section).
  - `POST /events/hr/v1/worker.read` is an event-based lookup: its
    `transform.queryParameter` accepts `$filter` on `person/governmentIDs`
    (SSN lookup — powers `worker.get({ ssn })`) but rejects `legalName`
    paths (400 "queryParameter is invalid"). Its meta has a single
    overdeclared rule (`queryParameter` required+readOnly+hidden).
- **Meta validation**: event metas are tenant-level (not per-worker) → safe to
  cache 12–24 h. Meta maps JSON-pointer-ish paths → constraints:
  `optional`, `readOnly`, `hidden`, `codeList.listItems[].codeValue`,
  `pattern`, `minLength`/`maxLength`. Validate payloads client-side before
  POST; on an ADP 400, force-refresh meta and re-validate once (self-heals
  stale caches after validation-table edits on the ADP side).
  `eventReasonCode` values come from the tenant's Compensation Change Reasons
  validation table via the same event meta.
- Error response shapes to extract (all present in test fixtures):
  1. `response.applicationCode.message` (newer)
  2. `confirmMessage.resourceMessages[0].processMessages[0].userMessage.messageTxt`
     + `resourceMessageID.idValue` (legacy)
  3. `exceptionMessages[0].message` (terminate & some events)
- Known ADP quirks: invalid `premiumRateFactor` can return 200 instead of 400
  (legacy PUT); event-notification queue endpoint
  (`GET /core/v1/event-notification-messages`) returns one message per call
  with the delete handle in the `adp-msg-msgid` response header, 204 = empty.

## Token cache interop contract

Tokens are cached via a pluggable `TokenStore` (default: in-memory). Other
clients — potentially written in other languages, potentially running in a
shared workflow environment such as Windmill — may share the same cache, so
the on-the-wire JSON shape is a cross-language contract:

- JSON shape: `{"access_token": string, "expires_at": number}` —
  `expires_at` is **epoch seconds UTC** (a number, never an ISO string, since
  ISO-with-timezone serialization is not consistent across languages).
- Refresh margin: 300 s. Concurrent refresh races are benign (ADP
  client-credentials tokens don't invalidate each other; last write wins).
- Ship a `WindmillTokenStore` (using `windmill-client`) for that environment,
  and a `MemoryTokenStore` for tests/default use. Do not change this shape
  unilaterally — other clients depend on it.

## Style/conventions for this repo

- TypeScript, ESM, `"type": "module"`, `exports` map in package.json.
- Zero runtime dependencies (fetch + TLS are built into Bun;
  `windmill-client` only inside the optional Windmill adapter).
- Never log tokens, client_secret, or PEM contents. Never commit real certs;
  fixtures use obviously-fake PEMs and sanitized identifiers.
- All changes reviewed by Craig before deploy/publish — do not deploy or
  publish to npm without explicit approval.

## Testing

```bash
bun test            # unit + integration tests (Bun); live smoke test skips without ADP_* env vars
npm run test:node   # Node adapter tests against a local mTLS server
bun run typecheck
```

- Reuse `tests/fixtures/**` verbatim as the error-extractor and event-shape
  corpus; sanitize values (never structure) if new fixtures are added.
- Mock at the `Client.request`/transport seam instead of a network-mocking
  library.
