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
    tokenStore: new WindmillTokenStore(adp.token_cache_path),
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
