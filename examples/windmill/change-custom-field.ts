// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Changes a string-typed custom field on a worker's record via
// POST /events/hr/v1/worker.person.custom-field.string.change. Field list
// mirrors ChangeCustomFieldStringParams in src/worker.ts. DRAFT envelope
// per that file's comment — verify against your tenant's event meta
// (get-event-meta.ts, event "worker.person.custom-field.string.change")
// before relying on this in production.

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
  // The custom-field instance itemID on the worker record.
  itemID: string,
  stringValue: string,
  // YYYY-MM-DD
  effectiveDate?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    tokenStore: new WindmillTokenStore(adp.token_cache_path),
  });

  const result = await client.worker.changeCustomFieldString({
    associateOID,
    itemID,
    stringValue,
    effectiveDate,
  });

  return { result };
}
