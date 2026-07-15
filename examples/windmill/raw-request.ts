// Escape hatch for any ADP endpoint this library hasn't wrapped yet.
// Client.raw() carries the same lazy auth, mTLS, single 401-refresh-retry,
// and typed-error extraction as get/post, but also returns status +
// headers — needed for header-only data (e.g. the event-notification
// queue's delete handle lives in a response header, not the body).

import { Client } from '@craibuc/adp-workforce-now';
import { WindmillTokenStore } from '@craibuc/adp-workforce-now/windmill';

type CAdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
  // Windmill variable path for the shared token cache, e.g. "f/adp/access_token_cache".
  token_cache_path: string;
};

export async function main(
  adp: CAdpCredentials,
  // HTTP method, e.g. "GET", "POST", "DELETE".
  method: string,
  // Path relative to the API base (https://api.adp.com), e.g.
  // "/hr/v2/workers/G0FAKEFAKEFAKE1A".
  path: string,
  // Optional JSON body for POST-style calls.
  data?: unknown,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    tokenStore: new WindmillTokenStore(adp.token_cache_path),
  });

  const { status, headers, body } = await client.raw(method, path, data);

  return {
    status,
    headers: Object.fromEntries(headers.entries()),
    body,
  };
}
