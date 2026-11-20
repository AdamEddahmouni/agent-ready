# Phase 1 benchmark protocol v3

**Status:** proposed successor to [v2](../v2/PROTOCOL.md), which stays frozen with its results. This revision changes verification-applicability scoring and nothing else. Its presence does not, by itself, authorize it as the official run.

**Protocol version:** `3`  
**Supersedes:** `2`  
**Artifacts:** [`manifest.json`](manifest.json), [`repositories.json`](repositories.json), [`tasks.json`](tasks.json), [`decision-rule.json`](decision-rule.json), [`run-manifest.template.json`](run-manifest.template.json)

**Run-manifest schema:** [`phase1-benchmark-run-manifest-v3.schema.json`](../../../../schemas/research/phase1-benchmark-run-manifest-v3.schema.json)

## Purpose

Compare two conditions on identical tasks, models, and pinned repositories:

| Condition     | Access                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `raw`         | Checkout + shell/file tools only                                                             |
| `agent-ready` | Same, plus Discovery Snapshot Format 1 and bounded `twin query` (no extra edit/build powers) |

The only intended difference is repository model access.

## Immutability

Protocol v3 is an independent sibling of the frozen v1 and v2 protocols, prepared on **2026-11-20**.

- Do **not** edit frozen v1 or v2 files or reinterpret their raw records. Their results remain reproducible against their own schema and decision rules.
- The eight v3 files listed in [`FROZEN.sha256`](FROZEN.sha256) are checksum-pinned. Any later change to one of them requires a new v4 rather than in-place editing.
- Do not aggregate v1, v2 and v3 records together. The official run manifest identifies the selected version.

## Changes in v3

This version implements [proposal 0002](../proposals/0002-verification-not-applicable.md), correcting a measurement problem rather than a task or oracle.

Under v2, ten of thirteen tasks have no `command-exit-zero` clause, yet they record `verificationSelectionResult: false`. The minimum apparent verification failure rate is therefore 10/13 even when every applicable command is executed. In v3:

- `true` means a required command was actually executed;
- `false` means a required command exists but the agent did not execute it;
- `null` means the task requires no command check and so the metric is **not applicable**, not failed.
- The failure rate is computed over applicable valid runs; when no valid runs have an applicable command, the rate is `null` and the existing safety gate fails closed.
- Condition and per-task reports disclose `verificationSelectionApplicableCount` and `verificationSelectionNotApplicableCount`; a per-run non-applicable value is displayed as `n/a`.

No task prompt, oracle, repository SHA, timeout, budget structure, randomization rule, trial count or decision threshold changes from v2. V2's corrected `axios-01` oracle remains intact. The same randomization seed can be reused to compare versions without pooling their evidence.

V3 is a proposed scoring protocol, not a claim that the official 78 trials have run.

## Repository set

Five public repositories from the Snapshot Format 1 corpus study — see [`repositories.json`](repositories.json). Each evaluation run pins the listed **full 40-character commit SHA**; abbreviated SHAs are not acceptable because they are not stable pins.

## Task set

Thirteen fixed tasks in [`tasks.json`](tasks.json): nine read-only tasks, one single-edit task (`axios-02`), and three edit-and-verify tasks (`axios-03`, `jest-03`, `nestjs-03`). Prompts are committed verbatim; agents receive the same prompt text in both conditions (plus condition-specific tool description in the run harness, not paraphrased per run).

Every task declares:

