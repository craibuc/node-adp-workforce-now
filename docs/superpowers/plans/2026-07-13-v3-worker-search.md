# v3 Worker Read/Search Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2.x worker read surface with `worker.get` (aoid/ssn keyed lookup) + lazy `worker.search` handle (`page`/`pages` core, `all`/`find` deprecated) speaking a stateless `WorkerPage {workers,index,done,next}` protocol.

**Architecture:** New `src/search.ts` owns the query model: single-server-predicate planning (`planQuery`), OData escaping, residual client-side filtering, and the `WorkerSearch` class. `src/worker.ts` loses its five read methods and gains `get` (routing `{ssn}` through the existing `postEvent('worker.read', …)` pipeline) and a one-line `search()` factory. Breaking release 3.0.0.

**Tech Stack:** Existing v2 codebase — TypeScript strict/NodeNext, `bun test`, fake-transport injection.

**Spec:** `docs/superpowers/specs/2026-07-13-v3-worker-search-design.md` — read it before starting any task; its Evidence section explains every backend rule.

## Global Constraints

- Zero runtime dependencies; ESM `.js` relative imports in `src/`.
- **At most ONE server-side `$filter` predicate per request** (precedence: `filter` > `familyName` > `givenName` > `status`); remaining query fields are client-side residual filters inside `page()`. Compound name `and` predicates 500 on ADP — the library must never emit them.
- OData string values: single quotes doubled (`O'Brien` → `O''Brien`), then the whole `$filter` expression percent-encoded into the URL.
- `WorkerPage.done` is true iff the server returned 204 or zero workers; `next` = `index + 1` or `null`. A page may have `workers: []` with `done: false` (residual filtering) — tests must pin this.
- `get({ ssn })` uses EXACTLY the recorded `worker.read` envelope (serviceCategoryCode + eventNameCode + `data.transform.queryParameter`); result from `events[0].data.output.workers[0]`.
- `worker.read` joins `SupportedEvent`. Its known meta shape: a single rule `transform:/queryParameter` `{optional:false, readOnly:true, hidden:true}` — codeList-only blocking means the pipeline never blocks it.
- Removals (breaking, 3.0.0): `Worker.one/page/pages/all/find/hireMeta`. Deprecations (kept): `WorkerSearch.all/find` with `@deprecated` JSDoc naming the replacement.
- No company/tenant identifiers in committed files (grep for line 1 of gitignored `CLAUDE.local.md`).
- Real ADP credentials exist in this environment — live tests RUN during full-suite verification; that is expected and required.
- Work on branch `v3-worker-search`. `bun test`, `bun run typecheck`, `npm run test:node` after every task.

---

### Task 1: `src/search.ts` — query planning + WorkerSearch

**Files:**
- Create: `src/search.ts`
- Test: `tests/worker-search.test.ts`

**Interfaces:**
- Consumes: `Client.get(path)` (204 → `undefined`), `WorkerRecord` from `./worker.js`, test helpers `TOKEN_RESPONSE`/`makeFakeTransport`.
- Produces (Task 2/3 rely on these exact names):
  - `interface WorkerQuery { givenName?: string; familyName?: string; status?: string; filter?: string; pageSize?: number }`
  - `interface WorkerPage { workers: WorkerRecord[]; index: number; done: boolean; next: number | null }`
  - `function odataEscape(value: string): string`
  - `function planQuery(query: WorkerQuery): { serverFilter?: string; residual: (w: WorkerRecord) => boolean }`
  - `class WorkerSearch { constructor(client: Client, query?: WorkerQuery); page(index: number): Promise<WorkerPage>; pages(): AsyncGenerator<WorkerPage, void, void>; all(): Promise<WorkerRecord[]>; find(predicate: (w: WorkerRecord) => boolean): Promise<WorkerRecord | undefined> }`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b v3-worker-search
```

- [ ] **Step 2: Write the failing tests**

Create `tests/worker-search.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { WorkerSearch, odataEscape, planQuery } from '../src/search.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport });
  return { client, calls };
}

const person = (given: string, family: string) => ({ legalName: { givenName: given, familyName1: family } });
const w = (id: string, given = 'First', family = 'Last', statusCode?: string) => ({
  associateOID: id,
  person: person(given, family),
  ...(statusCode ? { workAssignments: [{ assignmentStatus: { statusCode: { codeValue: statusCode } } }] } : {}),
});

