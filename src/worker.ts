import { EventValidationError, eventRoute, parseEventMeta, validateEnvelope } from './meta.js';
import type { EventMeta, SupportedEvent } from './meta.js';
import type { Client } from './client.js';
import { BadRequestError, NotFoundError } from './errors.js';
import { WorkerSearch, odataEscape } from './search.js';
import type { WorkerQuery } from './search.js';
import { buildMultipart, imageToBytes, sniffImageContentType } from './photos.js';

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

export interface OnboardParams {
  /** Tenant onboarding template. */
  onboardingTemplateCode: string;
  personal: {
    givenName: string;
    familyName: string;
    middleName?: string;
    /** YYYY-MM-DD */
    birthDate?: string;
    /** Also mirrored into genderReportingDetails. */
    genderCode?: string;
    raceCode?: string;
    raceIdentificationMethodCode?: string;
    ethnicityCode?: string;
    languageCode?: string;
    ssn?: string;
    address?: {
      lineOne: string;
      lineTwo?: string;
      cityName: string;
      stateCode: string;
      postalCode: string;
      /** Default "US". */
      countryCode?: string;
    };
    /**
     * 10-digit US phone number. A leading `+1` or `1` country-code prefix is
     * accepted and stripped; otherwise formatting is free-form (spaces,
     * dashes, parens — digits are extracted and split into 3-digit area +
     * remainder). Throws if what remains after stripping isn't exactly 10
     * digits.
     */
    homePhone?: string;
    /** Same format as `homePhone`. */
    mobilePhone?: string;
    email?: string;
  };
  worker: {
    /** YYYY-MM-DD */
    hireDate: string;
    hireReasonCode?: string;
    jobCode?: string;
    workerTypeCode?: string;
    /** homeOrganizationalUnits BusinessUnit entry. */
    businessUnitCode?: string;
    /** homeOrganizationalUnits HomeDepartment entry. */
    homeDepartmentCode?: string;
    reportsToPositionID?: string;
    eeoClassificationCode?: string;
    eeocClassificationCode?: string;
    /** Default false. */
    managementPositionIndicator?: boolean;
  };
  payroll: {
    /** Plain string on the wire (recorded). */
    payrollGroupCode: string;
    payCycleCode?: string;
    payrollScheduleGroupCode?: string;
    /** Tenant custom code fields (e.g. a DataControl entry) — passed through verbatim. */
    customCodeFields?: Array<{ nameCode: string; code: string }>;
  };
  tax?: {
    federal?: {
      taxFilingStatusCode?: string;
      /** allowanceTypeCode Deductions. */
      deductions?: number;
      /** allowanceTypeCode Dependents. */
      dependents?: number;
      additionalTaxAmount?: number;
      /** Default false. */
      multipleJobIndicator?: boolean;
    };
    state?: {
      /** workedInJurisdiction instruction. */
      workedInStateCode?: string;
      /** Second instruction, livedInJurisdiction. */
      livedInStateCode?: string;
      taxFilingStatusCode?: string;
      taxAllowanceQuantity?: number;
      additionalTaxAmount?: number;
    };
  };
  /** Deep-merged over the generated applicantOnboarding object last — the
   *  tenant escape hatch for anything not modeled above. Applied BEFORE
   *  validation (the validated body is the final body). */
  overrides?: Record<string, unknown>;
}

export interface WorkerPhoto {
  /** From the response Content-Type header. */
  contentType: string;
  bytes: Uint8Array;
}