| Field                 | Meaning                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `successOracle`       | Mechanical or adjudicated success check (see [Oracles](#oracles)).                              |
| `forbidden`           | Actions that invalidate the run if observed in the tool log.                                    |
| `verificationSurface` | Files or commands a correct solution must consult or run; also the basis for unnecessary reads. |
| `timeoutMinutes`      | Wall-clock cap per trial.                                                                       |

`manual-rubric` oracles carry their rubric text inline in the task, so the scoring rule travels with the task and cannot drift from a rubric stored elsewhere.

## Runs

- **3 runs per task per condition**: 13 tasks × 3 = **39 valid trials per condition**, 78 in total at full scale.
- Run order is randomized per condition pair; the run manifest records the randomization seed.
- Infrastructure failure: retry once per protocol run manifest; if still failing, record `infrastructureFailure: true` and draw a replacement run only if spare budget was pre-declared in the run manifest (default: no replacement — report failure).

## Statistical limits

The decision rule is a **predeclared screening heuristic**, not a significance test. With 39 binary trials per condition, a 5 percentage-point primary margin is well inside sampling noise: the 95% interval for a success rate near 0.8 is roughly ±13 percentage points per condition. Consequently:

- Report Wilson intervals alongside every rate, and per-task results, not only condition totals.
- Never describe a `helps` or `harms` outcome as statistically significant.
- Never select a favorable subset of runs or tasks; all valid runs are reported.
- A `noDemonstratedBenefit` outcome is a real result and must be published as such.

## Metrics (per run)

| Metric                             | Definition                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **success**                        | Binary per run: success oracle in the task manifest satisfied (mechanical check or blinded rubric adjudication).                                                                        |
| **unnecessaryFileReads**           | Count of file read tool calls whose path was not in the minimal necessary set defined by the task's `verificationSurface` plus one hop (adjudicated post-hoc from logs; two reviewers). |
| **toolCalls**                      | All non-read tools (write, search, shell, etc.) counted per run.                                                                                                                        |
| **tokenMetrics**                   | Input, output, cached, reasoning — as reported by the evaluation environment; record `null` when unavailable and treat it as a limitation.                                              |
| **assumptions**                    | Factual claims about repository structure, each with claim, evidence and adjudication; contradicted claims are invalid assumptions.                                                     |
| **dependencyReasoningFindings**    | Errors classifying dependency scope, internal vs external, or lockfile vs manifest, using the error classes in the runbook.                                                             |
| **verificationSelectionResult**    | `true` if a required check ran, `false` if it was omitted, and `null` if no command-exit-zero check exists (not applicable).                                                            |
| **timeToFirstCorrectModification** | Seconds from task start to the first patch passing the partial oracle; `null` if none.                                                                                                  |

Secondary (exploratory only): total wall time, files modified, verification attempts, failed tool calls.

## Aggregation (summary keys consumed by the decision rule)

Summaries are computed only from valid runs, excluding infrastructure failures and forbidden actions.

| Summary key                               | Definition                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `taskSuccessRate`                         | Mean of binary success across all valid runs.                                                        |
| `invalidAssumptionRate`                   | Mean number of adjudicated invalid assumptions per valid run.                                        |
| `incorrectDependencyReasoningRate`        | Mean dependency-reasoning findings per valid run.                                                    |
| `verificationSelectionFailureRate`        | Failed applicable checks divided by applicable valid runs; `null` when there are no applicable runs. |
| `verificationSelectionApplicableCount`    | Count of valid runs with a required command check. Reported, not consumed by the decision rule.      |
| `verificationSelectionNotApplicableCount` | Count of valid runs with no required command check. Reported, not consumed by the decision rule.     |
| `unnecessaryFileReadsMedian`              | Median of unnecessary file reads across valid runs in that condition.                                |

The selection denominator is **not** the total number of trials: the command requirement applies to three of thirteen tasks. V1 and v2 keep their original semantics and summaries. Missing safety metrics fail their gates closed; a missing primary task-success metric is a harness error.

## Decision rule

Mechanical rule in [`decision-rule.json`](decision-rule.json), implemented in [`research/phase1-benchmark/evaluate-decision.mjs`](../../../../research/phase1-benchmark/evaluate-decision.mjs). Outcomes: `helps`, `noDemonstratedBenefit`, `mixed`, `harms`.

Gate semantics are explicit in the rule file:

- Primary and safety thresholds are **absolute differences in proportion** (percentage points), not relative percentages.
- Missing safety metrics **fail** the gate (fail-closed).
- The benefit gate requires a raw baseline median of at least 1; below that it cannot pass.

Correctness gates run before efficiency gates. Null results are publishable.

## Oracles

| Type                        | Applies to                          | Semantics                                                                                      |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `response-json-path-equals` | Tasks with `responseFormat: "json"` | The final message parses as JSON and the dotted path equals the expected value.                |
| `file-contains`             | Workspace                           | The file contains the exact substring.                                                         |
| `file-json-equals`          | Workspace                           | Parsing the file as JSON, the RFC 6901 pointer resolves to a value equal to `value`.           |
| `command-exit-zero`         | Workspace                           | The command exits 0 in `cwd` (default repository root), after the task's edit is applied.      |
| `manual-rubric`             | Adjudication                        | Two blinded reviewers apply the task's inline `rubric`; disagreements are resolved by a third. |
| `all-of`                    | Workspace                           | Every clause must pass.                                                                        |

## Enforcement

Forbidden actions are enforced post-hoc from the tool log. A run that performs a forbidden action is marked invalid and excluded from aggregation, with the reason recorded; it is not retried.

## Raw data

Each run produces one JSON document validating against [`schemas/research/phase1-benchmark-raw-run-v3.schema.json`](../../../../schemas/research/phase1-benchmark-raw-run-v3.schema.json). Adjudication fields are separate from raw tool logs.

## Run manifest (before first run)

Before evaluation, commit a **run manifest** conforming to [`phase1-benchmark-run-manifest-v3.schema.json`](../../../../schemas/research/phase1-benchmark-run-manifest-v3.schema.json). Start from [`run-manifest.template.json`](run-manifest.template.json) and replace every placeholder.

The manifest records the protocol version, model id and configuration, agent client version, OS and Node version, Agent-Ready commit, the five repository commits, the 3 × 13 = 39-per-condition / 78-total run arithmetic, budgets, randomization seed, and date. Its `id` is the `runManifestId` cited by every raw run record. Do not mutate it after the first trial starts; the actual manifest is #57.

## Publication

Report all valid runs (mean/median as predeclared, variance, intervals, per-task tables). No best-of-N selection.

## Related

- Snapshot stability: [`docs/vnext/SNAPSHOT-STABILITY.md`](../../../vnext/SNAPSHOT-STABILITY.md)
- Twin query: ADR-0049
