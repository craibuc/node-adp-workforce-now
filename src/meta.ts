/** Events this library wraps; postEvent also accepts any other event string. */
export type SupportedEvent =
  | 'worker.hire'
  | 'worker.rehire'
  | 'worker.work-assignment.terminate'
  | 'worker.work-assignment.base-remuneration.change'
  | 'worker.legal-name.change'
  | 'worker.person.custom-field.string.change'
  | 'worker.leave.absence.request'
  | 'worker.read';

export interface FieldRule {
  optional?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  codeValues?: string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface EventMeta {
  event: string;
  /** Scoped path ("transform:/a/b" | "eventContext:/a/b") -> constraints. */
  rules: Map<string, FieldRule>;
  raw: unknown;
  fetchedAt: number; // epoch ms
}

export interface ValidationIssue {
  path: string;
  code: 'required' | 'readOnly' | 'hidden' | 'codeList' | 'pattern' | 'length';
  message: string;
}

export class EventValidationError extends Error {
  readonly event: string;
  readonly issues: ValidationIssue[];

  constructor(event: string, issues: ValidationIssue[], options?: { cause?: unknown }) {
    const first = issues[0];
    super(
      `${event} failed client-side validation (${issues.length} issue${issues.length === 1 ? '' : 's'}): ` +
        (first ? `[${first.code}] ${first.path}: ${first.message}` : ''),
      options,
    );
    this.name = 'EventValidationError';
    this.event = event;
    this.issues = issues;
  }
}

const CONSTRAINT_KEYS = ['optional', 'readOnly', 'hidden', 'codeList', 'pattern', 'minLength', 'maxLength'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Split a key that may itself be a JSON-pointer-ish path; drop array indices. */
function segmentsOf(key: string): string[] {
  return key.split('/').filter((s) => s !== '' && !/^\d+$/.test(s));
}

function scopeOf(segments: string[]): { scope: 'transform' | 'eventContext'; rel: string[] } {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] === 'transform' || segments[i] === 'transforms') {
      return { scope: 'transform', rel: segments.slice(i + 1) };
    }
    if (segments[i] === 'eventContext') {
      return { scope: 'eventContext', rel: segments.slice(i + 1) };
    }
  }
  return { scope: 'transform', rel: segments };
}

function ruleFrom(node: Record<string, unknown>): FieldRule | undefined {
  if (!CONSTRAINT_KEYS.some((k) => k in node)) return undefined;
  const rule: FieldRule = {};
  if (typeof node.optional === 'boolean') rule.optional = node.optional;
  if (typeof node.readOnly === 'boolean') rule.readOnly = node.readOnly;
  if (typeof node.hidden === 'boolean') rule.hidden = node.hidden;
  if (typeof node.pattern === 'string') rule.pattern = node.pattern;
  if (typeof node.minLength === 'number') rule.minLength = node.minLength;
  if (typeof node.maxLength === 'number') rule.maxLength = node.maxLength;
  const listItems = (node.codeList as Record<string, unknown> | undefined)?.listItems;
  if (Array.isArray(listItems)) {
    const codes = listItems
      .map((item) => (isRecord(item) ? item.codeValue : undefined))
      .filter((v): v is string => typeof v === 'string');
    if (codes.length > 0) rule.codeValues = codes;
  }
  return rule;
}

export function parseEventMeta(event: string, raw: unknown, fetchedAt: number): EventMeta {
  const rules = new Map<string, FieldRule>();

  function walk(node: unknown, segments: string[]): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, segments);
      return;
    }
    if (!isRecord(node)) return;
    const rule = ruleFrom(node);
    if (rule && segments.length > 0) {
      const { scope, rel } = scopeOf(segments);
      if (rel.length > 0) rules.set(`${scope}:/${rel.join('/')}`, rule);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'codeList') continue; // listItems are values, not field paths
      walk(value, [...segments, ...segmentsOf(key)]);
    }
  }

  try {
    walk(raw, []);
  } catch {
    rules.clear(); // fail-open: unparseable meta validates nothing
  }
  return { event, rules, raw, fetchedAt };
}

