import { describe, expect, it } from 'bun:test';
import { MemoryTokenStore } from '../src/token-store/memory.js';

describe('MemoryTokenStore', () => {
  it('returns undefined before any set', async () => {
    expect(await new MemoryTokenStore().get()).toBeUndefined();
  });

  it('returns the last token set', async () => {
    const store = new MemoryTokenStore();
    await store.set({ access_token: 'a', expires_at: 100 });
    await store.set({ access_token: 'b', expires_at: 200 });
    expect(await store.get()).toEqual({ access_token: 'b', expires_at: 200 });
  });
});
