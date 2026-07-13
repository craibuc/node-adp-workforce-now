# adp-workforce-now v3.0.0 — Worker Read/Search Redesign

**Date:** 2026-07-13
**Status:** Approved
**Scope:** Consolidate the worker read surface (`one`/`page`/`pages`/`all`/
`find` + the planned `findBySSN`/`findByName`) into `get` + `search`, with a
stateless page protocol carrying an explicit end-of-records signal. Breaking
release (3.0.0). Everything else (events, meta pipeline, token stores,
transports) is untouched.

## Why (and the evidence)

The 2.x read surface accreted: five methods with inconsistent names, a
generator flow engines can't hold across iterations, and an
`undefined`-vs-empty end signal callers had to guess at. Live probes against
the real tenant (2026-07-13) settled the design questions:

- **P1:** `POST /events/hr/v1/worker.read` accepts a `$filter` on
  `person/governmentIDs` (recorded working SSN lookup) but returns
  `400 "queryParameter is invalid"` for `person/legalName` paths → it is a
  **lookup-by-identifier** mechanism, not a general search backend.
- **P2a:** `GET /hr/v2/workers?$filter=workers/person/legalName/familyName1
  eq '…'` works (single predicate).
- **P2b:** the same filter with `and workers/person/legalName/givenName
  eq '…'` returns a **500** (`sp_filter` exception) → compound `and` on name
  fields is broken server-side (org-unit `and` combos are known to work;
  support is per-field-combo and unreliable).
- Duplicate `$filter=` query params do not combine (one is silently
  ignored) — recorded in CLAUDE.md.
- `eventMeta('worker.read')` returns exactly one rule: `queryParameter`
  marked `optional:false` + `readOnly:true` + `hidden:true` simultaneously —
  further evidence for the codeList-only blocking decision, and proof the
  event is usable through the existing pipeline.

## Surface

```typescript
// ── keyed lookup: one method, discriminated key ────────────────────────
type WorkerKey = string /* aoid shorthand */ | { aoid: string } | { ssn: string };
worker.get(key: WorkerKey): Promise<WorkerRecord | undefined>

// ── search: one query type, one lazy fluent handle ─────────────────────
interface WorkerQuery {
  givenName?: string;    // legalName/givenName
  familyName?: string;   // legalName/familyName1
  status?: string;       // workAssignments/assignmentStatus/statusCode/codeValue
  /** Raw OData $filter escape hatch — used verbatim as the server predicate. */
  filter?: string;
  pageSize?: number;     // default 100
}

worker.search(query?: WorkerQuery): WorkerSearch

class WorkerSearch {
  page(index: number): Promise<WorkerPage>;          // stateless random access
  pages(): AsyncGenerator<WorkerPage, void, void>;   // stream, lazy
  /** @deprecated Accumulates every page; prefer pages(). Removal candidate for 4.0. */
  all(): Promise<WorkerRecord[]>;
  /** @deprecated Sugar over pages() (see README recipe). Removal candidate for 4.0. */
  find(predicate: (w: WorkerRecord) => boolean): Promise<WorkerRecord | undefined>;
}

interface WorkerPage {
  workers: WorkerRecord[];
  index: number;
  done: boolean;         // THE end-of-records signal
  next: number | null;   // index + 1, or null when done
}
```

`search()` is **lazy** — it fetches nothing; it returns a cheap handle that
remembers the query. Each method determines how much is fetched: `page` one
request; `pages` one request per iteration; `all` every page; `find` pages
until the first predicate hit.

**Removed in 3.0.0:** top-level `one`, `page`, `pages`, `all`, `find`, and
the deprecated-since-2.1 `hireMeta`. Worker's read surface is `get` +
`search`; its event surface is unchanged.

## Backend rules

### `get`

- String or `{ aoid }` → `GET /hr/v2/workers/{aoid}` (percent-encoded),
  returns `workers[0]`, `undefined` on 204 — today's `one()` semantics.
- `{ ssn }` → `POST /events/hr/v1/worker.read` through the existing
  `postEvent` pipeline, with the recorded working envelope verbatim:

