import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

/** Wire-format tests run with validation off (pipeline covered in post-event tests). */
function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, validateEvents: false });
  return { client, calls };
}

const FULL = {
  onboardingTemplateCode: 'TPL-01',
  personal: {
    givenName: 'First',
    middleName: 'Q',
    familyName: 'Last',
    birthDate: '1990-01-01',
    genderCode: 'F',
    raceCode: '1',
    raceIdentificationMethodCode: 'VID',
    ethnicityCode: '4',
    languageCode: 'EN',
    ssn: '111-22-3333',
    address: { lineOne: '123 Maple Street', cityName: 'Minneapolis', stateCode: 'MN', postalCode: '55555' },
    homePhone: '(612) 555-1234',
    mobilePhone: '612.555.9876',
    email: 'first.last@example.invalid',
  },
  worker: {
    hireDate: '2026-08-01',
    hireReasonCode: 'NEW',
    jobCode: 'J01',
    workerTypeCode: 'F',
    businessUnitCode: 'BU1',
    homeDepartmentCode: '000001',
    reportsToPositionID: 'POS-9',
    eeoClassificationCode: 'E1',
    eeocClassificationCode: 'C1',
  },
  payroll: {
    payrollGroupCode: 'ABC',
    payCycleCode: 'B',
    payrollScheduleGroupCode: 'SG1',
    customCodeFields: [{ nameCode: 'DataControl', code: 'XX  ' }],
  },
  tax: {
    federal: { taxFilingStatusCode: 'S', deductions: 0, dependents: 2, additionalTaxAmount: 25 },
    state: { workedInStateCode: 'MN', livedInStateCode: 'WI', taxFilingStatusCode: 'S', taxAllowanceQuantity: 1 },
  },
} as const;

function bodyOf(calls: ReturnType<typeof makeFakeTransport>['calls']) {
  return JSON.parse(calls[1].body as string).applicantOnboarding;
}

