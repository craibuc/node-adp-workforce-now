import { EventValidationError, parseEventMeta, validateEnvelope } from './meta.js';
import type { EventMeta, SupportedEvent } from './meta.js';
import type { Client } from './client.js';
import { BadRequestError } from './errors.js';
import { WorkerSearch, odataEscape } from './search.js';
import type { WorkerQuery } from './search.js';

/** Typed only where the library reads/writes; everything else passes through. */
export interface WorkerRecord {
  associateOID: string;
  [key: string]: unknown;
}

export type WorkerKey = string | { aoid: string } | { ssn: string };

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

export interface ChangeBaseRemunerationParams {
  associateOID: string;
  /** workAssignments[].itemID — filter primaryIndicator === true, never index 0 blindly. */
  workAssignmentID: string;
  /** YYYY-MM-DD; chosen by the caller (usually next pay period start). Backdating does NOT auto-calculate retro pay. */
  effectiveDate: string;
  /** H = hourly, D = daily, S = salary (pay-period rate). */
  rateType: 'H' | 'D' | 'S';
  amount: number;
  /** Default "USD". */
  currencyCode?: string;
  /** Tenant Compensation Change Reasons code — validated against the event meta. */
  eventReasonCode: string;
}

export interface ChangeLegalNameParams {
  associateOID: string;
  givenName: string;
  familyName: string;
  middleName?: string;
  /** YYYY-MM-DD */
  effectiveDate: string;
  eventReasonCode?: string;
}

export interface ChangeCustomFieldStringParams {
  associateOID: string;
  /** The custom-field instance itemID on the worker record. */
  itemID: string;
  stringValue: string;
  /** YYYY-MM-DD */
  effectiveDate?: string;
}

export interface RequestLeaveAbsenceParams {
  associateOID: string;
  /** workAssignments[].itemID — omit if the event isn't scoped to a specific assignment. */
  workAssignmentID?: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  expectedReturnDate?: string;
  /** Tenant leave-type code — validated against the event meta. */
  leaveTypeCode: string;
}

/** Negative-cache window for meta-fetch failures (Fix 3): avoids re-hitting a
 * known-broken meta endpoint on every single event call for this long. */
const META_FAILURE_TTL_MS = 5 * 60 * 1000;

export class Worker {
  private readonly metaCache = new Map<string, EventMeta>();
  /** event -> epoch ms of the last meta-fetch failure (Fix 3 negative cache). */
  private readonly metaFailureAt = new Map<string, number>();

  constructor(protected readonly client: Client) {}

  /** Fetch (and cache) an event's metadata. Metas are tenant-level; cached (default 12 h). */
  async eventMeta(
    event: SupportedEvent | (string & {}),
    options: { forceRefresh?: boolean } = {},
  ): Promise<EventMeta> {
    const cached = this.metaCache.get(event);
    if (!options.forceRefresh && cached && Date.now() - cached.fetchedAt < this.client.metaCacheTtlMs) {
      return cached;
    }
    const raw = await this.client.get(`/events/hr/v1/${encodeURIComponent(event)}/meta`);
    const meta = parseEventMeta(event, raw, Date.now());
    this.metaCache.set(event, meta);
    return meta;
  }

