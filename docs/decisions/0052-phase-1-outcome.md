# ADR-0052: Phase 1 outcome and Phase 2 authorization (draft, pre-registered)

- **Status:** Draft — the outcome is intentionally blank until #62. The
  consequence mapping below is decided **before** any trial is run.
- **Date:** 2026-11-19
- **Related:** [RFC-0001](../vnext/RFC-0001-autonomous-software-evolution.md),
  ADR-0041, ADR-0042, ADR-0043, ADR-0048, ADR-0051; protocol v1
  ([PROTOCOL.md](../research/phase1-benchmark-protocol/v1/PROTOCOL.md),
  [decision rule](../research/phase1-benchmark-protocol/v1/decision-rule.json));
  milestone [#1](https://github.com/AdamEddahmouni/agent-ready/milestone/1),
  issues [#57](https://github.com/AdamEddahmouni/agent-ready/issues/57),
  [#61](https://github.com/AdamEddahmouni/agent-ready/issues/61),
  [#62](https://github.com/AdamEddahmouni/agent-ready/issues/62)

## Context

Phase 1 asks one falsifiable question: whether a deterministic repository model
materially improves an agent over raw filesystem and shell access
([RFC-0001](../vnext/RFC-0001-autonomous-software-evolution.md)). The protocol
that answers it was frozen on 2026-11-17 — five pinned repositories, thirteen
tasks, three runs per task per condition, 78 trials — with a predeclared
decision rule producing exactly one of four outcomes: `helps`,
`noDemonstratedBenefit`, `mixed`, or `harms`.

The rule is already fixed, but the **consequence** of each outcome was not.
Writing it now, before the pilot, is the point: a consequence chosen after
seeing the numbers is not a decision rule, it is a rationalization. This ADR
exists so that #62 fills in measurements, not policy.

This record is deliberately a draft. It has no authority until the evaluation
run completes and the measurements and limitations are recorded.

## Decision

> **PENDING (filled by #62).** The Phase 1 outcome, measured under protocol v1
> unchanged, is: `PENDING`.

### Evidence to be recorded (all slots must be filled or explicitly unavailable)

| Field                                                  | Value                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Run manifest id                                        | PENDING (#57)                                                           |
| Agent-Ready release/SHA pinned                         | PENDING (#57, #64)                                                      |
| Model id and client version                            | PENDING (#57)                                                           |
| Valid trials per condition                             | PENDING (#61)                                                           |
| Excluded / failed trials                               | PENDING (#61)                                                           |
| `taskSuccessRate` (raw / agent-ready, Wilson interval) | PENDING                                                                 |
| `invalidAssumptionRate`                                | PENDING                                                                 |
| `incorrectDependencyReasoningRate`                     | PENDING                                                                 |
| `verificationSelectionFailureRate`                     | PENDING                                                                 |
| `unnecessaryFileReadsMedian`                           | PENDING                                                                 |
| Raw data location and checksums                        | PENDING (#61)                                                           |
| Reproduction command                                   | `pnpm research:benchmark-reproduce --raw <run-dir>/raw --out <run-dir>` |

No claim of statistical significance will appear in the completed record: with
39 trials per condition, the rule is a screening heuristic
([PROTOCOL.md](../research/phase1-benchmark-protocol/v1/PROTOCOL.md#statistical-limits)).

### Pre-committed consequence of each outcome

| Outcome                 | Consequence                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `helps`                 | Phase 2 **planning** may begin. Phase 2 implementation still requires its own ADR, and Phase 1's result is reported as a screen, not proof.    |
| `noDemonstratedBenefit` | Phase 2 is **not** authorized. The result is published as a real result, and vNext discovery scope is reconsidered before more model is built. |
| `mixed`                 | Treated as no demonstrated benefit for autonomy: Phase 2 is **not** authorized; the failing safety gate becomes the next research question.    |
| `harms`                 | The vNext direction is **stopped** pending the RFC's falsification reassessment. No Phase 2 work starts from this result.                      |

A null result is a successful Phase 1. The failure mode this table exists to
prevent is a decade of infrastructure defending an unfalsified premise.

### Limitations that must be published with the outcome

- **Statistical power.** 39 binary trials per condition; a 5 percentage-point
  margin is inside sampling noise. Intervals are reported per task as well as
  per condition.
- **Adjudication.** `manual-rubric` tasks require two blinded reviewers and a
  distinct third on disagreement. If independent reviewers cannot be secured,
  the completed ADR must state single-reviewer adjudication as a limitation
  before results are read.
- **Token completeness.** Clients that do not report cached or reasoning tokens
  produce `null`, never an estimate.
- **Platform coverage.** State whether trials ran on one OS or several; do not
  imply cross-platform results that were not measured.
- **Model and client constants.** Any change to model, client version, or
  configuration between conditions invalidates the comparison and is reported
  as such.

## Alternatives considered

### Decide the consequences after the result is known

Rejected. That is the failure this record exists to prevent: the same evidence
supports "the model needs another iteration" indefinitely when the consequence
is chosen after the fact.

### Treat `helps` as authorization to build Phase 2

Rejected. A screening result at this power cannot authorize a transaction
runtime, a Constitution, or capability enforcement. It can justify planning
them, under a new ADR with its own exit conditions.

### Omit the `harms` row because the direction is promising

Rejected. A direction whose stated failure mode has no operational consequence
is not falsifiable ([RFC-0001 §Falsification](../vnext/RFC-0001-autonomous-software-evolution.md)).

## Consequences

- #62 becomes a measurement-and-fill-in exercise, not a negotiation.
- If the run is abandoned (budget, infrastructure, reviewer availability), this
  ADR is **not** completed as an outcome. It is superseded by a record that says
  the evaluation did not happen, and Phase 2 remains unauthorized.
- The repository gains a second pre-registration: the protocol fixes what is
  measured; this ADR fixes what the measurement means.

## Reconsideration trigger

Revisit only if the protocol is superseded by a new version with results
retained, or if the evaluation is abandoned. Changing a row of the consequence
table after the result exists requires a superseding ADR that states the
original mapping and why it was wrong.
