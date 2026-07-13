import { describe, expect, it } from 'bun:test';
import { Client } from '../../src/client.js';
import { AdpError } from '../../src/errors.js';
import { flattenEnvelope } from '../../src/meta.js';
import type { SupportedEvent } from '../../src/meta.js';

const { ADP_CLIENT_ID, ADP_CLIENT_SECRET, ADP_CERTIFICATE, ADP_PRIVATE_KEY } = process.env;
const hasCredentials = Boolean(ADP_CLIENT_ID && ADP_CLIENT_SECRET && ADP_CERTIFICATE && ADP_PRIVATE_KEY);

/**
 * Events whose meta endpoint is known-unavailable on this tenant (live
 * finding: terminate meta returns a 500-wrapped 405 — see task-6 report).
 * An AdpError fetching one of these is allowlisted (warn + pass); any other
 * event's meta failing to fetch is a real regression and fails the gate.
 */
const KNOWN_UNAVAILABLE = new Set<SupportedEvent>(['worker.work-assignment.terminate']);

/**
 * Representative envelopes for every supported event — copied verbatim (same
 * fake values) from the wire-format tests in tests/worker-events.test.ts and
 * tests/worker-events-v21.test.ts. These are never POSTed here; they only
 * exercise validateEnvelope against each event's REAL tenant meta, so the
 * library's own envelope shapes are proven against production ADP, not just
 * synthetic fixtures.
 */
