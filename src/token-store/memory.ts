import type { CachedToken, TokenStore } from './types.js';

export class MemoryTokenStore implements TokenStore {
  private token: CachedToken | undefined;

  async get(): Promise<CachedToken | undefined> {
    return this.token;
  }

  async set(token: CachedToken): Promise<void> {
    this.token = token;
  }
}
