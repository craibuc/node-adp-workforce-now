// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Uploads (replaces) a worker's photo via
// POST /events/hr/v1/worker.photo.upload. Windmill flow-step results are
// JSON, so images cross step boundaries as base64 — pass that string
// straight through as `imageBase64`; the library decodes it (see
// SetPhotoParams in src/worker.ts).
//
// Before sending, the tenant's worker.photo.upload event meta is checked
// for an imageSize limit (client-side preflight, fail-open if the meta is
// unavailable) — an oversized photo throws immediately with both the
// actual and allowed byte counts, instead of letting ADP reject the
// upload. The library does not resize images; do that in an earlier step
// (see the README's "Worker photos" section for a `sharp` recipe).

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
  // Associate OID, e.g. "G0FAKEFAKEFAKE1A".
  associateOID: string,
  // Base64-encoded image bytes (jpeg/png) — e.g. from a prior step's
  // Buffer.from(bytes).toString('base64').
  imageBase64: string,
  // datafile part Content-Type. Default: sniffed from the image's magic bytes.
  contentType?: string,
  // datafile part filename. Default "photo.jpg".
  filename?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    tokenStore: new WindmillTokenStore(adp.token_cache_path),
  });

  const result = await client.worker.setPhoto({
    associateOID,
    image: imageBase64,
    contentType,
    filename,
  });

  return { result };
}