describe('odataEscape', () => {
  it('doubles single quotes', () => {
    expect(odataEscape("O'Brien")).toBe("O''Brien");
    expect(odataEscape('plain')).toBe('plain');
  });
});

describe('planQuery — single server predicate with precedence', () => {
  it('empty query: no server filter, residual passes everything', () => {
    const plan = planQuery({});
    expect(plan.serverFilter).toBeUndefined();
    expect(plan.residual(w('A') as never)).toBe(true);
  });

  it('familyName becomes the server predicate', () => {
    expect(planQuery({ familyName: "O'Hara" }).serverFilter).toBe(
      "workers/person/legalName/familyName1 eq 'O''Hara'",
    );
  });

  it('both names: familyName server-side, givenName residual', () => {
    const plan = planQuery({ familyName: 'Last', givenName: 'First' });
    expect(plan.serverFilter).toContain('familyName1');
    expect(plan.serverFilter).not.toContain('givenName');
    expect(plan.residual(w('A', 'First', 'Last') as never)).toBe(true);
    expect(plan.residual(w('B', 'Other', 'Last') as never)).toBe(false);
  });

  it('raw filter outranks everything; named fields all become residual', () => {
    const plan = planQuery({ filter: 'custom eq 1', familyName: 'Last', status: 'A' });
    expect(plan.serverFilter).toBe('custom eq 1');
    expect(plan.residual(w('A', 'First', 'Last', 'A') as never)).toBe(true);
    expect(plan.residual(w('B', 'First', 'Last', 'T') as never)).toBe(false); // status residual
    expect(plan.residual(w('C', 'First', 'Nope', 'A') as never)).toBe(false); // family residual
  });

  it('status alone is the server predicate', () => {
    expect(planQuery({ status: 'T' }).serverFilter).toBe(
      "workers/workAssignments/assignmentStatus/statusCode/codeValue eq 'T'",
    );
  });
});

describe('WorkerSearch.page', () => {
  it('unfiltered: URL matches the classic $top/$skip shape', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [w('A')] } }]);
    const page = await new WorkerSearch(client, { pageSize: 2 }).page(3);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers?$top=2&$skip=6');
    expect(page).toEqual({ workers: [w('A')] as never, index: 3, done: false, next: 4 });
  });

  it('server filter is percent-encoded into the URL', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [] } }]);
    await new WorkerSearch(client, { familyName: 'Last' }).page(0);
    expect(calls[1].url).toBe(
      'https://api.adp.com/hr/v2/workers?$top=100&$skip=0&$filter=' +
        encodeURIComponent("workers/person/legalName/familyName1 eq 'Last'"),
    );
  });

  it('204 → done page with empty workers and null next', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    const page = await new WorkerSearch(client).page(5);
    expect(page).toEqual({ workers: [], index: 5, done: true, next: null });
  });

  it('residual filtering can empty a page WITHOUT ending the stream', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A', 'Nope', 'Last'), w('B', 'Nada', 'Last')] } },
    ]);
    const page = await new WorkerSearch(client, { familyName: 'Last', givenName: 'First' }).page(0);
    expect(page.workers).toEqual([]);
    expect(page.done).toBe(false); // loop on done, never on workers.length
    expect(page.next).toBe(1);
  });
});

describe('WorkerSearch.pages', () => {
  it('yields every page including the terminal done page, then stops', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      { status: 200, json: { workers: [w('C')] } },
      { status: 204 },
    ]);
    const seen: Array<{ n: number; done: boolean }> = [];
    for await (const page of new WorkerSearch(client, { pageSize: 2 }).pages()) {
      seen.push({ n: page.workers.length, done: page.done });
    }
    expect(seen).toEqual([{ n: 2, done: false }, { n: 1, done: false }, { n: 0, done: true }]);
    expect(calls).toHaveLength(4); // token + 3 pages
  });
});