```typescript
{
  events: [{
    serviceCategoryCode: { codeValue: 'hr' },
    eventNameCode: { codeValue: 'worker.read' },
    data: { transform: {
      queryParameter:
        `$filter=person/governmentIDs[0]/idValue eq '${escaped(ssn)}' ` +
        `and person/governmentIDs[0]/nameCode eq 'SSN'`,
    } },
  }],
}
```

  Result extraction: `events[0].data.output.workers[0]`, `undefined` when
  the array is empty/absent. `'worker.read'` joins the `SupportedEvent`
  union. OData string escaping: single quotes in values are doubled
  (`O'Brien` → `O''Brien`) — applies to ALL filter values, `get` and
  `search` alike.

### `search` — single server predicate + client-side residual filtering

Because ADP's `$filter` `and`-support is per-field-combo and fails unsafely
(500), `search` sends **at most one server-side predicate** and applies the
remaining query fields **client-side inside `page()`**:

- Server-predicate precedence: `filter` (raw, caller-owned) >
  `familyName` > `givenName` > `status`. The first present field becomes the
  `$filter`; the rest become client-side tests on each fetched page.
- Client-side semantics: `givenName`/`familyName` compare against
  `person.legalName` exact-match; `status` matches if ANY
  `workAssignments[]` entry's `assignmentStatus.statusCode.codeValue`
  equals it.
- **Consequence (documented loudly):** a `WorkerPage` may contain an empty
  `workers` array while `done` is still `false` (the server page had rows;
  the residual filter removed them all). Loop on `done`, never on
  `workers.length` — the Windmill examples demonstrate this.
- `done` is true when the server returns 204 or an empty page; `next` is
  `index + 1` or `null` when done. Page indexes address SERVER pages, so
  they remain stable regardless of residual filtering.

## Errors

No new error types. `get({ ssn })` surfaces `worker.read` failures as the
pipeline already does (the 400 "queryParameter is invalid" case arrives as a
structured `BadRequestError`). Search GET failures surface via `raiseForAdp`
unchanged. The name-`and` 500 can no longer be triggered by this library —
it never emits compound name predicates.

## Testing

- Port existing read tests to `get`/`search` (URL assertions unchanged
  underneath).
- New: query→`$filter` serialization per field incl. precedence and OData
  quote-doubling; residual-filter behavior (page with server rows all
  filtered out → `workers: []`, `done: false`); `done`/`next` semantics at
  the 204 boundary; both-names hybrid (server familyName + client
  givenName); `get({ ssn })` envelope wire-format + extraction (hit, miss,
  and quote-escaping); deprecated `all`/`find` still functional.
- Live gate additions: `worker.read` meta fetch (its single overdeclared
  rule asserted); an env-gated `get({ ssn })` miss-probe (fake SSN — proves
  mechanics without PII); optional hit-probe gated on `ADP_TEST_SSN`.

## Docs & release

- README: usage section rewritten around `get`/`search` with the lazy-handle
  mental model stated explicitly ("search() fetches nothing until you call a
  method"); the early-exit scan recipe (`for await` + native `Array.find`)
  shown where `.find` deprecation points; the empty-page-while-not-done
  caveat in the Windmill loop example; coverage table updated (`Worker.get`,
  `Worker.search`, `worker.read` row added as ✅).
- Migration notes in the release description: `one(aoid)` → `get(aoid)`;
  `page(i, size)` → `search({ pageSize: size }).page(i)` (return shape now
  `WorkerPage`); `pages(size)` → `search({ pageSize: size }).pages()` (now
  yields `WorkerPage`, not arrays); `all()`/`find(p)` →
  `search().all()`/`search().find(p)` (deprecated); `hireMeta()` →
  `eventMeta('worker.hire')`.
- Ships as **3.0.0** via the tag-push provenance workflow.

## Out of scope

- Event-notification queue (`EventNotifications.next/delete`) — still the
  next milestone after this.
- Photos/binary transport.
- Additional `get` keys (`{ workerID }` etc.) — the discriminated-key shape
  exists so these can be added semver-minor later.
