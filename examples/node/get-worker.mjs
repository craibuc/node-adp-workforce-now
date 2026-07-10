// Minimal Node example: import the library, authenticate, fetch one worker.
//
// From this repo (before the package is on npm), build first, then run:
//
//   npm run build
//   node --env-file=.env examples/node/get-worker.mjs
//
// As a consumer of the published package, change the import to
// '@craibuc/adp-workforce-now' and run the same way.
//
// Reads from the environment (see .env.sample): ADP_CLIENT_ID,
// ADP_CLIENT_SECRET, ADP_CERTIFICATE, ADP_PRIVATE_KEY (PEMs raw or
// base64-encoded — auto-detected), and optionally ADP_ASSOCIATE_OID.

import { Client } from '../../dist/index.js';

const {
  ADP_CLIENT_ID,
  ADP_CLIENT_SECRET,
  ADP_CERTIFICATE,
  ADP_PRIVATE_KEY,
  ADP_ASSOCIATE_OID,
} = process.env;

for (const [name, value] of Object.entries({
  ADP_CLIENT_ID,
  ADP_CLIENT_SECRET,
  ADP_CERTIFICATE,
  ADP_PRIVATE_KEY,
})) {
  if (!value) {
    console.error(`Missing ${name} — copy .env.sample to .env and fill it in.`);
    process.exit(1);
  }
}

const client = new Client(ADP_CERTIFICATE, ADP_PRIVATE_KEY, {
  credentials: { client_id: ADP_CLIENT_ID, client_secret: ADP_CLIENT_SECRET },
});

// authenticate() is optional — any request triggers lazy auth — but calling it
// explicitly makes a smoke run's failure point obvious. Never log the token.
const token = await client.authenticate();
console.log('authenticated — token expires', new Date(token.expires_at * 1000).toISOString());

if (ADP_ASSOCIATE_OID) {
  const worker = await client.worker.one(ADP_ASSOCIATE_OID);
  console.log(worker ? JSON.stringify(worker, null, 2) : `no worker found for ${ADP_ASSOCIATE_OID}`);
} else {
  // No AOID provided: fetch the first page and show what's there.
  const { value: page } = await client.worker.pages(10).next();
  console.log(`first page: ${page?.length ?? 0} workers`);
  for (const worker of page ?? []) {
    console.log(`- ${worker.associateOID}`);
  }
}