describe('deprecated conveniences', () => {
  it('all() accumulates residual-filtered workers across pages', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A', 'First', 'Last'), w('B', 'Nope', 'Last')] } },
      { status: 204 },
    ]);
    const all = await new WorkerSearch(client, { familyName: 'Last', givenName: 'First' }).all();
    expect(all.map((x) => x.associateOID)).toEqual(['A']);
  });

  it('find() early-exits without fetching later pages', async () => {
    const { client, calls } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { workers: [w('A'), w('B')] } },
      // nothing else queued: fetching page 1 would throw "queue empty"
    ]);
    const match = await new WorkerSearch(client).find((x) => x.associateOID === 'B');
    expect(match?.associateOID).toBe('B');
    expect(calls).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/worker-search.test.ts`
Expected: FAIL — cannot resolve `../src/search.js`.

- [ ] **Step 4: Implement `src/search.ts`**

```typescript
import type { Client } from './client.js';
import type { WorkerRecord } from './worker.js';

export interface WorkerQuery {
  givenName?: string;    // legalName/givenName
  familyName?: string;   // legalName/familyName1
  status?: string;       // workAssignments/assignmentStatus/statusCode/codeValue
  /** Raw OData $filter escape hatch — used verbatim as the server predicate. */
  filter?: string;
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

  if (query.filter !== undefined) serverFilter = query.filter;

  if (query.familyName !== undefined) {
    if (serverFilter === undefined) {
      serverFilter = `workers/person/legalName/familyName1 eq '${odataEscape(query.familyName)}'`;
    } else {
      residuals.push((w) => matchesFamilyName(w, query.familyName!));
    }
  }
  if (query.givenName !== undefined) {
    if (serverFilter === undefined) {
      serverFilter = `workers/person/legalName/givenName eq '${odataEscape(query.givenName)}'`;
    } else {
      residuals.push((w) => matchesGivenName(w, query.givenName!));
    }
  }
  if (query.status !== undefined) {
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/worker-search.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/search.ts tests/worker-search.test.ts
git commit -m "feat: WorkerSearch — lazy handle, single-server-predicate planning, WorkerPage protocol"
```

---

### Task 2: `Worker.get` + `Worker.search`; remove the 2.x read surface

**Files:**
- Modify: `src/worker.ts` (add `WorkerKey`, `get`, `search`; DELETE `one`, `page`, `pages`, `all`, `find`, `hireMeta`), `src/meta.ts` (add `'worker.read'` to `SupportedEvent`), `tests/event-meta.test.ts` (delete the `worker.hireMeta (deprecated)` describe block)
- Delete + recreate: `tests/worker-reads.test.ts` (becomes get-only; search behavior lives in Task 1's file)

**Interfaces:**
- Consumes: `WorkerSearch`, `WorkerQuery`, `odataEscape` (Task 1); existing `postEvent` (validated pipeline) and `client.get`.
- Produces:
  - `export type WorkerKey = string | { aoid: string } | { ssn: string }`
  - `Worker.get(key: WorkerKey): Promise<WorkerRecord | undefined>`
  - `Worker.search(query?: WorkerQuery): WorkerSearch`

- [ ] **Step 1: Rewrite `tests/worker-reads.test.ts` (failing tests first)**

Replace the entire file with:

```typescript
import { describe, expect, it } from 'bun:test';
import { Client } from '../src/client.js';
import { WorkerSearch } from '../src/search.js';
import { TOKEN_RESPONSE, makeFakeTransport } from './helpers/fake-transport.js';

const PEM = '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n';
const CREDS = { client_id: 'id-1', client_secret: 'secret-1' };

/** validateEvents off: get({ssn}) wire-format tests want the POST at calls[1]. */
function makeClient(responses: Parameters<typeof makeFakeTransport>[0]) {
  const { transport, calls } = makeFakeTransport(responses);
  const client = new Client(PEM, PEM, { credentials: CREDS, transport, validateEvents: false });
  return { client, calls };
}

const WORKER = { associateOID: 'G0FAKEFAKEFAKE1A' };

describe('worker.get by aoid', () => {
  it('accepts the string shorthand', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [WORKER] } }]);
    expect(await client.worker.get('G0FAKEFAKEFAKE1A')).toEqual(WORKER);
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/G0FAKEFAKEFAKE1A');
    expect(calls[1].method).toBe('GET');
  });

  it('accepts { aoid } and percent-encodes it', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, { status: 200, json: { workers: [WORKER] } }]);
    await client.worker.get({ aoid: 'A/B' });
    expect(calls[1].url).toBe('https://api.adp.com/hr/v2/workers/A%2FB');
  });

  it('returns undefined on 204', async () => {
    const { client } = makeClient([TOKEN_RESPONSE, { status: 204 }]);
    expect(await client.worker.get('G0FAKEFAKEFAKE1A')).toBeUndefined();
  });
});

