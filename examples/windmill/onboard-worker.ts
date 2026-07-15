// *** WRITES to your ADP tenant — run against a test worker/applicant only. ***
//
// Starts an ADP onboarding (Applicant Onboarding v2) via
// POST /hcm/v2/applicant.onboard. Params are grouped exactly like the
// README's "Worker onboarding" recipe: onboardingTemplateCode + personal /
// worker / payroll (required groups) and optional tax / overrides. See
// OnboardParams in src/worker.ts for the full nested shape of each group —
// Windmill renders each group as its own object field in the run form.
//
// Unlike the other events, onboard() validates BOTH required fields and
// code lists against the tenant meta before posting — a missing required
// field fails fast with EventValidationError naming the JSON-pointer-ish
// path.

import { Client } from '@craibuc/adp-workforce-now';
import type { OnboardParams } from '@craibuc/adp-workforce-now';

type CAdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: CAdpCredentials,
  // Tenant onboarding template code, e.g. "STANDARD-HIRE".
  onboardingTemplateCode: string,
  // e.g. { givenName: "First", familyName: "Last", ssn: "000-00-0000",
  //   address: { lineOne: "1 Main St", cityName: "Town", stateCode: "MN", postalCode: "55555" },
  //   mobilePhone: "(612) 555-9876", email: "first.last@example.com" }
  personal: OnboardParams['personal'],
  // e.g. { hireDate: "2026-08-01", jobCode: "J01", homeDepartmentCode: "000001" }
  worker: OnboardParams['worker'],
  // e.g. { payrollGroupCode: "ABC", payCycleCode: "B" }
  payroll: OnboardParams['payroll'],
  // Optional federal/state tax elections, e.g.
  // { federal: { taxFilingStatusCode: "S", dependents: 2 } }
  tax?: OnboardParams['tax'],
  // Tenant escape hatch: deep-merged over the generated body last, applied
  // BEFORE validation.
  overrides?: OnboardParams['overrides'],
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const result = await client.worker.onboard({
    onboardingTemplateCode,
    personal,
    worker,
    payroll,
    tax,
    overrides,
  });

  return { result };
}
