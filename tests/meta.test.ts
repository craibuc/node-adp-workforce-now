import { describe, expect, it } from 'bun:test';
import {
  EventValidationError,
  parseEventMeta,
  validateEnvelope,
} from '../src/meta.js';
import type { EventMeta } from '../src/meta.js';
import syntheticRehireMeta from './fixtures/meta/synthetic.worker.rehire.json';

function rehireEnvelope(overrides: { reasonCode?: string; rehireDate?: string; omitEffective?: boolean } = {}) {
  const transform: Record<string, unknown> = {
    effectiveDateTime: '2026-08-01',
    worker: {
      associateOID: 'G0FAKEFAKEFAKE2B',
      workerDates: { rehireDate: overrides.rehireDate ?? '2026-08-01' },
      workerStatus: { reasonCode: { codeValue: overrides.reasonCode ?? 'IMPORT' } },
    },
  };
  if (overrides.omitEffective) delete transform.effectiveDateTime;
  return { events: [{ data: { transform } }] };
}

const meta = parseEventMeta('worker.rehire', syntheticRehireMeta, 0);

describe('parseEventMeta', () => {
  it('extracts scoped rules with pointer-string keys split into segments', () => {
    expect(meta.rules.get('transform:/effectiveDateTime')).toEqual({ optional: false });
    expect(meta.rules.get('transform:/worker/workerStatus/reasonCode/codeValue')?.codeValues).toEqual([
      'IMPORT',
      'REHIRE',
    ]);
    expect(meta.rules.get('transform:/worker/workerID/idValue')?.readOnly).toBe(true);
  });

  it('is fail-open on unparseable meta', () => {
    const empty = parseEventMeta('worker.rehire', 'not an object', 0);
    expect(empty.rules.size).toBe(0);
    expect(validateEnvelope(rehireEnvelope(), empty)).toEqual([]);
  });

  it('keeps the raw body and event name', () => {
    expect(meta.raw).toBe(syntheticRehireMeta);
    expect(meta.event).toBe('worker.rehire');
  });
});

describe('validateEnvelope', () => {
  it('passes a valid envelope', () => {
    expect(validateEnvelope(rehireEnvelope(), meta)).toEqual([]);
  });

  it('flags a code outside the codeList, naming allowed values', () => {
    const issues = validateEnvelope(rehireEnvelope({ reasonCode: 'BOGUS' }), meta);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('codeList');
    expect(issues[0].path).toBe('transform:/worker/workerStatus/reasonCode/codeValue');
    expect(issues[0].message).toContain('IMPORT');
  });

  it('flags a missing required field', () => {
    const issues = validateEnvelope(rehireEnvelope({ omitEffective: true }), meta);
    expect(issues.some((i) => i.code === 'required' && i.path === 'transform:/effectiveDateTime')).toBe(true);
  });

  it('flags a pattern violation', () => {
    const issues = validateEnvelope(rehireEnvelope({ rehireDate: 'August 1st' }), meta);
    expect(issues.some((i) => i.code === 'pattern')).toBe(true);
  });

  it('flags readOnly and hidden fields when present in the envelope', () => {
    const envelope = rehireEnvelope() as { events: [{ data: { transform: Record<string, unknown> } }] };
    const worker = envelope.events[0].data.transform.worker as Record<string, unknown>;
    worker.workerID = { idValue: 'X1' };
    worker.customArea = { internalFlag: true };
    const issues = validateEnvelope(envelope, meta);
    expect(issues.some((i) => i.code === 'readOnly')).toBe(true);
    expect(issues.some((i) => i.code === 'hidden')).toBe(true);
  });

  it('ignores envelope fields the meta does not mention', () => {
    const envelope = rehireEnvelope() as { events: [{ data: { transform: Record<string, unknown> } }] };
    envelope.events[0].data.transform.somethingAdpNeverMentioned = 'ok';
    expect(validateEnvelope(envelope, meta)).toEqual([]);
  });

  it('flags a length violation when associateOID exceeds maxLength', () => {
    const envelope = rehireEnvelope() as { events: [{ data: { transform: Record<string, unknown> } }] };
    const worker = envelope.events[0].data.transform.worker as Record<string, unknown>;
    worker.associateOID = 'X'.repeat(65); // exceeds maxLength of 64
    const issues = validateEnvelope(envelope, meta);
    const lengthIssue = issues.find((i) => i.code === 'length' && i.path === 'transform:/worker/associateOID');
    expect(lengthIssue).toBeDefined();
    expect(lengthIssue?.message).toContain('maxLength');
  });
});