  /**
   * Validated event pipeline — public escape hatch for any worker.* event.
   * Validates against cached meta (when client.validateEvents), POSTs, and on
   * an ADP 400 refreshes the meta once and re-validates to upgrade
   * stale-cache failures into readable errors. Never re-POSTs. Only
   * `codeList` violations block the POST (throw `EventValidationError`) —
   * live verification against real tenant metas showed ADP overdeclares
   * `required`/`readOnly`/`hidden`/`pattern`/`length` constraints on fields
   * that battle-tested envelopes have always sent successfully, while
   * code-list checks (the original motivation: tenant reason-code
   * validation) produced no false positives. Those other constraint types
   * remain computable via `eventMeta` + `validateEnvelope` for diagnostics —
   * they are advisory only and never block. Envelopes are validated as
   * single-event payloads: multiple entries under `events[]` are flattened
   * together rather than validated independently per entry.
   */
  async postEvent(event: SupportedEvent | (string & {}), envelope: unknown): Promise<unknown> {
    const path = `/events/hr/v1/${encodeURIComponent(event)}`;

    if (!this.client.validateEvents) {
      return this.client.post(path, envelope);
    }

    // Negative meta cache (Fix 3): a meta endpoint that just failed is
    // unlikely to recover within the TTL — skip re-fetching it and go
    // straight to the unvalidated POST, same as the fail-open catch below.
    if (Date.now() - (this.metaFailureAt.get(event) ?? 0) < META_FAILURE_TTL_MS) {
      return this.client.post(path, envelope);
    }

    let meta: EventMeta;
    try {
      meta = await this.eventMeta(event);
    } catch {
      // Live finding: some tenants' meta endpoints error for specific events
      // (e.g. terminate meta returning a 500-wrapped 405). Fail-open — skip
      // client-side validation and let the server remain the authority,
      // rather than making the event method unusable. Record the failure so
      // subsequent calls skip the fetch until the negative-cache TTL expires.
      this.metaFailureAt.set(event, Date.now());
      console.warn(`${event}: meta unavailable, skipping validation`);
      return this.client.post(path, envelope);
    }

    const issues = validateEnvelope(envelope, meta);
    const blockingIssues = issues.filter((i) => i.code === 'codeList');
    if (blockingIssues.length > 0) throw new EventValidationError(event, blockingIssues);

    try {
      return await this.client.post(path, envelope);
    } catch (error) {
      if (error instanceof BadRequestError) {
        let freshBlockingIssues;
        try {
          const fresh = await this.eventMeta(event, { forceRefresh: true });
          freshBlockingIssues = validateEnvelope(envelope, fresh).filter((i) => i.code === 'codeList');
        } catch {
          // Self-heal is best-effort: a failed meta refresh must not mask the original 400.
          throw error;
        }
        if (freshBlockingIssues.length > 0) {
          throw new EventValidationError(event, freshBlockingIssues, { cause: error });
        }
      }
      throw error;
    }
  }

  /**
   * Fetch one worker by key: aoid (string shorthand or { aoid }) or { ssn }.
   * If both keys are somehow present (plain JS), `ssn` wins.
   */
  async get(key: WorkerKey): Promise<WorkerRecord | undefined> {
    const k = typeof key === 'string' ? { aoid: key } : key;
    if (k === null || typeof k !== 'object') {
      throw new Error('worker.get() requires an aoid string, { aoid }, or { ssn }');
    }
    if ('ssn' in k) {
      if (typeof k.ssn !== 'string' || k.ssn.length === 0) {
        throw new Error('worker.get({ ssn }) requires a non-empty ssn string');
      }
      // Lookup-by-identifier via the worker.read event (recorded envelope —
      // its filter dialect supports governmentIDs but NOT name paths).
      const response = (await this.postEvent('worker.read', {
        events: [
          {
            serviceCategoryCode: { codeValue: 'hr' },
            eventNameCode: { codeValue: 'worker.read' },
            data: {
              transform: {
                queryParameter:
                  `$filter=person/governmentIDs[0]/idValue eq '${odataEscape(k.ssn)}' ` +
                  `and person/governmentIDs[0]/nameCode eq 'SSN'`,
              },
            },
          },
        ],
      })) as { events?: Array<{ data?: { output?: { workers?: WorkerRecord[] } } }> } | undefined;
      return response?.events?.[0]?.data?.output?.workers?.[0];
    }
    if (!('aoid' in k) || typeof k.aoid !== 'string' || k.aoid.length === 0) {
      throw new Error('worker.get() requires an aoid string, { aoid }, or { ssn }');
    }
    const response = (await this.client.get(
      `/hr/v2/workers/${encodeURIComponent(k.aoid)}`,
    )) as { workers?: WorkerRecord[] } | undefined;
    return response?.workers?.[0];
  }

