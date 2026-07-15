// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Requests a leave of absence via
// POST /events/hr/v1/worker.leave.absence.request. Field list mirrors
// RequestLeaveAbsenceParams in src/worker.ts.

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
  // YYYY-MM-DD
  startDate: string,
  // Tenant leave-type code — validated against the event meta.
  leaveTypeCode: string,
  // workAssignments[].itemID — omit if the event isn't scoped to a specific assignment.
  workAssignmentID?: string,
  // YYYY-MM-DD
  expectedReturnDate?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.requestLeaveAbsence({
    associateOID,
    workAssignmentID,
    startDate,
    expectedReturnDate,
    leaveTypeCode,
  });

  return { result };
}