describe('EventValidationError', () => {
  it('carries event and issues, message names the first issue', () => {
    const issues = validateEnvelope(rehireEnvelope({ reasonCode: 'BOGUS' }), meta);
    const error = new EventValidationError('worker.rehire', issues);
    expect(error.event).toBe('worker.rehire');
    expect(error.issues).toBe(issues);
    expect(error.message).toContain('worker.rehire');
    expect(error.message).toContain('1 issue');
    expect(error.message).toContain('codeList');
  });
});

describe('eventContext scope', () => {
  const contextMeta = parseEventMeta(
    'worker.work-assignment.terminate',
    { meta: { '/data/eventContext': [{ '/worker/workAssignment/itemID': { optional: false, minLength: 1 } }] } },
    0,
  );

  it('parses rules scoped under eventContext', () => {
    const rule = contextMeta.rules.get('eventContext:/worker/workAssignment/itemID');
    expect(rule).toEqual({ optional: false, minLength: 1 });
  });

  it('validates an envelope with eventContext fields present', () => {
    const envelope = {
      events: [
        {
          data: {
            eventContext: { worker: { workAssignment: { itemID: 'WA1' } } },
            transform: {},
          },
        },
      ],
    };
    const issues = validateEnvelope(envelope, contextMeta);
    expect(issues).toEqual([]);
  });

  it('flags a missing required eventContext field when the scope is present but the field is absent', () => {
    const envelope = {
      events: [
        {
          data: {
            // eventContext scope IS in use (associateOID present) — itemID is
            // still structurally absent, so the required rule must fire.
            eventContext: { worker: { associateOID: 'G0FAKEFAKEFAKE2B' } },
            transform: {},
          },
        },
      ],
    };
    const issues = validateEnvelope(envelope, contextMeta);
    const requiredIssue = issues.find(
      (i) => i.code === 'required' && i.path === 'eventContext:/worker/workAssignment/itemID',
    );
    expect(requiredIssue).toBeDefined();
  });

  it('skips a required eventContext rule when the envelope has no eventContext values at all', () => {
    const envelope = {
      events: [{ data: { transform: { note: 'x' } } }], // no eventContext key anywhere
    };
    const issues = validateEnvelope(envelope, contextMeta);
    expect(issues).toEqual([]);
  });
});

describe('required-rule semantics (Fix 1)', () => {
  it('a container-level required rule is satisfied by a leaf value beneath it', () => {
    const containerMeta: EventMeta = {
      event: 'test.container',
      rules: new Map([['eventContext:/worker/workAssignment', { optional: false }]]),
      raw: {},
      fetchedAt: 0,
    };
    const envelope = {
      events: [
        {
          data: {
            eventContext: { worker: { workAssignment: { itemID: 'WA1' } } },
            transform: {},
          },
        },
      ],
    };
    expect(validateEnvelope(envelope, containerMeta)).toEqual([]);
  });

  it('an empty-string value satisfies a required rule', () => {
    const requiredOnlyMeta: EventMeta = {
      event: 'test.required',
      rules: new Map([['transform:/note', { optional: false }]]),
      raw: {},
      fetchedAt: 0,
    };
    const envelope = { events: [{ data: { transform: { note: '' } } }] };
    expect(validateEnvelope(envelope, requiredOnlyMeta)).toEqual([]);
  });
});