describe('worker.get by ssn (worker.read event)', () => {
  const READ_HIT = {
    status: 200,
    json: { events: [{ data: { output: { workers: [WORKER] } } }] },
  };

  it('POSTs the recorded worker.read envelope', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, READ_HIT]);

    const found = await client.worker.get({ ssn: '123-45-6789' });

    expect(found).toEqual(WORKER);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toBe('https://api.adp.com/events/hr/v1/worker.read');
    const event = JSON.parse(calls[1].body!).events[0];
    expect(event.serviceCategoryCode).toEqual({ codeValue: 'hr' });
    expect(event.eventNameCode).toEqual({ codeValue: 'worker.read' });
    expect(event.data.transform.queryParameter).toBe(
      "$filter=person/governmentIDs[0]/idValue eq '123-45-6789' and person/governmentIDs[0]/nameCode eq 'SSN'",
    );
  });

  it('doubles single quotes in the ssn value', async () => {
    const { client, calls } = makeClient([TOKEN_RESPONSE, READ_HIT]);
    await client.worker.get({ ssn: "12'3" });
    expect(JSON.parse(calls[1].body!).events[0].data.transform.queryParameter).toContain("eq '12''3'");
  });

  it('returns undefined when the output has no workers', async () => {
    const { client } = makeClient([
      TOKEN_RESPONSE,
      { status: 200, json: { events: [{ data: { output: { workers: [] } } }] } },
    ]);
    expect(await client.worker.get({ ssn: '000-00-0000' })).toBeUndefined();
  });
});

describe('worker.search', () => {
  it('returns a lazy WorkerSearch handle without fetching', async () => {
    const { client, calls } = makeClient([]);
    const handle = client.worker.search({ familyName: 'Last' });
    expect(handle).toBeInstanceOf(WorkerSearch);
    expect(calls).toHaveLength(0); // nothing fetched until a method is called
  });
});

