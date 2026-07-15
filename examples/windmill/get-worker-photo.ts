// Fetch a worker's photo and report its content type + byte length only —
// the bytes themselves are NOT returned, to keep the Windmill step result
// (and job log) small. See the README's "Worker photos" section for the
// base64 round trip if you need to actually pass the bytes to another step.

import { Client } from '@craibuc/adp-workforce-now';

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: AdpCredentials,
  // Associate OID, e.g. "G0FAKEFAKEFAKE1A".
  associateOID: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const photo = await client.worker.getPhoto(associateOID);

  return {
    found: photo !== null,
    contentType: photo?.contentType ?? null,
    byteLength: photo?.bytes.byteLength ?? null,
  };
}
