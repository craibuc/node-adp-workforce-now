import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

/** Pure wire-format tests: validation off (pipeline covered in post-event.test.ts). */
function makeClient() {
  const { transport, calls } = makeFakeTransport([TOKEN_RESPONSE, { status: 200, json: { events: [] } }]);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, validateEvents: false });
  return { client, calls };
}

describe('worker.changeBaseRemuneration', () => {
  it('posts the documented envelope for an hourly rate', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeBaseRemuneration({
      associateOID: 'G0FAKEFAKEFAKE2B',
      workAssignmentID: 'K4PFAKE0001',
      effectiveDate: '2026-08-01',
      rateType: 'H',
      amount: 31.5,
      eventReasonCode: 'MERIT',
    });

    expect(calls[1].url).toBe(
      'https://api.adp.com/events/hr/v1/worker.work-assignment.base-remuneration.change',
    );
    const data = JSON.parse(calls[1].body!).events[0].data;
    expect(data.eventContext.worker.associateOID).toBe('G0FAKEFAKEFAKE2B');
    expect(data.eventContext.worker.workAssignment.itemID).toBe('K4PFAKE0001');
    expect(data.transform.effectiveDateTime).toBe('2026-08-01');
    expect(data.transform.eventReasonCode.codeValue).toBe('MERIT');
    const baseRemuneration = data.transform.worker.workAssignment.baseRemuneration;
    expect(baseRemuneration.hourlyRateAmount).toEqual({
      nameCode: { codeValue: 'H' },
      amountValue: 31.5,
      currencyCode: 'USD',
    });
    expect(baseRemuneration.dailyRateAmount).toBeUndefined();
    expect(baseRemuneration.payPeriodRateAmount).toBeUndefined();
  });

  it('maps rateType D to dailyRateAmount', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeBaseRemuneration({
      associateOID: 'G0FAKEFAKEFAKE2B',
      workAssignmentID: 'K4PFAKE0001',
      effectiveDate: '2026-08-01',
      rateType: 'D',
      amount: 250,
      eventReasonCode: 'MERIT',
    });

    const baseRemuneration = JSON.parse(calls[1].body!).events[0].data.transform.worker.workAssignment
      .baseRemuneration;
    expect(baseRemuneration.dailyRateAmount).toEqual({
      nameCode: { codeValue: 'D' },
      amountValue: 250,
      currencyCode: 'USD',
    });
    expect(baseRemuneration.hourlyRateAmount).toBeUndefined();
    expect(baseRemuneration.payPeriodRateAmount).toBeUndefined();
  });

  it('maps rateType S to payPeriodRateAmount and honors currencyCode', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeBaseRemuneration({
      associateOID: 'G0FAKEFAKEFAKE2B',
      workAssignmentID: 'K4PFAKE0001',
      effectiveDate: '2026-08-01',
      rateType: 'S',
      amount: 3200,
      currencyCode: 'CAD',
      eventReasonCode: 'MERIT',
    });

    const remuneration = JSON.parse(calls[1].body!).events[0].data.transform.worker.workAssignment
      .baseRemuneration;
    expect(remuneration.payPeriodRateAmount.nameCode.codeValue).toBe('S');
    expect(remuneration.payPeriodRateAmount.currencyCode).toBe('CAD');
    expect(remuneration.hourlyRateAmount).toBeUndefined();
    expect(remuneration.dailyRateAmount).toBeUndefined();
  });
});

describe('worker.changeLegalName', () => {
  it('posts the drafted envelope', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeLegalName({
      associateOID: 'G0FAKEFAKEFAKE2B',
      givenName: 'Renée',
      familyName: 'Duck',
      middleName: 'Q',
      effectiveDate: '2026-08-01',
      eventReasonCode: 'MARRIAGE',
    });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.legal-name.change');
    const data = JSON.parse(calls[1].body!).events[0].data;
    expect(data.eventContext.worker.associateOID).toBe('G0FAKEFAKEFAKE2B');
    expect(data.transform.effectiveDateTime).toBe('2026-08-01');
    expect(data.transform.eventReasonCode.codeValue).toBe('MARRIAGE');
    expect(data.transform.worker.person.legalName).toEqual({
      givenName: 'Renée',
      middleName: 'Q',
      familyName1: 'Duck',
    });
  });

  it('omits middleName and eventReasonCode when not given', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeLegalName({
      associateOID: 'G0FAKEFAKEFAKE2B',
      givenName: 'A',
      familyName: 'B',
      effectiveDate: '2026-08-01',
    });

    const transform = JSON.parse(calls[1].body!).events[0].data.transform;
    expect(transform.eventReasonCode).toBeUndefined();
    expect('middleName' in transform.worker.person.legalName).toBe(false);
  });
});

describe('worker.changeCustomFieldString', () => {
  it('posts the drafted envelope with the field itemID in context and value in transform', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeCustomFieldString({
      associateOID: 'G0FAKEFAKEFAKE2B',
      itemID: 'CF-STRING-01',
      stringValue: 'Route 66',
      effectiveDate: '2026-08-01',
    });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.person.custom-field.string.change');
    const data = JSON.parse(calls[1].body!).events[0].data;
    expect(data.eventContext.worker.person.customFieldGroup.stringField.itemID).toBe('CF-STRING-01');
    expect(data.transform.worker.person.customFieldGroup.stringField.stringValue).toBe('Route 66');
    expect(data.transform.effectiveDateTime).toBe('2026-08-01');
  });

  it('omits effectiveDateTime from transform when effectiveDate is not given', async () => {
    const { client, calls } = makeClient();

    await client.worker.changeCustomFieldString({
      associateOID: 'G0FAKEFAKEFAKE2B',
      itemID: 'CF-STRING-01',
      stringValue: 'Route 66',
    });

    const transform = JSON.parse(calls[1].body!).events[0].data.transform;
    expect('effectiveDateTime' in transform).toBe(false);
  });
});

describe('worker.requestLeaveAbsence', () => {
  it('posts the envelope rebuilt from the live tenant meta', async () => {
    const { client, calls } = makeClient();

    await client.worker.requestLeaveAbsence({
      associateOID: 'G0FAKEFAKEFAKE2B',
      workAssignmentID: 'K4PFAKE0001',
      startDate: '2026-09-01',
      expectedReturnDate: '2026-10-01',
      leaveTypeCode: 'FMLA',
    });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.leave.absence.request');
    const data = JSON.parse(calls[1].body!).events[0].data;
    expect(data.eventContext.associateOID).toBe('G0FAKEFAKEFAKE2B');
    expect(data.eventContext.workAssignmentID).toBe('K4PFAKE0001');
    const leaveAbsence = data.transform.workerLeave.leaveAbsence;
    expect(leaveAbsence.startDateTime).toBe('2026-09-01');
    expect(leaveAbsence.expectedEndDateTime).toBe('2026-10-01');
    expect(leaveAbsence.leaveTypeCode.codeValue).toBe('FMLA');
  });

  it('omits workAssignmentID and expectedEndDateTime when not given', async () => {
    const { client, calls } = makeClient();

    await client.worker.requestLeaveAbsence({
      associateOID: 'G0FAKEFAKEFAKE2B',
      startDate: '2026-09-01',
      leaveTypeCode: 'FMLA',
    });

    const data = JSON.parse(calls[1].body!).events[0].data;
    expect('workAssignmentID' in data.eventContext).toBe(false);
    expect('expectedEndDateTime' in data.transform.workerLeave.leaveAbsence).toBe(false);
  });
});
