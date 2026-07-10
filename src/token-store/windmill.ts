import type { CachedToken, TokenStore } from './types.js';

/**
 * Persists the token in a Windmill variable so multiple scripts (and other
 * language clients) share one cache. `windmill-client` is provided by the
 * Windmill runtime — it is intentionally not a dependency of this package,
 * hence the dynamic import.
 */
export class WindmillTokenStore implements TokenStore {
  constructor(private readonly variablePath: string) {}

  async get(): Promise<CachedToken | undefined> {
    const wmill = await import('windmill-client');
    let raw: string;
    try {
      // Real windmill-client throws when the variable doesn't exist yet
      // (first-ever use) — treat that the same as an empty cache.
      raw = await wmill.getVariable(this.variablePath);
    } catch {
      return undefined;
    }
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as CachedToken).access_token === 'string' &&
        typeof (parsed as CachedToken).expires_at === 'number'
      ) {
        return parsed as CachedToken;
      }
    } catch {
      // fall through — treat unreadable cache as empty
    }
    return undefined;
  }

  async set(token: CachedToken): Promise<void> {
    const wmill = await import('windmill-client');
    await wmill.setVariable(
      this.variablePath,
      JSON.stringify({ access_token: token.access_token, expires_at: token.expires_at }),
      // isSecretIfNotExist: without this, a first-ever write creates the
      // variable as non-secret, exposing bearer tokens in the Windmill UI.
      true,
    );
  }
}
