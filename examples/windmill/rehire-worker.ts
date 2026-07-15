// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Rehires a previously-terminated worker via POST /events/hr/v1/worker.rehire.
// Field list mirrors RehireParams in src/worker.ts.

import { Client } from '@craibuc/adp-workforce-now';

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: AdpCredentials,
  // Associate OID of the terminated worker, e.g. "G0FAKEFAKEFAKE1A".
  associateOID: string,
  // YYYY-MM-DD
  rehireDate: string,
  // YYYY-MM-DD — chosen by the caller (usually the rehire date itself or
  // the next pay period start); not read from anywhere.
  effectiveDate: string,
  // Tenant rehire-reason code. Default "IMPORT" if omitted.
  reasonCode?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.rehire({
    associateOID,
    rehireDate,
    effectiveDate,
    reasonCode,
  });

  return { result };
}
