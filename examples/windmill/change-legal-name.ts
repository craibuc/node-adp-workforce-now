// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Changes a worker's legal name via
// POST /events/hr/v1/worker.legal-name.change. Field list mirrors
// ChangeLegalNameParams in src/worker.ts. DRAFT envelope per that file's
// comment — verify against your tenant's event meta (get-event-meta.ts,
// event "worker.legal-name.change") before relying on this in production.

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
  givenName: string,
  familyName: string,
  // YYYY-MM-DD
  effectiveDate: string,
  middleName?: string,
  // Tenant name-change-reason code.
  eventReasonCode?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.changeLegalName({
    associateOID,
    givenName,
    familyName,
    middleName,
    effectiveDate,
    eventReasonCode,
  });

  return { result };
}
