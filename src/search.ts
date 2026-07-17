import type { Client } from './client.js';
import type { WorkerRecord } from './worker.js';

export interface WorkerQuery {
  givenName?: string;    // legalName/givenName
  familyName?: string;   // legalName/familyName1
  status?: string;       // workAssignments/assignmentStatus/statusCode/codeValue
  /** Raw OData $filter escape hatch — used verbatim as the server predicate. */
  filter?: string;
  /**
   * $select projection paths matching the worker graph, e.g.
   * ['workers/associateOID', 'workers/person/legalName'] (bare paths without
   * the workers/ prefix also work — live-verified 2026-07-16, as is composing
   * with $filter). Caller's responsibility: a name query's residual filtering
   * reads person/legalName, so keep it in the projection.
   */
  select?: string[];
  pageSize?: number;     // default 100
}

export interface WorkerPage {
  workers: WorkerRecord[];
  index: number;
  /** True iff the server returned 204/empty. May be false while workers is
   *  empty (residual filtering) — loop on done, never on workers.length. */
  done: boolean;
  next: number | null;
}

/** OData string-literal escaping: single quotes are doubled. */
export function odataEscape(value: string): string {
  return value.replaceAll("'", "''");
}

type Residual = (worker: WorkerRecord) => boolean;

function legalName(worker: WorkerRecord): Record<string, unknown> | undefined {
  const person = worker.person as Record<string, unknown> | undefined;
  return person?.legalName as Record<string, unknown> | undefined;
}

function matchesGivenName(worker: WorkerRecord, value: string): boolean {
  return legalName(worker)?.givenName === value;
}

function matchesFamilyName(worker: WorkerRecord, value: string): boolean {
  return legalName(worker)?.familyName1 === value;
}

function matchesStatus(worker: WorkerRecord, value: string): boolean {
  const assignments = worker.workAssignments as Array<Record<string, any>> | undefined;
  return Boolean(
    assignments?.some((a) => a?.assignmentStatus?.statusCode?.codeValue === value),
  );
}

/**
 * ADP's $filter `and`-support is per-field-combo and fails unsafely (name
 * `and` combos 500 server-side), so at most ONE predicate is sent to the
 * server; every other query field is applied client-side per page.
 * Precedence: filter (raw) > familyName > givenName > status.
 */
export function planQuery(query: WorkerQuery): {
  serverFilter?: string;
  residual: Residual;
} {
  const residuals: Residual[] = [];
  let serverFilter: string | undefined;

  if (query.filter != null) serverFilter = query.filter;

  if (query.familyName != null) {
    if (serverFilter === undefined) {
      serverFilter = `workers/person/legalName/familyName1 eq '${odataEscape(query.familyName)}'`;
    } else {
      residuals.push((w) => matchesFamilyName(w, query.familyName!));
    }
  }
  if (query.givenName != null) {
    if (serverFilter === undefined) {
      serverFilter = `workers/person/legalName/givenName eq '${odataEscape(query.givenName)}'`;
    } else {
      residuals.push((w) => matchesGivenName(w, query.givenName!));
    }
  }
  if (query.status != null) {
    if (serverFilter === undefined) {
      serverFilter = `workers/workAssignments/assignmentStatus/statusCode/codeValue eq '${odataEscape(query.status)}'`;
    } else {
      residuals.push((w) => matchesStatus(w, query.status!));
    }
  }

  return { serverFilter, residual: (w) => residuals.every((r) => r(w)) };
}

/** Lazy search handle: fetches nothing until page()/pages()/all()/find(). */
export class WorkerSearch {
  constructor(
    private readonly client: Client,
    private readonly query: WorkerQuery = {},
  ) {}

  /** Stateless random access — one HTTP request. For flow-engine loops. */
  async page(index: number): Promise<WorkerPage> {
    const pageSize = this.query.pageSize ?? 100;
    const { serverFilter, residual } = planQuery(this.query);
    let path = `/hr/v2/workers?$top=${pageSize}&$skip=${index * pageSize}`;
    if (serverFilter !== undefined) path += `&$filter=${encodeURIComponent(serverFilter)}`;
    if (this.query.select?.length) path += `&$select=${encodeURIComponent(this.query.select.join(','))}`;
    const response = (await this.client.get(path)) as { workers?: WorkerRecord[] } | undefined;
    const fetched = response?.workers;
    const done = !fetched || fetched.length === 0;
    return {
      workers: done ? [] : fetched.filter(residual),
      index,
      done,
      next: done ? null : index + 1,
    };
  }

  /** Stream of pages, one request per iteration; the terminal done page is yielded. */
  async *pages(): AsyncGenerator<WorkerPage, void, void> {
    for (let index = 0; ; index++) {
      const page = await this.page(index);
      yield page;
      if (page.done) return;
    }
  }

  /** @deprecated Accumulates every page in memory; prefer pages(). Removal candidate for 4.0. */
  async all(): Promise<WorkerRecord[]> {
    const result: WorkerRecord[] = [];
    for await (const page of this.pages()) result.push(...page.workers);
    return result;
  }

  /** @deprecated Sugar over pages() — see the README recipe. Removal candidate for 4.0. */
  async find(predicate: (worker: WorkerRecord) => boolean): Promise<WorkerRecord | undefined> {
    for await (const page of this.pages()) {
      const match = page.workers.find(predicate);
      if (match) return match;
    }
    return undefined;
  }
}
