# Phase 1 benchmark protocol v1

**Status:** draft for merge — must be merged and frozen before any evaluation run.

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

Five public repositories from the Snapshot Format 1 corpus study — see [`repositories.json`](repositories.json). Each evaluation run pins the listed commit SHA.

## Task set

Ten fixed tasks in [`tasks.json`](tasks.json). Prompts are committed verbatim; agents receive the same prompt text in both conditions (plus condition-specific tool description in the run harness, not paraphrased per run).

## Runs

- **3 runs per task per condition** (90 raw + 90 agent-ready trials at full scale).
- Infrastructure failure: retry once per protocol run manifest; if still failing, record `infrastructureFailure: true` and draw a replacement run only if spare budget was pre-declared in the run manifest (default: no replacement — report failure).

## Metrics (operational)

| Metric                             | Definition                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **taskSuccess**                    | Binary per run: success oracle in task manifest satisfied (automated check or blinded human rubric `manual-rubric`).                                                                                                |
| **unnecessaryFileReads**           | Count of file read tool calls whose path was not in the minimal necessary set defined in the task's `verificationSurface` plus one hop (adjudicated post-hoc from logs; disagreements resolved by second reviewer). |
| **toolCalls**                      | All non-read tools (write, search, shell, etc.) counted per run.                                                                                                                                                    |
| **tokens**                         | Input, output, cached, reasoning — as reported by the evaluation environment; if unavailable, record `null` and treat as limitation.                                                                                |
| **invalidAssumptions**             | Count of factual claims about repo structure contradicted by pinned tree (claim/evidence/adjudication stored separately).                                                                                           |
| **incorrectDependencyReasoning**   | Count of errors classifying dependency scope, internal vs external, or lockfile vs manifest (predeclared error classes in runbook).                                                                                 |
| **verificationSelection**          | 1 if agent ran a command matching task `verificationSurface` expectation, 0 otherwise.                                                                                                                              |
| **timeToFirstCorrectModification** | Seconds from task start to first patch passing partial oracle; `null` if no correct modification.                                                                                                                   |

Secondary (exploratory only): total wall time, files modified, verification attempts, failed tool calls.

## Decision rule

Mechanical rule in [`decision-rule.json`](decision-rule.json), implemented in [`research/phase1-benchmark/evaluate-decision.mjs`](../../../research/phase1-benchmark/evaluate-decision.mjs). Outcomes: `helps`, `noDemonstratedBenefit`, `mixed`, `harms`.

Correctness gates before efficiency. Null results are publishable.

## Raw data

Each run produces one JSON document validating against [`schemas/research/phase1-benchmark-raw-run-v1.schema.json`](../../../schemas/research/phase1-benchmark-raw-run-v1.schema.json). Adjudication fields are separate from raw tool logs.

## Run manifest (before first run)

Before evaluation, commit a **run manifest** with: protocol version, model id, agent client version, configuration, OS, Node version, Agent-Ready SHA, repository SHAs, run count, budgets, date. Do not mutate after the first trial starts.

## Publication

Report all valid runs (mean/median as predeclared, variance, per-task tables). No best-of-N selection.

## Related

- Snapshot stability: [`docs/vnext/SNAPSHOT-STABILITY.md`](../../vnext/SNAPSHOT-STABILITY.md)
- Twin query: ADR-0049
