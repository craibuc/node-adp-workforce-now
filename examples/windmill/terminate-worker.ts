// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Terminates a work assignment via
// POST /events/hr/v1/worker.work-assignment.terminate. Field list mirrors
// TerminateParams in src/worker.ts.
//
// workAssignmentID comes from GET /hr/v2/workers/{aoid} ->
// workAssignments[].itemID — filter for primaryIndicator === true (and an
// active assignmentStatus), never take index 0 blindly. See get-worker.ts
// to fetch the worker record first.

import { Client } from '@craibuc/adp-workforce-now';

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: AdpCredentials,
  // workAssignments[].itemID for the assignment to terminate.
  workAssignmentID: string,
  // Lands in comment.commentCode.codeValue — a tenant code, not free text.
  commentCode: string,
  // YYYY-MM-DD; also used as lastWorkedDate.
  terminationDate: string,
  // Tenant termination-reason code.
  reasonCode: string,
  // Default true if omitted.
  rehireEligibleIndicator?: boolean,
  // Default true if omitted.
  severanceEligibleIndicator?: boolean,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.terminate({
    workAssignmentID,
    commentCode,
    terminationDate,
    reasonCode,
    rehireEligibleIndicator,
    severanceEligibleIndicator,
  });

  return { result };
}
