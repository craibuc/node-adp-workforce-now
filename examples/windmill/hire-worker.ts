// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Hires a new worker via POST /events/hr/v1/worker.hire. Field list mirrors
// HireParams in src/worker.ts; see the README's API coverage table for the
// endpoint. Use obviously-fake identifiers (SSN, address) in any test run.

import { Client } from '@craibuc/adp-workforce-now';

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: AdpCredentials,
  givenName: string,
  familyName: string,
  // YYYY-MM-DD
  birthDate: string,
  // Tenant gender code, e.g. "M" or "F".
  genderCode: string,
  // e.g. "000-00-0000" — use an obviously-fake SSN against a test tenant.
  ssn: string,
  lineOne: string,
  cityName: string,
  // Two-letter US state code, e.g. "MN".
  stateCode: string,
  postalCode: string,
  // YYYY-MM-DD
  hireDate: string,
  payrollGroupCode: string,
  lineTwo?: string,
  // Tenant hire-reason code. Default "NEW" if omitted.
  eventReasonCode?: string,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.hire({
    givenName,
    familyName,
    birthDate,
    genderCode,
    ssn,
    lineOne,
    lineTwo,
    cityName,
    stateCode,
    postalCode,
    hireDate,
    payrollGroupCode,
    eventReasonCode,
  });

  return { result };
}
