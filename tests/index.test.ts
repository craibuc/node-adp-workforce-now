import { describe, expect, it } from 'bun:test';
import * as api from '../src/index.js';

describe('public export surface', () => {
  it('exports the documented API', () => {
    expect(api.Client).toBeFunction();
    expect(api.Worker).toBeFunction();
    expect(api.normalizePem).toBeFunction();
    expect(api.AdpError).toBeFunction();
    expect(api.BadRequestError).toBeFunction();
    expect(api.UnauthorizedError).toBeFunction();
    expect(api.ForbiddenError).toBeFunction();
    expect(api.NotFoundError).toBeFunction();
    expect(api.raiseForAdp).toBeFunction();
    expect(api.MemoryTokenStore).toBeFunction();
    expect(api.createBunTransport).toBeFunction();
    expect(api.createNodeTransport).toBeFunction();
  });

  it('does NOT export WindmillTokenStore from the main entry', () => {
    expect('WindmillTokenStore' in api).toBe(false);
  });
});
