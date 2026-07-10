export interface CachedToken {
  access_token: string;
  /**
   * Expiry as epoch seconds UTC — a number, never an ISO string.
   * This JSON shape is a cross-language cache interop contract; other
   * clients may read/write the same cache. Do not change it.
   */
  expires_at: number;
}

export interface TokenStore {
  get(): Promise<CachedToken | undefined>;
  set(token: CachedToken): Promise<void>;
}