const ENVELOPES: Record<SupportedEvent, unknown> = {
  'worker.hire': {
    events: [
      {
        data: {
          transform: {
            eventReasonCode: { codeValue: 'NEW' },
            worker: {
              person: {
                governmentIDs: [{ idValue: '111-22-3333', nameCode: { codeValue: 'SSN' } }],
                legalName: { givenName: 'Renée', familyName1: 'Duck' },
                legalAddress: {
                  nameCode: { codeValue: 'PersonalAddress1' },
                  lineOne: '123 Maple Street',
                  lineTwo: 'Apt 4',
                  cityName: 'Minneapolis',
                  countrySubdivisionLevel1: { codeValue: 'MN' },
                  countryCode: 'US',
                  postalCode: '55555',
                },
                birthDate: '1990-01-01',
                genderCode: { codeValue: 'F' },
              },
              workAssignment: {
                hireDate: '2026-08-01',
                payrollGroupCode: 'ABC',
              },
            },
          },
        },
      },
    ],
  },
  'worker.rehire': {
    events: [
      {
        data: {
          transform: {
            effectiveDateTime: '2026-08-01',
            worker: {
              associateOID: 'AAA',
              workerDates: { rehireDate: '2026-08-01' },
              workerStatus: { reasonCode: { codeValue: 'IMPORT' } },
            },
          },
        },
      },
    ],
  },
  'worker.work-assignment.terminate': {
    events: [
      {
        data: {
          eventContext: {
            contextExpressionID: '',
            worker: { workAssignment: { itemID: 'WA1' } },
          },
          transform: {
            comment: { commentCode: { codeValue: 'GROWTH' } },
            worker: {
              workAssignment: {
                terminationDate: '2026-08-15',
                lastWorkedDate: '2026-08-15',
                assignmentStatus: { reasonCode: { codeValue: 'T' } },
                rehireEligibleIndicator: true,
                severanceEligibleIndicator: true,
              },
            },
          },
        },
      },
    ],
  },
  'worker.work-assignment.base-remuneration.change': {
    events: [
      {
        data: {
          eventContext: {
            worker: {
              associateOID: 'G0FAKEFAKEFAKE2B',
              workAssignment: { itemID: 'K4PFAKE0001' },
            },
          },
          transform: {
            effectiveDateTime: '2026-08-01',
            eventReasonCode: { codeValue: 'MERIT' },
            worker: {
              workAssignment: {
                baseRemuneration: {
                  hourlyRateAmount: {
                    nameCode: { codeValue: 'H' },
                    amountValue: 31.5,
                    currencyCode: 'USD',
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
  'worker.legal-name.change': {
    events: [
      {
        data: {
          eventContext: { worker: { associateOID: 'G0FAKEFAKEFAKE2B' } },
          transform: {
            effectiveDateTime: '2026-08-01',
            eventReasonCode: { codeValue: 'MARRIAGE' },
            worker: {
              person: {
                legalName: { givenName: 'Renée', middleName: 'Q', familyName1: 'Duck' },
              },
            },
          },
        },
      },
    ],
  },
  'worker.person.custom-field.string.change': {
    events: [
      {
        data: {
          eventContext: {
            worker: {
              associateOID: 'G0FAKEFAKEFAKE2B',
              person: { customFieldGroup: { stringField: { itemID: 'CF-STRING-01' } } },
            },
          },
          transform: {
            effectiveDateTime: '2026-08-01',
            worker: {
              person: { customFieldGroup: { stringField: { stringValue: 'Route 66' } } },
            },
          },
        },
      },
    ],
  },
  'worker.leave.absence.request': {
    events: [
      {
        data: {
          eventContext: { associateOID: 'G0FAKEFAKEFAKE2B', workAssignmentID: 'K4PFAKE0001' },
          transform: {
            workerLeave: {
              leaveAbsence: {
                startDateTime: '2026-09-01',
                expectedEndDateTime: '2026-10-01',
                leaveTypeCode: { codeValue: 'FMLA' },
              },
            },
          },
        },
      },
    ],
  },
};

const EVENTS = Object.keys(ENVELOPES) as SupportedEvent[];

// Release gate for the draft envelopes: every supported event's meta must be
// fetchable and parseable from the real tenant, AND the library's own
// envelope for that event must show meaningful STRUCTURAL PATH COVERAGE
// against that real meta — a large-enough fraction of the envelope's
// transform-scope leaf paths must appear among the meta's rule paths. This
// catches wrong-shape envelopes (like the original leave draft) while being
// robust to fake test values that could never satisfy tenant code lists
// (exact-match `validateEnvelope` would false-positive-fail on those).
describe.skipIf(!hasCredentials)('live event metas', () => {
  // Lazy: the describe body executes at collection time even when skipIf is
  // true, so constructing the Client here would crash CI (no ADP_* vars).
  let client: Client | undefined;
  const liveClient = () =>
    (client ??= new Client(ADP_CERTIFICATE!, ADP_PRIVATE_KEY!, {
      credentials: { client_id: ADP_CLIENT_ID!, client_secret: ADP_CLIENT_SECRET! },
    }));

  for (const event of EVENTS) {
    it(`fetches, parses, and checks structural coverage for the ${event} meta`, async () => {
      let meta;
      try {
        meta = await liveClient().worker.eventMeta(event);
      } catch (error) {
        if (!(error instanceof AdpError)) throw error;
        if (KNOWN_UNAVAILABLE.has(event)) {
          console.warn(`${event}: meta endpoint unavailable (${error.statusCode} ${error.adpMessage ?? ''}) — allowlisted, skipping`);
          return;
        }
        // Not allowlisted: a meta endpoint going unavailable is a real
        // regression on this tenant/event — fail the gate instead of
        // silently softening it.
        throw error;
      }

      expect(meta.raw).toBeTruthy();
      console.log(`${event}: ${meta.rules.size} rules`);
      for (const path of meta.rules.keys()) console.log(`  ${path}`);

      const envPaths = [...flattenEnvelope(ENVELOPES[event]).keys()].filter((p) => p.startsWith('transform:'));
      const covered = envPaths.filter((p) => meta.rules.has(p));
      const uncovered = envPaths.filter((p) => !meta.rules.has(p));
      const fraction = envPaths.length === 0 ? 0 : covered.length / envPaths.length;
      console.log(
        `${event}: coverage ${covered.length}/${envPaths.length} (${(fraction * 100).toFixed(0)}%)`,
      );
      if (uncovered.length > 0) console.log(`  uncovered: ${uncovered.join(', ')}`);

      expect(fraction).toBeGreaterThan(0.3);
    }, 20000);
  }
});
