import { describe, expect, it } from 'bun:test';
import {
  AdpError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  raiseForAdp,
} from '../src/errors.js';

import rehireAlreadyActive from './fixtures/worker.rehire/400.already-active.json';
import rehireInvalidAoid from './fixtures/worker.rehire/400.invalid-aoid.json';
import terminateAlreadyTerminated from './fixtures/worker.work-assignment.terminate/400.already-terminated.json';
import terminateInvalidAoid from './fixtures/worker.work-assignment.terminate/400.invalid-aoid.json';
import workerForbidden from './fixtures/workers/aoid/403.json';

function capture(fn: () => never): AdpError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdpError) return error;
    throw error;
  }
  throw new Error('unreachable');
}

describe('raiseForAdp', () => {
  it('maps 400 confirmMessage shape (already active)', () => {
    const e = capture(() => raiseForAdp(400, rehireAlreadyActive, 'POST /events/hr/v1/worker.rehire'));
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.statusCode).toBe(400);
    expect(e.adpMessage).toBe(
      'The employee cannot be rehired because he or she has an Active or On Leave position.',
    );
    expect(e.adpCode).toBe('API_REHIRE_EE_ALREADY_ACTIVE');
    expect(e.endpoint).toBe('POST /events/hr/v1/worker.rehire');
    expect(e.raw).toBe(rehireAlreadyActive);
  });

  it('maps 400 confirmMessage shape (invalid aoid)', () => {
    const e = capture(() => raiseForAdp(400, rehireInvalidAoid, 'POST /events/hr/v1/worker.rehire'));
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toBe('associateOID is invalid.');
    expect(e.adpCode).toBe('errors.invalid');
  });

  it('maps 400 exceptionMessages shape (already terminated)', () => {
    const e = capture(() =>
      raiseForAdp(400, terminateAlreadyTerminated, 'POST /events/hr/v1/worker.work-assignment.terminate'),
    );
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toContain('is already terminated');
    expect(e.adpCode).toBeUndefined();
  });

  it('maps 400 exceptionMessages shape (invalid item id)', () => {
    const e = capture(() =>
      raiseForAdp(400, terminateInvalidAoid, 'POST /events/hr/v1/worker.work-assignment.terminate'),
    );
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toBe('Item ID is invalid');
  });

  it('maps 403 confirmMessage variant without processMessageID', () => {
    const e = capture(() => raiseForAdp(403, workerForbidden, 'GET /hr/v2/workers/XXX'));
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(e.adpMessage).toBe('Forbidden');
    expect(e.adpCode).toBeUndefined();
  });

  it('maps the newer applicationCode shape', () => {
    const json = { response: { applicationCode: { message: 'Invalid request', code: 'ERR_01' } } };
    const e = capture(() => raiseForAdp(400, json, 'POST /x'));
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.adpMessage).toBe('Invalid request');
    expect(e.adpCode).toBe('ERR_01');
  });

  it('maps OAuth token-endpoint errors', () => {
    const json = { error: 'invalid_client', error_description: 'The given client credentials were not valid' };
    const e = capture(() => raiseForAdp(401, json, 'POST /auth/oauth/v2/token'));
    expect(e).toBeInstanceOf(UnauthorizedError);
    expect(e.adpMessage).toBe('The given client credentials were not valid');
    expect(e.adpCode).toBe('invalid_client');
  });

  it('maps 404 to NotFoundError', () => {
    const e = capture(() => raiseForAdp(404, undefined, 'GET /x'));
    expect(e).toBeInstanceOf(NotFoundError);
  });

  it('throws base AdpError for unmapped statuses (429)', () => {
    const e = capture(() => raiseForAdp(429, {}, 'GET /x'));
    expect(e).toBeInstanceOf(AdpError);
    expect(e).not.toBeInstanceOf(BadRequestError);
    expect(e.statusCode).toBe(429);
  });

  it('never produces a bare Error and message names the endpoint', () => {
    const e = capture(() => raiseForAdp(500, 'Internal Server Error', 'GET /hr/v2/workers'));
    expect(e).toBeInstanceOf(AdpError);
    expect(e.message).toContain('GET /hr/v2/workers');
    expect(e.name).toBe('AdpError');
  });

  it('subclass errors carry the subclass name', () => {
    const e = capture(() => raiseForAdp(400, undefined, 'POST /x'));
    expect(e.name).toBe('BadRequestError');
  });
});