export interface SetPhotoParams {
  associateOID: string;
  /** Image bytes, or a base64 string (decoded — the flow-step convention). */
  image: Uint8Array | string;
  /** datafile part Content-Type. Default: sniffed from magic bytes (jpeg/png), else image/jpeg. */
  contentType?: string;
  /** datafile part filename. Default "photo.jpg". */
  filename?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Objects merge recursively; arrays and scalars replace. Patch wins. */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    out[key] = isPlainRecord(value) && isPlainRecord(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}

/**
 * Recorded phone convention: digits only, first 3 = area, rest = dial.
 * Accepts (and strips) a leading US country code — either a bare '1' or a
 * '+1' — before re-checking length; whatever remains must be exactly 10
 * digits or this throws (rather than silently mis-splitting, e.g.
 * '+1 (612) 555-9876' -> digits '16125559876' -> a naive 3/rest split would
 * wrongly yield areaDialing '161').
 */
function phoneEntry(nameCodeValue: string, raw: string): Record<string, unknown> {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) {
    // Digit count only — never echo the raw value, it's contact-info PII.
    throw new Error(`${nameCodeValue}: expected a 10-digit US phone number, got ${digits.length} digits`);
  }
  return {
    nameCode: { codeValue: nameCodeValue },
    countryDialing: '1',
    areaDialing: digits.slice(0, 3),
    dialNumber: digits.slice(3),
  };
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
    const raw = await this.client.get(eventRoute(event).metaPath);
    const meta = parseEventMeta(event, raw, Date.now());
    this.metaCache.set(event, meta);
    return meta;
  }

  /**
   * Validated event pipeline — public escape hatch for any worker.* event.
   * Validates against cached meta (when client.validateEvents), POSTs, and on
   * an ADP 400 refreshes the meta once and re-validates to upgrade
   * stale-cache failures into readable errors. Never re-POSTs. Blocking issue
   * codes are per-event (`eventRoute`): `codeList` for the events family;
   * `codeList` + `required` for `applicant.onboard`. Live verification against
   * real tenant metas showed ADP overdeclares `required`/`readOnly`/`hidden`/
   * `pattern`/`length` constraints on fields that battle-tested envelopes have
   * always sent successfully, while code-list checks (the original motivation:
   * tenant reason-code validation) produced no false positives. Those other
   * constraint types remain computable via `eventMeta` + `validateEnvelope` for
   * diagnostics — they are advisory only and never block. Envelopes are
   * validated as single-event payloads: multiple entries under `events[]` are
   * flattened together rather than validated independently per entry.
   */
  async postEvent(event: SupportedEvent | (string & {}), envelope: unknown): Promise<unknown> {
    const route = eventRoute(event);
    const path = route.postPath;

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
    const blockingIssues = issues.filter((i) => route.blocking.includes(i.code));
    if (blockingIssues.length > 0) throw new EventValidationError(event, blockingIssues);

    try {
      return await this.client.post(path, envelope);
    } catch (error) {
      if (error instanceof BadRequestError) {
        let freshBlockingIssues;
        try {
          const fresh = await this.eventMeta(event, { forceRefresh: true });
          freshBlockingIssues = validateEnvelope(envelope, fresh).filter((i) => route.blocking.includes(i.code));
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

  /** Worker photo, or null when none exists (404/204 are normal states). */
  async getPhoto(aoid: string): Promise<WorkerPhoto | null> {
    try {
      const { status, headers, bytes } = await this.client.binaryRequest({
        method: 'GET',
        path: `/hr/v2/workers/${encodeURIComponent(aoid)}/worker-images/photo`,
        bytesResponse: true,
      });
      if (status === 204 || bytes === undefined) return null;
      return { contentType: headers.get('content-type') ?? 'application/octet-stream', bytes };
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  /**
   * Upload (replace) a worker's photo via the worker.photo.upload multipart
   * event. Preflight: the tenant meta's imageSize limit is enforced
   * client-side (fail-open when the meta is unavailable); actual resizing
   * belongs in the caller (see the README recipe).
   */
  async setPhoto(params: SetPhotoParams): Promise<unknown> {
    const bytes = imageToBytes(params.image);

    // Meta-driven size preflight (fail-open; reuses the negative cache).
    // Skipped entirely when client.validateEvents is false, consistent with postEvent.
    if (this.client.validateEvents) {
      let limit: number | undefined;
      if (Date.now() - (this.metaFailureAt.get('worker.photo.upload') ?? 0) >= META_FAILURE_TTL_MS) {
        try {
          const meta = await this.eventMeta('worker.photo.upload');
          limit = meta.rules.get('transform:/worker/photo/imageSize')?.maxLength;
        } catch {
          this.metaFailureAt.set('worker.photo.upload', Date.now());
          console.warn('worker.photo.upload: meta unavailable, skipping size preflight');
        }
      }
      if (limit !== undefined && bytes.byteLength > limit) {
        throw new Error(
          `photo is ${bytes.byteLength} bytes; tenant limit is ${limit} — resize before uploading`,
        );
      }
    }

    const envelope = JSON.stringify({
      events: [{ data: { eventContext: { worker: { associateOID: params.associateOID } } } }],
    });
    const { contentType, body } = buildMultipart([
      { name: 'json', value: envelope },
      {
        name: 'datafile',
        value: bytes,
        filename: params.filename ?? 'photo.jpg',
        contentType: params.contentType ?? sniffImageContentType(bytes),
      },
    ]);

    const { body: responseBody } = await this.client.binaryRequest({
      method: 'POST',
      path: '/events/hr/v1/worker.photo.upload',
      body,
      contentType,
    });
    return responseBody;
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

  /**
   * Onboard an applicant (Applicant Onboarding v2, POST /hcm/v2/applicant.onboard).
   * The body is validated against the tenant meta BEFORE posting — for this
   * event both `required` and `codeList` issues block (see eventRoute).
   * Envelope quirks follow the recorded production request verbatim: this
   * family uses {code} objects (communication nameCodes use codeValue),
   * governmentIDs use `id`, addresses use subdivisionCode, and
   * payrollGroupCode is a plain string.
   */
  async onboard(params: OnboardParams): Promise<unknown> {
    const { personal, worker, payroll, tax } = params;

    const communication: Record<string, unknown> = {};
    if (personal.homePhone) communication.landlines = [phoneEntry('Home Phone', personal.homePhone)];
    if (personal.mobilePhone) communication.mobiles = [phoneEntry('Personal Cell', personal.mobilePhone)];
    if (personal.email) {
      communication.emails = [
        { nameCode: { codeValue: 'Personal E-mail' }, emailUri: personal.email, notificationIndicator: true },
      ];
    }

    const personalProfile: Record<string, unknown> = {
      birthName: {
        givenName: personal.givenName,
        ...(personal.middleName !== undefined ? { middleName: personal.middleName } : {}),
        familyName: personal.familyName,
      },
      ...(personal.birthDate !== undefined ? { birthDate: personal.birthDate } : {}),
      ...(personal.genderCode !== undefined
        ? {
            genderCode: { code: personal.genderCode },
            genderReportingDetails: { reportedGenderCode: { code: personal.genderCode } },
          }
        : {}),
      ...(personal.raceCode !== undefined
        ? {
            raceCode: {
              ...(personal.raceIdentificationMethodCode !== undefined
                ? { identificationMethodCode: { code: personal.raceIdentificationMethodCode } }
                : {}),
              code: personal.raceCode,
            },
          }
        : {}),
      ...(personal.ethnicityCode !== undefined ? { ethnicityCode: { code: personal.ethnicityCode } } : {}),
      ...(personal.languageCode !== undefined ? { languageCode: { code: personal.languageCode } } : {}),
      ...(personal.address !== undefined
        ? {
            legalAddress: {
              lineOne: personal.address.lineOne,
              ...(personal.address.lineTwo !== undefined ? { lineTwo: personal.address.lineTwo } : {}),
              cityName: personal.address.cityName,
              subdivisionCode: { code: personal.address.stateCode },
              countryCode: personal.address.countryCode ?? 'US',
              postalCode: personal.address.postalCode,
            },
          }
        : {}),
      ...(Object.keys(communication).length > 0 ? { communication } : {}),
      ...(personal.ssn !== undefined
        ? { governmentIDs: [{ id: personal.ssn, nameCode: { code: 'SSN' } }] }
        : {}),
    };

    const workerProfile: Record<string, unknown> = {
      hireDate: worker.hireDate,
      ...(worker.hireReasonCode !== undefined ? { hireReasonCode: { code: worker.hireReasonCode } } : {}),
      ...(worker.businessUnitCode !== undefined || worker.homeDepartmentCode !== undefined
        ? {
            homeOrganizationalUnits: [
              ...(worker.businessUnitCode !== undefined
                ? [{ unitTypeCode: { code: 'BusinessUnit' }, nameCode: { code: worker.businessUnitCode } }]
                : []),
              ...(worker.homeDepartmentCode !== undefined
                ? [{ unitTypeCode: { code: 'HomeDepartment' }, nameCode: { code: worker.homeDepartmentCode } }]
                : []),
            ],
          }
        : {}),
      ...(worker.jobCode !== undefined ||
      worker.eeoClassificationCode !== undefined ||
      worker.eeocClassificationCode !== undefined
        ? {
            job: {
              ...(worker.jobCode !== undefined ? { jobCode: { code: worker.jobCode } } : {}),
              ...(worker.eeoClassificationCode !== undefined || worker.eeocClassificationCode !== undefined
                ? {
                    occupationalClassifications: [
                      ...(worker.eeocClassificationCode !== undefined
                        ? [{ classificationID: { code: 'EEOC' }, classificationCode: { code: worker.eeocClassificationCode } }]
                        : []),
                      ...(worker.eeoClassificationCode !== undefined
                        ? [{ classificationID: { code: 'EEO' }, classificationCode: { code: worker.eeoClassificationCode } }]
                        : []),
                    ],
                  }
                : {}),
            },
          }
        : {}),
      ...(worker.reportsToPositionID !== undefined ? { reportsTo: { positionID: worker.reportsToPositionID } } : {}),
      ...(worker.workerTypeCode !== undefined ? { workerTypeCode: { code: worker.workerTypeCode } } : {}),
      managementPositionIndicator: worker.managementPositionIndicator ?? false,
    };

    const payrollProfile: Record<string, unknown> = {
      payrollGroupCode: payroll.payrollGroupCode, // plain string on the wire (recorded)
      ...(payroll.payCycleCode !== undefined ? { payCycleCode: { code: payroll.payCycleCode } } : {}),
      ...(payroll.payrollScheduleGroupCode !== undefined
        ? { payrollScheduleGroupCode: payroll.payrollScheduleGroupCode }
        : {}),
      ...(payroll.customCodeFields !== undefined && payroll.customCodeFields.length > 0
        ? {
            customFieldGroup: {
              codeFields: payroll.customCodeFields.map((f) => ({ nameCode: { code: f.nameCode }, code: f.code })),
            },
          }
        : {}),
    };

    const taxProfile: Record<string, unknown> = {};
    if (tax?.federal) {
      const f = tax.federal;
      taxProfile.usFederalTaxInstruction = {
        federalIncomeTaxInstruction: {
          ...(f.taxFilingStatusCode !== undefined ? { taxFilingStatusCode: { code: f.taxFilingStatusCode } } : {}),
          ...(f.additionalTaxAmount !== undefined ? { additionalTaxAmount: { amount: f.additionalTaxAmount } } : {}),
          ...(f.deductions !== undefined || f.dependents !== undefined
            ? {
                taxAllowances: [
                  ...(f.deductions !== undefined
                    ? [{ allowanceTypeCode: { code: 'Deductions' }, taxAllowanceAmount: { amount: f.deductions } }]
                    : []),
                  ...(f.dependents !== undefined
                    ? [{ allowanceTypeCode: { code: 'Dependents' }, taxAllowanceAmount: { amount: f.dependents } }]
                    : []),
                ],
              }
            : {}),
        },
        multipleJobIndicator: f.multipleJobIndicator ?? false,
      };
    }
    if (tax?.state) {
      const s = tax.state;
      const instructions: Array<Record<string, unknown>> = [];
      if (s.workedInStateCode !== undefined) {
        instructions.push({
          stateCode: { code: s.workedInStateCode },
          workedInJurisdictionIndicator: true,
          ...(s.taxFilingStatusCode !== undefined ? { taxFilingStatusCode: { code: s.taxFilingStatusCode } } : {}),
          ...(s.taxAllowanceQuantity !== undefined ? { taxAllowanceQuantity: s.taxAllowanceQuantity } : {}),
          ...(s.additionalTaxAmount !== undefined ? { additionalTaxAmount: { amount: s.additionalTaxAmount } } : {}),
        });
      }
      if (s.livedInStateCode !== undefined) {
        instructions.push({ livedInJurisdictionIndicator: true, stateCode: { code: s.livedInStateCode } });
      }
      if (instructions.length > 0) taxProfile.usStateTaxInstructions = { stateIncomeTaxInstructions: instructions };
    }

    let applicantOnboarding: Record<string, unknown> = {
      onboardingTemplateCode: { code: params.onboardingTemplateCode },
      onboardingStatus: { statusCode: { code: 'inprogress' } },
      applicantPayrollProfile: payrollProfile,
      applicantPersonalProfile: personalProfile,
      ...(Object.keys(taxProfile).length > 0 ? { applicantTaxProfile: taxProfile } : {}),
      applicantWorkerProfile: workerProfile,
    };
    if (params.overrides) applicantOnboarding = deepMerge(applicantOnboarding, params.overrides);

    const body = await this.postEvent('applicant.onboard', { applicantOnboarding });
    return body ?? null;
  }
}
