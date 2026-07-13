// Stage C smoke test: end-to-end exercise of @craibuc/adp-workforce-now on a
// Windmill worker. Requires the package to be published to npm first
// (a prerelease like 2.0.0-rc.1 under the `next` dist-tag works fine).
//
// Run as a preview in the Windmill script editor. What it proves:
//  1. The library's Bun transport completes ADP's mTLS handshake on the
//     worker's Bun version.
//  2. WindmillTokenStore works against the REAL windmill-client: a missing
//     cache variable is treated as empty (not a crash), and set() creates it.
//  3. Optional: a live worker read via client.worker.get() (requires
//     @craibuc/adp-workforce-now@>=3).
//
// After the first run, check two things in the Windmill UI:
//  - the variable at `tokenCachePath` was created with the SECRET flag set;
//  - run the script a second time within the token's lifetime — the returned
//    `expiresAt` should be UNCHANGED (cache reuse, no re-authentication).

import { Client } from '@craibuc/adp-workforce-now';
import { WindmillTokenStore } from '@craibuc/adp-workforce-now/windmill';

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: AdpCredentials,
  // Windmill variable path for the shared token cache, e.g. "u/you/adp_token_cache".
  // Use a throwaway path on the first run so you can inspect what gets created.
  tokenCachePath: string,
  // Optional: a known associateOID to verify a real API read.
  associateOID?: string,
) {
  const store = new WindmillTokenStore(tokenCachePath);
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    tokenStore: store,
  });

  // Lazy auth happens on first request; calling authenticate() directly makes
  // the smoke result explicit. Never return or log the token itself.
  const token = await client.authenticate();
  const cached = await store.get();

  const worker = associateOID ? await client.worker.get(associateOID) : undefined;

  return {
    authenticated: typeof token.access_token === 'string',
    expiresAt: token.expires_at, // epoch seconds; unchanged on a cached re-run
    cacheWritten: cached?.access_token === token.access_token,
    workerFound: associateOID ? worker?.associateOID === associateOID : null,
  };
}
