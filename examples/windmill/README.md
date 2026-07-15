# Windmill smoke tests

Staged live verification of this library against the real ADP API, ordered
cheapest-first. All scripts take the ADP credentials **resource as a
parameter** (picked in the Windmill UI at run time), so nothing
workspace-specific lives in this repo.

## Stage A — worker mTLS probe (`smoke-mtls.ts`)

No library import; runs before anything is published. Paste into a Windmill
Bun script editor and run as a **preview**. Proves the worker's Bun version
can complete ADP's mutual-TLS handshake and that the token endpoint host is
right. This retires the single biggest runtime risk (Bun had client-cert
bugs into early 2025).

## Stage B — local library smoke (in this repo)

`tests/integration/live.test.ts` runs automatically under `bun test` once
`ADP_CLIENT_ID` / `ADP_CLIENT_SECRET` / `ADP_CERTIFICATE` / `ADP_PRIVATE_KEY`
are present (copy `.env.sample` → `.env`, base64-encode the PEMs). Without
them it reports as skipped. This exercises the actual library code path
(lazy auth, transport, error mapping) from your dev machine.

## Stage C — end-to-end on Windmill (`smoke-library.ts`)

Requires the package on npm (a prerelease under the `next` dist-tag is
fine). Proves the published artifact + `WindmillTokenStore` against the real
`windmill-client`: missing cache variable handled, cache written, and —
check manually in the UI — the variable is created with the **secret** flag.
Run twice inside one token lifetime: `expiresAt` should not change
(cache reuse instead of re-authentication).

## Examples by method

One Windmill script per implemented library method (same Stage-C
requirement as `smoke-library.ts`: the package must be on npm). Each
`export async function main(adp, ...)` renders as a Windmill run form, with
`adp` as a resource picker for your ADP credentials. The parameter's type is
named `CAdpCredentials` because Windmill prefixes custom resource types with
`c_` (unless created with an admin override), and the TS type name must match
the resource type for the picker to bind. Only `get-worker.ts`
wires up a `WindmillTokenStore`; the rest construct `Client` without one and
carry a one-line comment pointing back to the README's "Token stores"
section — wire one up before scheduling these for real. ⚠️ marks scripts
that write to your ADP tenant; run those against a test worker/applicant
only.

| File | Method | What it does |
|---|---|---|
| `get-worker.ts` | `Worker.get` | Fetch a worker by associate OID or by SSN; shows the shared `WindmillTokenStore` |
| `search-workers.ts` | `Worker.search` → `page`/`pages` | A single filtered page, or a while-loop walk across every page via the `WorkerPage` protocol |
| `get-worker-photo.ts` | `Worker.getPhoto` | Content type + byte length only (bytes withheld to keep the step result small) |
| `get-event-meta.ts` | `Worker.eventMeta` | Lists an event's client-side validation rule paths (required/readOnly/hidden/codeList/pattern/length) |
| `drain-event-notifications.ts` | `EventNotifications.next` / `.delete` | Drains the queue up to `maxMessages` (default 50): `next()` → null means empty, otherwise collect + `delete(messageId)` to advance |
| `raw-request.ts` | `Client.raw` | Escape hatch for any endpoint not yet wrapped by the library |
| `hire-worker.ts` | `Worker.hire` | ⚠️ Hires a new worker |
| `rehire-worker.ts` | `Worker.rehire` | ⚠️ Rehires a terminated worker |
| `terminate-worker.ts` | `Worker.terminate` | ⚠️ Terminates a work assignment |
| `change-pay-rate.ts` | `Worker.changeBaseRemuneration` | ⚠️ Changes a worker's hourly/daily/salary rate |
| `change-legal-name.ts` | `Worker.changeLegalName` | ⚠️ Changes a worker's legal name |
| `change-custom-field.ts` | `Worker.changeCustomFieldString` | ⚠️ Changes a string-typed custom field |
| `request-leave-absence.ts` | `Worker.requestLeaveAbsence` | ⚠️ Requests a leave of absence |
| `onboard-worker.ts` | `Worker.onboard` | ⚠️ Starts an applicant onboarding (grouped personal/worker/payroll/tax params) |
| `set-worker-photo.ts` | `Worker.setPhoto` | ⚠️ Uploads a worker photo from a base64 string, with a meta-driven size preflight |