describe('removed 2.x surface', () => {
  it('one/page/pages/all/find/hireMeta are gone from Worker', () => {
    const { client } = makeClient([]);
    for (const name of ['one', 'page', 'pages', 'all', 'find', 'hireMeta']) {
      expect((client.worker as unknown as Record<string, unknown>)[name]).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Delete the hireMeta test**

In `tests/event-meta.test.ts`, delete the entire `describe('worker.hireMeta (deprecated)', …)` block (it asserts a method this task removes).

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/worker-reads.test.ts`
Expected: FAIL — `client.worker.get is not a function` (and the removed-surface test fails because the old methods still exist).

- [ ] **Step 4: Implement in `src/worker.ts`**

Add imports at the top (alongside the existing meta imports):

```typescript
import { WorkerSearch, odataEscape } from './search.js';
import type { WorkerQuery } from './search.js';
```

Add the key type after `WorkerRecord`:

```typescript
export type WorkerKey = string | { aoid: string } | { ssn: string };
```

DELETE the `one`, `page`, `pages`, `all`, `find`, and `hireMeta` methods entirely. In their place add:

```typescript
  /** Fetch one worker by key: aoid (string shorthand or { aoid }) or { ssn }. */
  async get(key: WorkerKey): Promise<WorkerRecord | undefined> {
    const k = typeof key === 'string' ? { aoid: key } : key;
    if ('ssn' in k) {
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
    const response = (await this.client.get(
      `/hr/v2/workers/${encodeURIComponent(k.aoid)}`,
    )) as { workers?: WorkerRecord[] } | undefined;
    return response?.workers?.[0];
  }

  /** Lazy search handle — fetches nothing until page()/pages()/all()/find(). */
  search(query: WorkerQuery = {}): WorkerSearch {
    return new WorkerSearch(this.client, query);
  }
```

Note: `WorkerSearch`'s constructor takes the `Client`; `Worker.client` is `protected readonly`, accessible here.

In `src/meta.ts`, extend the `SupportedEvent` union with a final member:

```typescript
  | 'worker.read';
```

- [ ] **Step 5: Fix remaining compile errors**

`bun run typecheck` will flag every leftover consumer of the removed methods (there should be none in `src/`; test/example/live files are handled in Task 3 — if typecheck trips on THOSE, leave them for Task 3 and run typecheck scoped: the project tsconfig only includes `src/`, so it will be clean here).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/worker-reads.test.ts tests/worker-search.test.ts tests/event-meta.test.ts && bun run typecheck`
Expected: PASS. (`bun test` full-suite still fails at this point — live tests and others reference `one()`; Task 3 fixes them. Do NOT run the full suite as this task's gate.)

- [ ] **Step 7: Commit**

```bash
git add src/worker.ts src/meta.ts tests/worker-reads.test.ts tests/event-meta.test.ts
git commit -m "feat!: Worker.get (aoid/ssn via worker.read) + Worker.search; remove one/page/pages/all/find/hireMeta"
```

---

### Task 3: Exports, live tests, examples

**Files:**
- Modify: `src/index.ts`, `tests/index.test.ts`, `tests/integration/live.test.ts`, `tests/integration/live-meta.test.ts`, `examples/node/get-worker.mjs`, `examples/windmill/smoke-library.ts`

**Interfaces:**
- Consumes: everything Tasks 1–2 produced.
- Produces: public exports `WorkerSearch` (value), `WorkerKey`/`WorkerQuery`/`WorkerPage` (types); a green FULL suite including live tests.

- [ ] **Step 1: Exports + index test**

In `src/index.ts`: add `WorkerKey` to the `export type { … } from './worker.js'` list, and add:

```typescript
export { WorkerSearch } from './search.js';
export type { WorkerPage, WorkerQuery } from './search.js';
```

In `tests/index.test.ts`, add to the surface test:

```typescript
    expect(api.WorkerSearch).toBeFunction();
```

- [ ] **Step 2: Update the live smoke test**

In `tests/integration/live.test.ts`, change the worker-read case from `worker.one(…)` to:

```typescript
    const worker = await liveClient().worker.get(ADP_ASSOCIATE_OID!);
```

(assertion unchanged: `worker?.associateOID` equals the env AOID).

- [ ] **Step 3: Extend the live gate**

In `tests/integration/live-meta.test.ts`, inside the `describe.skipIf(!hasCredentials)` block, after the per-event loop add:

```typescript
  it('worker.read meta parses (single overdeclared queryParameter rule)', async () => {
    const meta = await liveClient().worker.eventMeta('worker.read');
    expect(meta.raw).toBeTruthy();
    expect(meta.rules.has('transform:/queryParameter')).toBe(true);
  }, 20000);

  it('get({ ssn }) miss-probe returns undefined (fake SSN, no PII)', async () => {
    expect(await liveClient().worker.get({ ssn: '000-00-0000' })).toBeUndefined();
  }, 20000);

  const testSsn = process.env.ADP_TEST_SSN;
  it.skipIf(!testSsn)('get({ ssn }) hit-probe finds a worker', async () => {
    const worker = await liveClient().worker.get({ ssn: testSsn! });
    expect(worker?.associateOID).toBeTruthy();
  }, 20000);
```

(`worker.read` is NOT added to the coverage-fraction `ENVELOPES` loop — its envelope has a single `queryParameter` leaf and the dedicated meta test above covers it.)

- [ ] **Step 4: Update the examples**

`examples/node/get-worker.mjs`: replace the `one(...)` call with `get(...)`, and the else-branch page fetch with:

```javascript
  const page = await client.worker.search({ pageSize: 10 }).page(0);
  console.log(`first page: ${page.workers.length} workers (done: ${page.done})`);
  for (const worker of page.workers) {
    console.log(`- ${worker.associateOID}`);
  }
```

`examples/windmill/smoke-library.ts`: change `client.worker.one(associateOID)` to `client.worker.get(associateOID)` (comment noting it requires `@craibuc/adp-workforce-now@>=3`).

- [ ] **Step 5: Full verification (live tests RUN)**

Run: `bun test && bun run typecheck && npm run test:node`
Expected: ALL pass — including the live gate (7 event metas + `worker.read` meta + the ssn miss-probe against real ADP). If the miss-probe throws instead of returning `undefined` (tenant rejects the fake-SSN filter with a 400), STOP and report the exact error as a concern — do not weaken the assertion silently.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts tests/integration/ examples/
git commit -m "feat: export v3 search surface; live worker.read gate; examples on get/search"
```

---

### Task 4: README + coverage table

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the Usage section**

Replace the worker examples in `## Usage` with:

````markdown
```typescript
import { Client } from '@craibuc/adp-workforce-now';

// PEM strings may be raw or base64-encoded (auto-detected).
const client = new Client(certificatePem, privateKeyPem, {
  credentials: { client_id, client_secret }, // lazy auto-auth + 401 retry
});

// keyed lookup — one worker or undefined
const byAoid = await client.worker.get('G0FAKEFAKEFAKE1A');
const bySsn = await client.worker.get({ ssn: '123-45-6789' });

// search() is LAZY: it fetches nothing until you call a method on it
const search = client.worker.search({ familyName: 'Duck', status: 'A' });

const page = await search.page(0);       // one request — { workers, index, done, next }
for await (const p of search.pages()) {  // stream — one request per iteration
  console.log(p.workers.length, p.done);
}
```

Early-exit scan recipe (test each worker with arbitrary code, stop at the
first hit — this is what the deprecated `.find()` does internally):

```typescript
for await (const { workers } of client.worker.search({ status: 'A' }).pages()) {
  const match = workers.find((w) => w.workerID?.idValue === '000123');
  if (match) return match;
}
```

Flow-engine loops (e.g. a Windmill while-loop, one iteration per page): call
`search(query).page(n)` each iteration and loop on `done` — **never on
`workers.length`**, which can be 0 mid-stream when client-side residual
filters (e.g. the second name in a two-name query) empty a page.
````

- [ ] **Step 2: Update the coverage table**

- Replace the list-workers row with:
  `| ✅ | `GET /hr/v2/workers` (`$top`/`$skip`, single `$filter` predicate) | `Worker.search` → `page` / `pages` (`all` / `find` deprecated) | Lazy search handle; stateless `WorkerPage {workers, index, done, next}` protocol; extra query fields filtered client-side (ADP's compound name filters are broken server-side) |`
- Replace the get-single-worker row's Library API with `Worker.get` (description: "Fetch a single worker by associate OID (string or `{ aoid }`)").
- Add after it: `| ✅ | `POST /events/hr/v1/worker.read` | `Worker.get({ ssn })` | Look up a single worker by government ID; ADP's read-event filter supports IDs but not name paths |`
- Delete the `Worker.hireMeta` row (method removed; `Worker.eventMeta` row already covers metas).
- Remove the two 🔜 search rows (`Worker.findByName` / `Worker.findBySSN`) — superseded by `search`/`get({ssn})`, now ✅.
- Legend: `✅ implemented (2.0.0–3.0.0)`.

- [ ] **Step 3: Verify + commit**

```bash
grep -rin "$(head -1 CLAUDE.local.md)" README.md; echo "scrub: $?"   # expect 1
bun test 2>&1 | tail -3
git add README.md
git commit -m "docs: README usage + coverage for the v3 get/search surface"
```

---

## Post-plan (outside this plan)

1. Final whole-branch review (most capable model), fix wave if needed.
2. Squash-merge `v3-worker-search` to main.
3. Release: `npm version 3.0.0 && git push origin main --follow-tags`. Release-description migration notes: `one(aoid)` → `get(aoid)`; `page(i, size)` → `search({ pageSize: size }).page(i)` (returns `WorkerPage`, not an array); `pages(size)` → `search({ pageSize: size }).pages()` (yields `WorkerPage`); `all()` → `search().all()` (deprecated); `find(p)` → `search().find(p)` (deprecated); `hireMeta()` → `eventMeta('worker.hire')` (returns parsed meta; `.raw` for the old body).
4. Update the deployed Windmill scripts that referenced `worker.one` when they next pin `>=3`.