/**
 * Leaf values of the envelope, keyed by the same scoped-path model.
 * @internal — used by the live meta gate.
 */
export function flattenEnvelope(envelope: unknown): Map<string, unknown[]> {
  const values = new Map<string, unknown[]>();

  function record(path: string, value: unknown): void {
    const existing = values.get(path);
    if (existing) existing.push(value);
    else values.set(path, [value]);
  }

  function walk(node: unknown, scope: string, segments: string[]): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, scope, segments);
      return;
    }
    if (isRecord(node)) {
      for (const [key, value] of Object.entries(node)) walk(value, scope, [...segments, key]);
      return;
    }
    if (node !== undefined && segments.length > 0) record(`${scope}:/${segments.join('/')}`, node);
  }

  if (isRecord(envelope) && Array.isArray(envelope.events)) {
    for (const event of envelope.events) {
      const data = isRecord(event) ? event.data : undefined;
      if (!isRecord(data)) continue;
      walk(data.transform, 'transform', []);
      walk(data.eventContext, 'eventContext', []);
    }
  }
  return values;
}

/** Scope prefix ("transform:" | "eventContext:") that a scoped path belongs to. */
function scopePrefixOf(path: string): string {
  const idx = path.indexOf(':');
  return idx === -1 ? path : path.slice(0, idx + 1);
}

export function validateEnvelope(envelope: unknown, meta: EventMeta): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const values = flattenEnvelope(envelope);
  const keys = [...values.keys()];

  for (const [path, rule] of meta.rules) {
    const present = values.get(path);

    if (rule.optional === false) {
      // Scope-absence skip: an envelope that doesn't use this rule's scope at
      // all (e.g. no eventContext values anywhere) shouldn't fail a rule
      // scoped to that context — this event family just isn't using it here.
      const scopeInUse = keys.some((k) => k.startsWith(scopePrefixOf(path)));
      // Container-level required rules are satisfied by any leaf beneath them
      // (scoped-key prefix test), not just an exact-path match. An empty
      // string or null value still counts as present — "required but empty"
      // is the server's call; we only flag structural absence.
      const satisfied = keys.some((k) => k === path || k.startsWith(`${path}/`));
      if (scopeInUse && !satisfied) {
        issues.push({ path, code: 'required', message: 'required field is missing' });
        continue;
      }
    }
    if (!present) continue;

    if (rule.readOnly) {
      issues.push({ path, code: 'readOnly', message: 'field is read-only and must not be sent' });
    }
    if (rule.hidden) {
      issues.push({ path, code: 'hidden', message: 'field is hidden and must not be sent' });
    }
    if (rule.codeValues) {
      for (const value of present) {
        if (typeof value === 'string' && !rule.codeValues.includes(value)) {
          issues.push({
            path,
            code: 'codeList',
            message: `"${value}" is not an allowed code (allowed: ${rule.codeValues.join(', ')})`,
          });
        }
      }
    }
    if (rule.pattern) {
      let regex: RegExp | undefined;
      try {
        regex = new RegExp(rule.pattern);
      } catch {
        regex = undefined; // fail-open on invalid server-provided pattern
      }
      if (regex) {
        for (const value of present) {
          if (typeof value === 'string' && !regex.test(value)) {
            issues.push({ path, code: 'pattern', message: `"${value}" does not match ${rule.pattern}` });
          }
        }
      }
    }
    for (const value of present) {
      if (typeof value !== 'string') continue;
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        issues.push({ path, code: 'length', message: `shorter than minLength ${rule.minLength}` });
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        issues.push({ path, code: 'length', message: `longer than maxLength ${rule.maxLength}` });
      }
    }
  }
  return issues;
}
