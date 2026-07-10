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
