// Search workers with Worker.search(query) — lazy: nothing is fetched until
// page()/pages() is called. Shows both usages:
//  1. a single filtered page (allPages = false, the default);
//  2. a full scan across every page using the WorkerPage
//     { workers, index, done, next } protocol (allPages = true).
//
// Windmill flow-loop note: in a real for-loop flow step, each iteration
// calls search(query).page(index) exactly once, with `index` carried in
// flow state, and loops on `done` — NEVER on `workers.length`, which can be
// 0 mid-stream when a client-side residual filter (e.g. a second name field
// on top of the one server-side predicate) empties a page while more pages
// remain. This script's while loop below shows that same page(index) call,
// just driven from inside one step instead of across flow iterations.

import { Client } from '@craibuc/adp-workforce-now';

type CAdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: CAdpCredentials,
  // Filter by legal family name, e.g. "Duck".
  familyName?: string,
  // Filter by legal given name, e.g. "Donald".
  givenName?: string,
  // ADP assignment-status code, e.g. "A" (active) or "T" (terminated).
  status?: string,
  // Raw OData $filter escape hatch — used verbatim as the server predicate
  // if provided (takes precedence over familyName/givenName/status).
  filter?: string,
  // Server page size ($top). Default 100.
  pageSize?: number,
  // false (default): return only the first page. true: walk every page
  // (bounded by maxPages below) and return the combined results.
  allPages = false,
  // Safety cap on total pages fetched when allPages is true.
  maxPages = 20,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const search = client.worker.search({ familyName, givenName, status, filter, pageSize });

  if (!allPages) {
    const page = await search.page(0);
    return {
      index: page.index,
      done: page.done,
      next: page.next,
      count: page.workers.length,
      workers: page.workers,
    };
  }

  const workers = [];
  let index = 0;
  let done = false;
  while (!done && index < maxPages) {
    const page = await search.page(index);
    workers.push(...page.workers);
    done = page.done;
    index = page.next ?? index + 1;
  }

  return { pagesFetched: index, count: workers.length, workers };
}
