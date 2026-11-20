# Proposal 0002 — a task with no command check is not a verification failure

**Status:** draft, not applied. v2 stays frozen and byte-identical; if accepted
this becomes a sibling `v3/`, per
[`PROTOCOL.md`](../v2/PROTOCOL.md) and [`FROZEN.sha256`](../v2/FROZEN.sha256)
("any further change creates `v3/`").

**Affected metric:** `verificationSelectionResult` and the
`verificationSelectionFailureRate` summary derived from it.

## Defect

v2 defines `verificationSelectionResult` as "true if the agent executed one of
the task's `command-exit-zero` checks". Ten of the thirteen tasks have no such
clause — their oracles are response JSON, file contents, or a manual rubric — so
they can never be true, and they are recorded `false`:

| Oracle shape                       | Tasks                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Has `command-exit-zero`            | `axios-03`, `jest-03`, `nestjs-03`                                               |
| No command check (records `false`) | the other ten, including the read-only `axios-01` and every `manual-rubric` task |

Two consequences follow.

**The reported rate is mostly a constant.** `verificationSelectionFailureRate` is
`1 − mean(verificationSelectionResult)`, so its floor is `10/13 ≈ 0.769` even if
every agent runs every check it is given. In the v2 pilot both `axios-01`
conditions succeeded and both reported a 100% verification failure rate,
because neither task had anything to verify. A reader cannot distinguish "the
agent ignored the check" from "this task has no check".

**The safety gate loses resolution.** The gate compares conditions by an
absolute increase in that rate. A constant offset cancels in a difference, so
the gate still points the right way, but only three of thirteen tasks can move
it: a real regression in the command tasks moves the rate by at most `3/13`, a
4.3× dilution of the signal the gate is meant to catch.

## What "not applicable" should mean

Not a pass and not a failure. A task whose oracle declares no command check has
nothing to execute, so the run should carry no verdict, and summaries should be
computed over runs that had something to verify — reporting the excluded count
so a reader can see how much of the plan the rate actually covers.

## Options

**A — exclude inapplicable runs at aggregation.** Keep the record boolean and
let the summary skip tasks whose oracle has no command check. No schema change,
but the meaning of a stored `false` then depends on the task manifest version
rather than on the record, so the same bytes mean different things under
different protocol versions. That is the property records exist to avoid.

**B — make the field tri-state.** `verificationSelectionResult` becomes
`true`, `false`, or `null` (not applicable), set by the harness from the task's
oracle. Aggregation takes the mean over runs where it is non-null and reports
`verificationSelectionNotApplicableCount` alongside. The value is in the record,
so a record is self-describing under any version.

**C — add a separate applicability flag.** A second boolean
(`verificationApplicable`) next to the result. Explicit, but two fields can
disagree, and every consumer has to learn to read both.

**Recommendation: B.** One field, three honest states, no derived ambiguity.
The cost is a schema revision and a denominator change, both of which v3 is for.

## What it affects

Must change (in a new `v3/`, leaving v2 intact):

- `PROTOCOL.md` — the metric table and the aggregation note that already points
  here, plus the safety-gate wording so the rate is defined over applicable
  runs.
- `schemas/research/phase1-benchmark-raw-run-v3.schema.json` — the field becomes
  `["boolean", "null"]`; a v3 run-manifest schema follows the same pattern.
- `harness/verificationSelection.ts` and `harness/run.ts` — return and write
  `null` instead of `false` when the oracle declares no command check.
- `aggregate.ts`, `report.ts`, `reproduce.ts` — mean over applicable runs, the
  new not-applicable count, and a report line stating the coverage.
- `validate-protocol.mjs` and CI — v3 joins the versions list; v1 and v2 keep
  validating.
- A v3 run manifest with its own id and digest.

Not affected:

- Every task prompt and oracle, the repository pins, the run size (3 per task
  per condition), budgets, decision thresholds, and the 78-trial plan. Reusing
  the same seed keeps the order unchanged, so v2 and v3 pair trial-for-trial.
- The per-run cost of a trial. Only the meaning of one field changes.

Consequences to accept:

- **v3 needs its own records.** v2 records carry `false` for inapplicable tasks
  and cannot be reinterpreted: a record is evidence of what was written, and
  re-deriving a published metric from immutable bytes would make every earlier
  report unreproducible. A full v3 measurement is 78 fresh trials (~6.1M input
  tokens, ~24 minutes by the current estimate); a pilot pair on `axios-01`
  (expect `null`) plus one on `axios-03` (expect `true`) would demonstrate the
  change for roughly two trials.
- **Existing v2 reports keep their floor.** They should say so explicitly rather
  than be recomputed.

## If accepted

1. Copy `v2/` to `v3/`, make the field tri-state, and re-freeze.
2. Update the aggregation and report to exclude `null` and count it.
3. Rerun the two-task pilot and confirm `axios-01` is `null` while `axios-03`
   still records `true`, with task success unchanged.
