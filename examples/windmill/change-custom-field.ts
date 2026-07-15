// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Changes a string-typed custom field on a worker's record via
// POST /events/hr/v1/worker.person.custom-field.string.change. Field list
// mirrors ChangeCustomFieldStringParams in src/worker.ts. DRAFT envelope
// per that file's comment — verify against your tenant's event meta
// (get-event-meta.ts, event "worker.person.custom-field.string.change")
// before relying on this in production.

import { Client } from '@craibuc/adp-workforce-now';

type CAdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: CAdpCredentials,
  // Associate OID, e.g. "G0FAKEFAKEFAKE1A".
  associateOID: string,
  // The custom-field instance itemID on the worker record.
  itemID: string,
  stringValue: string,
  // YYYY-MM-DD
  effectiveDate?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.changeCustomFieldString({
    associateOID,
    itemID,
    stringValue,
    effectiveDate,
  });

  return { result };
}
