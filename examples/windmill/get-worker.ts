// Read one worker via Worker.get() — either by associate OID (aoid string
// shorthand, or { aoid }) or by SSN ({ ssn }, powered by the worker.read
// event's government-ID filter). Pass associateOID OR ssn, not both; if
// both are present the library prefers ssn, but this script only sends one.
// Run as a preview in the Windmill script editor.
//
// This is the one example that wires up a shared WindmillTokenStore — see
// the README's "Token stores" section for why a shared cache matters when
// multiple flow steps (or another language's client) hit the same tenant.
// The other example scripts skip it to stay ~3 lines and just point back
// here.

import { Client } from '@craibuc/adp-workforce-now';
import { WindmillTokenStore } from '@craibuc/adp-workforce-now/windmill';

type CAdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded (auto-detected)
  private_key_file: string; // PEM, raw or base64-encoded (auto-detected)
};

export async function main(
  adp: CAdpCredentials,
  // Windmill variable path for the shared token cache, e.g. "u/you/adp_token_cache".
  tokenCachePath: string,
  // Associate OID, e.g. "G0FAKEFAKEFAKE1A". Leave blank to look up by ssn instead.
  associateOID?: string,
  // SSN lookup (used only when associateOID is blank), e.g. "000-00-0000".
  ssn?: string,
) {
  if (!associateOID && !ssn) {
    throw new Error('Provide either associateOID or ssn');
  }

  const client = new Client(adp.certificate_file, adp.private_key_file, {
    credentials: { client_id: adp.client_id, client_secret: adp.client_secret },
    tokenStore: new WindmillTokenStore(tokenCachePath),
  });

  const worker = associateOID ? await client.worker.get(associateOID) : await client.worker.get({ ssn: ssn! });

  return {
    found: worker !== undefined,
    worker: worker ?? null,
  };
}
