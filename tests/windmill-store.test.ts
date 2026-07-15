import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getVariable = mock(async (_path: string): Promise<string> => '');
const setVariable = mock(
  async (_path: string, _value: string, _isSecretIfNotExist?: boolean, _descriptionIfNotExist?: string): Promise<void> => {},
);

mock.module('windmill-client', () => ({ getVariable, setVariable }));

import { WindmillTokenStore } from '../src/token-store/windmill.js';

describe('WindmillTokenStore', () => {
  beforeEach(() => {
    getVariable.mockClear();
    setVariable.mockClear();
    getVariable.mockResolvedValue('');
  });

  it('reads and parses the interop JSON shape from the variable path', async () => {
    getVariable.mockResolvedValue('{"access_token":"tok","expires_at":1750000000}');
    const store = new WindmillTokenStore('u/some/path');

    expect(await store.get()).toEqual({ access_token: 'tok', expires_at: 1750000000 });
    expect(getVariable).toHaveBeenCalledWith('u/some/path');
  });

  it('returns undefined for empty or malformed variables', async () => {
    const store = new WindmillTokenStore('u/some/path');
    expect(await store.get()).toBeUndefined(); // empty string ('' — the not-yet-written analogue)

    getVariable.mockResolvedValue('not json');
    expect(await store.get()).toBeUndefined();

    getVariable.mockResolvedValue('{"access_token":"tok","expires_at":"2026-01-01T00:00:00Z"}');
    expect(await store.get()).toBeUndefined(); // ISO string violates the contract
  });

  it('returns undefined when the variable does not exist yet (real windmill-client throws)', async () => {
    const store = new WindmillTokenStore('u/some/path');
    getVariable.mockRejectedValue(new Error('Variable not found at u/some/path or not visible to you'));

    expect(await store.get()).toBeUndefined();
  });

  it('rejects a missing, empty, or non-string variable path at construction', () => {
    // A resource missing its token_cache_path field arrives as undefined and
    // previously crashed layers down in windmill-client ("undefined is not an
    // object (evaluating 's.startsWith')") — fail fast with a readable error.
    expect(() => new WindmillTokenStore(undefined as unknown as string)).toThrow(/variable path/i);
    expect(() => new WindmillTokenStore('')).toThrow(/variable path/i);
    expect(() => new WindmillTokenStore('   ')).toThrow(/variable path/i);
    expect(() => new WindmillTokenStore(null as unknown as string)).toThrow(/variable path/i);
  });

  it('writes the exact interop JSON shape, creating the variable as secret', async () => {
    const store = new WindmillTokenStore('u/some/path');
    await store.set({ access_token: 'tok', expires_at: 1750000000 });

    expect(setVariable).toHaveBeenCalledWith(
      'u/some/path',
      '{"access_token":"tok","expires_at":1750000000}',
      true,
    );
  });
});
