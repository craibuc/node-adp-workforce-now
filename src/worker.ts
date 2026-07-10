import type { Client } from './client.js';

/** Typed only where the library reads/writes; everything else passes through. */
export interface WorkerRecord {
  associateOID: string;
  [key: string]: unknown;
}

export interface HireParams {
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD */
  birthDate: string;
  genderCode: string;
  ssn: string;
  lineOne: string;
  lineTwo?: string;
  cityName: string;
  stateCode: string;
  postalCode: string;
  /** YYYY-MM-DD */
  hireDate: string;
  payrollGroupCode: string;
  /** Default "NEW". */
  eventReasonCode?: string;
}

export interface RehireParams {
  associateOID: string;
  /** YYYY-MM-DD */
  rehireDate: string;
  /** YYYY-MM-DD */
  effectiveDate: string;
  /** Default "IMPORT". */
  reasonCode?: string;
}

export interface TerminateParams {
  workAssignmentID: string;
  /** Lands in comment.commentCode.codeValue — a code, not free text. */
  commentCode: string;
  /** YYYY-MM-DD; also used as lastWorkedDate. */
  terminationDate: string;
  reasonCode: string;
  /** Default true. */
  rehireEligibleIndicator?: boolean;
  /** Default true. */
  severanceEligibleIndicator?: boolean;
}

export class Worker {
  constructor(protected readonly client: Client) {}

  async one(associateOID: string): Promise<WorkerRecord | undefined> {
    const response = (await this.client.get(`/hr/v2/workers/${encodeURIComponent(associateOID)}`)) as
      | { workers?: WorkerRecord[] }
      | undefined;
    return response?.workers?.[0];
  }

  async *pages(pageSize = 100): AsyncGenerator<WorkerRecord[], void, void> {
    for (let page = 0; ; page++) {
      const response = (await this.client.get(
        `/hr/v2/workers?$top=${pageSize}&$skip=${page * pageSize}`,
      )) as { workers?: WorkerRecord[] } | undefined;
      const workers = response?.workers;
      if (!workers || workers.length === 0) return;
      yield workers;
    }
  }

  /** Convenience accumulation; memory grows with the full worker count. */
  async all(pageSize = 100): Promise<WorkerRecord[]> {
    const result: WorkerRecord[] = [];
    for await (const page of this.pages(pageSize)) result.push(...page);
    return result;
  }

  async find(
    predicate: (worker: WorkerRecord) => boolean,
    pageSize = 100,
  ): Promise<WorkerRecord | undefined> {
    for await (const page of this.pages(pageSize)) {
      const match = page.find(predicate);
      if (match) return match;
    }
    return undefined;
  }

  hire(params: HireParams): Promise<unknown> {
    const { eventReasonCode = 'NEW' } = params;
    const data = {
      events: [
        {
          data: {
            transform: {
              eventReasonCode: { codeValue: eventReasonCode },
              worker: {
                person: {
                  governmentIDs: [{ idValue: params.ssn, nameCode: { codeValue: 'SSN' } }],
                  legalName: { givenName: params.givenName, familyName1: params.familyName },
                  legalAddress: {
                    nameCode: { codeValue: 'PersonalAddress1' },
                    lineOne: params.lineOne,
                    lineTwo: params.lineTwo,
                    cityName: params.cityName,
                    countrySubdivisionLevel1: { codeValue: params.stateCode },
                    countryCode: 'US',
                    postalCode: params.postalCode,
                  },
                  birthDate: params.birthDate,
                  genderCode: { codeValue: params.genderCode },
                },
                workAssignment: {
                  hireDate: params.hireDate,
                  payrollGroupCode: params.payrollGroupCode,
                },
              },
            },
          },
        },
      ],
    };
    return this.client.post('/events/hr/v1/worker.hire', data);
  }

  rehire(params: RehireParams): Promise<unknown> {
    const { reasonCode = 'IMPORT' } = params;
    const data = {
      events: [
        {
          data: {
            transform: {
              effectiveDateTime: params.effectiveDate,
              worker: {
                associateOID: params.associateOID,
                workerDates: { rehireDate: params.rehireDate },
                workerStatus: { reasonCode: { codeValue: reasonCode } },
              },
            },
          },
        },
      ],
    };
    return this.client.post('/events/hr/v1/worker.rehire', data);
  }

  terminate(params: TerminateParams): Promise<unknown> {
    const { rehireEligibleIndicator = true, severanceEligibleIndicator = true } = params;
    const data = {
      events: [
        {
          data: {
            eventContext: {
              contextExpressionID: '',
              worker: { workAssignment: { itemID: params.workAssignmentID } },
            },
            transform: {
              comment: { commentCode: { codeValue: params.commentCode } },
              worker: {
                workAssignment: {
                  terminationDate: params.terminationDate,
                  lastWorkedDate: params.terminationDate,
                  assignmentStatus: { reasonCode: { codeValue: params.reasonCode } },
                  rehireEligibleIndicator,
                  severanceEligibleIndicator,
                },
              },
            },
          },
        },
      ],
    };
    return this.client.post('/events/hr/v1/worker.work-assignment.terminate', data);
  }

  hireMeta(): Promise<unknown> {
    return this.client.get('/events/hr/v1/worker.hire/meta');
  }
}
