# Phase 1 benchmark protocol v1

**Status:** draft, revised before freeze (2026-11-17) — must be merged and frozen before any evaluation run.

**Protocol version:** `1`  
**Artifacts:** [`manifest.json`](manifest.json), [`repositories.json`](repositories.json), [`tasks.json`](tasks.json), [`decision-rule.json`](decision-rule.json)

## Purpose

Compare two conditions on identical tasks, models, and pinned repositories:

| Condition     | Access                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `raw`         | Checkout + shell/file tools only                                                             |
| `agent-ready` | Same, plus Discovery Snapshot Format 1 and bounded `twin query` (no extra edit/build powers) |

The only intended difference is repository model access.

## Immutability

After the first evaluation run using this protocol:

- Do **not** edit files in `v1/`.
- Any change creates **`v2/`** as a sibling; v1 tasks, manifests, and raw results remain.

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
| **verificationSelectionResult**    | True if the agent ran a command matching the task's `verificationSurface` expectation.                                                                                                  |
| **timeToFirstCorrectModification** | Seconds from task start to the first patch passing the partial oracle; `null` if none.                                                                                                  |

Secondary (exploratory only): total wall time, files modified, verification attempts, failed tool calls.

## Aggregation (summary keys consumed by the decision rule)

Summaries are computed only from valid (non-infrastructure-failure) runs:

| Summary key                        | Definition                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| `taskSuccessRate`                  | Mean of `success`.                                              |
| `invalidAssumptionRate`            | Mean number of adjudicated invalid assumptions per run.         |
| `incorrectDependencyReasoningRate` | Mean number of dependency-reasoning findings per run.           |
| `verificationSelectionFailureRate` | `1 −` mean of `verificationSelectionResult`.                    |
| `unnecessaryFileReadsMedian`       | Median of `unnecessaryFileReads` across runs for the condition. |

A summary that omits a safety metric is treated as failing that gate; a summary that omits `taskSuccessRate` is a harness error and the evaluator throws.

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

Each run produces one JSON document validating against [`schemas/research/phase1-benchmark-raw-run-v1.schema.json`](../../../../schemas/research/phase1-benchmark-raw-run-v1.schema.json). Adjudication fields are separate from raw tool logs.

## Run manifest (before first run)

Before evaluation, commit a **run manifest** with: protocol version, model id, agent client version, configuration, OS, Node version, Agent-Ready SHA, repository SHAs, run count, budgets, randomization seed, and date. Do not mutate after the first trial starts.

## Publication

Report all valid runs (mean/median as predeclared, variance, intervals, per-task tables). No best-of-N selection.

## Related

- Snapshot stability: [`docs/vnext/SNAPSHOT-STABILITY.md`](../../../vnext/SNAPSHOT-STABILITY.md)
- Twin query: ADR-0049
