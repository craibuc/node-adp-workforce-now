// List the client-side validation rule paths for an ADP worker.* event (or
// applicant.onboard), pulled from GET /events/hr/v1/{event}/meta (tenant
// metas are cached — default 12 h). Useful for discovering which fields
// carry required/readOnly/hidden/codeList/pattern/length constraints, and
// the tenant's allowed reason/type codes, before wiring up a new event.

import { Client } from '@craibuc/adp-workforce-now';
import type { SupportedEvent } from '@craibuc/adp-workforce-now';

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: AdpCredentials,
  // A supported event name — "worker.hire", "worker.rehire",
  // "worker.work-assignment.terminate",
  // "worker.work-assignment.base-remuneration.change",
  // "worker.legal-name.change", "worker.person.custom-field.string.change",
  // "worker.leave.absence.request", "worker.read", "worker.photo.upload", or
  // "applicant.onboard". Any other event string is also accepted (same
  // escape hatch postEvent() uses).
  event: SupportedEvent | (string & {}) = 'worker.rehire',
  // Bypass the cache and force a fresh fetch from ADP.
  forceRefresh = false,
) {
  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    // A shared token cache is recommended in production — see the README's
    // "Token stores" section (WindmillTokenStore).
  });

  const meta = await client.worker.eventMeta(event, { forceRefresh });

  // Maps don't survive JSON serialization across the flow-step boundary —
  // flatten to an array of { path, ...rule }.
  const rules = [...meta.rules.entries()].map(([path, rule]) => ({ path, ...rule }));

  return {
    event: meta.event,
    fetchedAt: meta.fetchedAt,
    ruleCount: rules.length,
    rules,
  };
}