  /** Lazy search handle — fetches nothing until page()/pages()/all()/find(). */
  search(query: WorkerQuery = {}): WorkerSearch {
    return new WorkerSearch(this.client, query);
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
    return this.postEvent('worker.hire', data);
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
    return this.postEvent('worker.rehire', data);
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
    return this.postEvent('worker.work-assignment.terminate', data);
  }

  /** Envelope documented from prior research: this API family uses `amountValue` (not the legacy PUT's `amount`). */
  changeBaseRemuneration(params: ChangeBaseRemunerationParams): Promise<unknown> {
    const rateField =
      params.rateType === 'H' ? 'hourlyRateAmount' : params.rateType === 'D' ? 'dailyRateAmount' : 'payPeriodRateAmount';
    const data = {
      events: [
        {
          data: {
            eventContext: {
              worker: {
                associateOID: params.associateOID,
                workAssignment: { itemID: params.workAssignmentID },
              },
            },
            transform: {
              effectiveDateTime: params.effectiveDate,
              eventReasonCode: { codeValue: params.eventReasonCode },
              worker: {
                workAssignment: {
                  baseRemuneration: {
                    [rateField]: {
                      nameCode: { codeValue: params.rateType },
                      amountValue: params.amount,
                      currencyCode: params.currencyCode ?? 'USD',
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };
    return this.postEvent('worker.work-assignment.base-remuneration.change', data);
  }

  /** DRAFT envelope — verify against the tenant's event meta before production (see live-meta test). */
  changeLegalName(params: ChangeLegalNameParams): Promise<unknown> {
    const data = {
      events: [
        {
          data: {
            eventContext: { worker: { associateOID: params.associateOID } },
            transform: {
              effectiveDateTime: params.effectiveDate,
              ...(params.eventReasonCode !== undefined
                ? { eventReasonCode: { codeValue: params.eventReasonCode } }
                : {}),
              worker: {
                person: {
                  legalName: {
                    givenName: params.givenName,
                    ...(params.middleName !== undefined ? { middleName: params.middleName } : {}),
                    familyName1: params.familyName,
                  },
                },
              },
            },
          },
        },
      ],
    };
    return this.postEvent('worker.legal-name.change', data);
  }

  /** DRAFT envelope — verify against the tenant's event meta before production (see live-meta test). */
  changeCustomFieldString(params: ChangeCustomFieldStringParams): Promise<unknown> {
    const data = {
      events: [
        {
          data: {
            eventContext: {
              worker: {
                associateOID: params.associateOID,
                person: { customFieldGroup: { stringField: { itemID: params.itemID } } },
              },
            },
            transform: {
              ...(params.effectiveDate !== undefined ? { effectiveDateTime: params.effectiveDate } : {}),
              worker: {
                person: { customFieldGroup: { stringField: { stringValue: params.stringValue } } },
              },
            },
          },
        },
      ],
    };
    return this.postEvent('worker.person.custom-field.string.change', data);
  }

  /** Envelope rebuilt from the live tenant meta (see live-meta gate). */
  requestLeaveAbsence(params: RequestLeaveAbsenceParams): Promise<unknown> {
    const data = {
      events: [
        {
          data: {
            eventContext: {
              associateOID: params.associateOID,
              ...(params.workAssignmentID !== undefined ? { workAssignmentID: params.workAssignmentID } : {}),
            },
            transform: {
              workerLeave: {
                leaveAbsence: {
                  startDateTime: params.startDate,
                  ...(params.expectedReturnDate !== undefined
                    ? { expectedEndDateTime: params.expectedReturnDate }
                    : {}),
                  leaveTypeCode: { codeValue: params.leaveTypeCode },
                },
              },
            },
          },
        },
      ],
    };
    return this.postEvent('worker.leave.absence.request', data);
  }
}
