// Stage A smoke test: verify the Windmill worker's Bun can complete ADP's
// mutual-TLS handshake and reach the token endpoint.
//
// Paste into the Windmill script editor (Bun runtime) and run as a PREVIEW —
// it deploys nothing and makes exactly one live token request. No library
// import needed, so it works before the package is published.
//
// The `adp` parameter renders as a resource picker in the Windmill UI;
// select your ADP credentials resource there.

type AdpCredentials = {
  client_id: string;
  client_secret: string;
  certificate_file: string; // PEM, raw or base64-encoded
  private_key_file: string; // PEM, raw or base64-encoded
};

function pem(input: string): string {
  return input.includes('-----BEGIN')
    ? input
    : Buffer.from(input, 'base64').toString('utf8');
}

export async function main(adp: AdpCredentials) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: adp.client_id,
    client_secret: adp.client_secret,
  }).toString();

  const response = await fetch('https://accounts.adp.com/auth/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    // Bun-specific fetch extension: client certificate for mTLS.
    tls: {
      cert: pem(adp.certificate_file),
      key: pem(adp.private_key_file),
    },
  } as RequestInit);

  const json = (await response.json()) as Record<string, unknown>;

  // Never return or log the token itself.
  return {
    bunVersion: Bun.version,
    status: response.status,
    ok: response.ok,
    tokenReceived: typeof json.access_token === 'string',
    expiresIn: json.expires_in ?? null,
    error: response.ok ? null : json,
  };
}
