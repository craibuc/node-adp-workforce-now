import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient() {
  const { transport, calls } = makeFakeTransport([TOKEN_RESPONSE, { status: 200, json: { events: [] } }]);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, validateEvents: false });
  return { client, calls };
}

const HIRE_PARAMS = {
  givenName: 'Renée',
  familyName: 'Duck',
  birthDate: '1990-01-01',
  genderCode: 'F',
  ssn: '111-22-3333',
  lineOne: '123 Maple Street',
  lineTwo: 'Apt 4',
  cityName: 'Minneapolis',
  stateCode: 'MN',
  postalCode: '55555',
  hireDate: '2026-08-01',
  payrollGroupCode: 'ABC',
};

describe('worker.hire', () => {
  it('posts the v1-compatible envelope with default eventReasonCode NEW', async () => {
    const { client, calls } = makeClient();

    await client.worker.hire(HIRE_PARAMS);

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.hire');
    const body = JSON.parse(calls[1].body!);
    const transform = body.events[0].data.transform;
    expect(transform.eventReasonCode.codeValue).toBe('NEW');
    expect(transform.worker.person.legalName).toEqual({ givenName: 'Renée', familyName1: 'Duck' });
    expect(transform.worker.person.governmentIDs[0]).toEqual({
      idValue: '111-22-3333',
      nameCode: { codeValue: 'SSN' },
    });
    expect(transform.worker.person.legalAddress.countrySubdivisionLevel1.codeValue).toBe('MN');
    expect(transform.worker.workAssignment).toEqual({ hireDate: '2026-08-01', payrollGroupCode: 'ABC' });
  });

  it('honors an eventReasonCode override', async () => {
    const { client, calls } = makeClient();
    await client.worker.hire({ ...HIRE_PARAMS, eventReasonCode: 'REHIRE' });
    expect(JSON.parse(calls[1].body!).events[0].data.transform.eventReasonCode.codeValue).toBe('REHIRE');
  });
});

describe('worker.rehire', () => {
  it('posts the v1-compatible envelope with default reasonCode IMPORT', async () => {
    const { client, calls } = makeClient();

    await client.worker.rehire({ associateOID: 'AAA', rehireDate: '2026-08-01', effectiveDate: '2026-08-01' });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.rehire');
    const transform = JSON.parse(calls[1].body!).events[0].data.transform;
    expect(transform.effectiveDateTime).toBe('2026-08-01');
    expect(transform.worker.associateOID).toBe('AAA');
    expect(transform.worker.workerDates.rehireDate).toBe('2026-08-01');
    expect(transform.worker.workerStatus.reasonCode.codeValue).toBe('IMPORT');
  });
});

describe('worker.terminate', () => {
  it('posts the v1-compatible envelope with eligible-indicator defaults', async () => {
    const { client, calls } = makeClient();

    await client.worker.terminate({
      workAssignmentID: 'WA1',
      commentCode: 'GROWTH',
      terminationDate: '2026-08-15',
      reasonCode: 'T',
    });

    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.work-assignment.terminate');
    const data = JSON.parse(calls[1].body!).events[0].data;
    expect(data.eventContext.worker.workAssignment.itemID).toBe('WA1');
    expect(data.transform.comment.commentCode.codeValue).toBe('GROWTH');
    const assignment = data.transform.worker.workAssignment;
    expect(assignment.terminationDate).toBe('2026-08-15');
    expect(assignment.lastWorkedDate).toBe('2026-08-15');
    expect(assignment.assignmentStatus.reasonCode.codeValue).toBe('T');
    expect(assignment.rehireEligibleIndicator).toBe(true);
    expect(assignment.severanceEligibleIndicator).toBe(true);
  });

  it('honors indicator overrides', async () => {
    const { client, calls } = makeClient();

    await client.worker.terminate({
      workAssignmentID: 'WA1',
      commentCode: 'GROWTH',
      terminationDate: '2026-08-15',
      reasonCode: 'T',
      rehireEligibleIndicator: false,
      severanceEligibleIndicator: false,
    });

    const assignment = JSON.parse(calls[1].body!).events[0].data.transform.worker.workAssignment;
    expect(assignment.rehireEligibleIndicator).toBe(false);
    expect(assignment.severanceEligibleIndicator).toBe(false);
  });

  it('honors an explicit lastWorkedDate distinct from terminationDate', async () => {
    const { client, calls } = makeClient();

    await client.worker.terminate({
      workAssignmentID: 'WA1',
      commentCode: 'GROWTH',
      terminationDate: '2026-08-15',
      lastWorkedDate: '2026-08-08',
      reasonCode: 'T',
    });

    const assignment = JSON.parse(calls[1].body!).events[0].data.transform.worker.workAssignment;
    expect(assignment.terminationDate).toBe('2026-08-15');
    expect(assignment.lastWorkedDate).toBe('2026-08-08');
  });
});
