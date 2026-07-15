// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Changes a worker's base pay rate via
// POST /events/hr/v1/worker.work-assignment.base-remuneration.change.
// Field list mirrors ChangeBaseRemunerationParams in src/worker.ts.
//
// effectiveDate is chosen by the caller (usually the next pay period
// start) — backdating does NOT auto-calculate retro pay. workAssignmentID
// comes from GET /hr/v2/workers/{aoid} -> workAssignments[].itemID,
// filtered for primaryIndicator === true.

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
  // workAssignments[].itemID for the assignment being changed.
  workAssignmentID: string,
  // YYYY-MM-DD
  effectiveDate: string,
  // H = hourly, D = daily, S = salary (pay-period rate).
  rateType: 'H' | 'D' | 'S',
  amount: number,
  // Tenant Compensation Change Reasons code — validated against the event meta.
  eventReasonCode: string,
  // Default "USD" if omitted.
  currencyCode?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.changeBaseRemuneration({
    associateOID,
    workAssignmentID,
    effectiveDate,
    rateType,
    amount,
    eventReasonCode,
    currencyCode,
  });

  return { result };
}