describe('worker.onboard — recorded dialect', () => {
  it('posts the full envelope to /hcm/v2/applicant.onboard', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { ok: 1 } }]);

    const result = await client.worker.onboard(FULL);

    expect(result).toEqual({ ok: 1 });
    expect(calls[1].url).toBe('https://api.adp.com/hcm/v2/applicant.onboard');
    const b = bodyOf(calls);

    expect(b.onboardingTemplateCode).toEqual({ code: 'TPL-01' });
    expect(b.onboardingStatus).toEqual({ statusCode: { code: 'inprogress' } });

    const p = b.applicantPersonalProfile;
    expect(p.birthName).toEqual({ givenName: 'First', middleName: 'Q', familyName: 'Last' });
    expect(p.genderCode).toEqual({ code: 'F' });
    expect(p.genderReportingDetails).toEqual({ reportedGenderCode: { code: 'F' } });
    expect(p.raceCode).toEqual({ identificationMethodCode: { code: 'VID' }, code: '1' });
    expect(p.legalAddress.subdivisionCode).toEqual({ code: 'MN' });
    expect(p.legalAddress.countryCode).toBe('US');
    expect(p.governmentIDs).toEqual([{ id: '111-22-3333', nameCode: { code: 'SSN' } }]);
    expect(p.communication.landlines).toEqual([
      { nameCode: { codeValue: 'Home Phone' }, countryDialing: '1', areaDialing: '612', dialNumber: '5551234' },
    ]);
    expect(p.communication.mobiles[0].areaDialing).toBe('612');
    expect(p.communication.mobiles[0].dialNumber).toBe('5559876');
    expect(p.communication.emails[0]).toEqual({
      nameCode: { codeValue: 'Personal E-mail' },
      emailUri: 'first.last@example.invalid',
      notificationIndicator: true,
    });

    const w = b.applicantWorkerProfile;
    expect(w.hireDate).toBe('2026-08-01');
    expect(w.homeOrganizationalUnits).toEqual([
      { unitTypeCode: { code: 'BusinessUnit' }, nameCode: { code: 'BU1' } },
      { unitTypeCode: { code: 'HomeDepartment' }, nameCode: { code: '000001' } },
    ]);
    expect(w.job.occupationalClassifications).toEqual([
      { classificationID: { code: 'EEOC' }, classificationCode: { code: 'C1' } },
      { classificationID: { code: 'EEO' }, classificationCode: { code: 'E1' } },
    ]);
    expect(w.reportsTo).toEqual({ positionID: 'POS-9' });
    expect(w.managementPositionIndicator).toBe(false);

    const pay = b.applicantPayrollProfile;
    expect(pay.payrollGroupCode).toBe('ABC'); // plain string on the wire
    expect(pay.payCycleCode).toEqual({ code: 'B' });
    expect(pay.customFieldGroup.codeFields).toEqual([{ nameCode: { code: 'DataControl' }, code: 'XX  ' }]);

    const fed = b.applicantTaxProfile.usFederalTaxInstruction;
    expect(fed.federalIncomeTaxInstruction.taxFilingStatusCode).toEqual({ code: 'S' });
    expect(fed.federalIncomeTaxInstruction.additionalTaxAmount).toEqual({ amount: 25 });
    expect(fed.federalIncomeTaxInstruction.taxAllowances).toEqual([
      { allowanceTypeCode: { code: 'Deductions' }, taxAllowanceAmount: { amount: 0 } },
      { allowanceTypeCode: { code: 'Dependents' }, taxAllowanceAmount: { amount: 2 } },
    ]);
    expect(fed.multipleJobIndicator).toBe(false);

    const state = b.applicantTaxProfile.usStateTaxInstructions.stateIncomeTaxInstructions;
    expect(state[0]).toMatchObject({ stateCode: { code: 'MN' }, workedInJurisdictionIndicator: true, taxAllowanceQuantity: 1 });
    expect(state[1]).toEqual({ livedInJurisdictionIndicator: true, stateCode: { code: 'WI' } });
  });

  it('omits absent sections and entries (no null-filled placeholders)', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);

    await client.worker.onboard({
      onboardingTemplateCode: 'TPL-01',
      personal: { givenName: 'A', familyName: 'B' },
      worker: { hireDate: '2026-08-01' },
      payroll: { payrollGroupCode: 'ABC' },
    });

    const b = bodyOf(calls);
    expect('applicantTaxProfile' in b).toBe(false);
    expect('communication' in b.applicantPersonalProfile).toBe(false);
    expect('governmentIDs' in b.applicantPersonalProfile).toBe(false);
    expect('legalAddress' in b.applicantPersonalProfile).toBe(false);
    expect('homeOrganizationalUnits' in b.applicantWorkerProfile).toBe(false);
    expect('customFieldGroup' in b.applicantPayrollProfile).toBe(false);
    expect('middleName' in b.applicantPersonalProfile.birthName).toBe(false);
  });

  it('deep-merges overrides last (validated body is the final body)', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);

    await client.worker.onboard({
      onboardingTemplateCode: 'TPL-01',
      personal: { givenName: 'A', familyName: 'B' },
      worker: { hireDate: '2026-08-01' },
      payroll: { payrollGroupCode: 'ABC' },
      overrides: {
        applicantWorkerProfile: { standardHours: { hoursQuantity: '80' } },
        onboardingStatus: { statusCode: { code: 'custom' } },
      },
    });

    const b = bodyOf(calls);
    expect(b.applicantWorkerProfile.standardHours).toEqual({ hoursQuantity: '80' }); // merged in
    expect(b.applicantWorkerProfile.hireDate).toBe('2026-08-01');                    // base kept
    expect(b.onboardingStatus).toEqual({ statusCode: { code: 'custom' } });          // override wins
  });

  it('returns null when ADP responds without a body', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(
      await client.worker.onboard({
        onboardingTemplateCode: 'T',
        personal: { givenName: 'A', familyName: 'B' },
        worker: { hireDate: '2026-08-01' },
        payroll: { payrollGroupCode: 'P' },
      }),
    ).toBeNull();
  });

  it('strips a +1 country-code prefix from a phone number before splitting', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: {} }]);

    await client.worker.onboard({
      onboardingTemplateCode: 'TPL-01',
      personal: { givenName: 'A', familyName: 'B', homePhone: '+1 (612) 555-9876' },
      worker: { hireDate: '2026-08-01' },
      payroll: { payrollGroupCode: 'ABC' },
    });

    const b = bodyOf(calls);
    expect(b.applicantPersonalProfile.communication.landlines).toEqual([
      { nameCode: { codeValue: 'Home Phone' }, countryDialing: '1', areaDialing: '612', dialNumber: '5559876' },
    ]);
  });

  it('rejects a phone number that is not exactly 10 digits after stripping, before any request is issued', async () => {
    const { client, calls } = makeClient([]);

    await expect(
      client.worker.onboard({
        onboardingTemplateCode: 'TPL-01',
        personal: { givenName: 'A', familyName: 'B', homePhone: '1234-5678' }, // 8 digits
        worker: { hireDate: '2026-08-01' },
        payroll: { payrollGroupCode: 'ABC' },
      }),
    ).rejects.toThrow(/Home Phone.*10-digit.*got 8 digits/);

    expect(calls).toHaveLength(0); // throws during envelope construction, before auth/meta/POST
  });
});
