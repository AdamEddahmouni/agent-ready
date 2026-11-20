# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks the frozen protocol counts, task fields, oracles, decision-rule shape, run-manifest template, and freeze hashes
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics
- `aggregate.ts` — schema-validates raw runs, excludes infrastructure failures and forbidden actions, and computes the five predeclared summaries, sample variance, Wilson intervals, and per-task aggregates
- `report.ts` — validates that a report accounts for every raw run and renders deterministic JSON and Markdown with per-file SHA-256 checksums
- `adjudication.ts` — requires two reviewers for manual rubrics and a distinct third reviewer on disagreement; adjudications are stored in a separate sidecar file, and it also parses the separate post-hoc unnecessary-read sidecar
- `capture.ts` — turns a saved client event log into Agent Transcript v1 (see below)
- `run-manifest.ts` — schema-validates a run manifest and cross-checks its repository pins, run arithmetic, and budgets against protocol v1
- `pilot.ts` — deterministic pilot/full-run dry-run planner from a validated manifest and its randomization seed
- `reproduce.ts` — one-command raw → derived → report reproduction

Raw run records validate against `schemas/research/phase1-benchmark-raw-run-v1.schema.json`. Run manifests start from `docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json` and validate against `schemas/research/phase1-benchmark-run-manifest-v1.schema.json`. The committed run v1 manifest, its digest lock, and the pilot runbook live in [`docs/research/phase1-benchmark-run-v1`](../../docs/research/phase1-benchmark-run-v1/README.md).

## Evaluation harness

`harness/` contains the typed, offline-testable stages:

- `prepare.ts` — fresh checkout per trial at the full pinned SHA, plus an agent-ready snapshot outside the checkout
- `run.ts` — identical prompt/model/config for both conditions; only the access descriptor differs
- `score.ts` — all six oracle types, post-hoc forbidden-action detection, and the partial-oracle timing metric
- `record.ts` — strict validation against the raw-run schema
- `fakeRunner.ts` — scripted runner for CI; no model, network, or subprocess calls
- `plan.ts` — the trial order, derived from the run manifest's seed
- `access.ts` — the condition-specific tool description and the snapshot query wrapper
- `codexRunner.ts` — the live runner: `codex exec --json`, log capture, measured timing
- `codex.ts` — the adapter that turns that log into Agent Transcript v1
- `manifest.ts` — the run manifest loader and protocol pin check

`tests/research/` exercises every oracle and forbidden-action class, a fake two-condition end-to-end run, the snapshot-only `twin query` guarantee, aggregation and Wilson arithmetic, all four decision outcomes, report completeness, reviewer adjudication, the unnecessary-read sidecar, run-manifest validation, and the pilot plan. `research:benchmark-test` runs the whole research test directory.

## Runner adapter and transcripts

`AgentRunner` ([`harness/run.ts`](harness/run.ts)) is the only seam between the
benchmark and an agent. [TRANSCRIPT-CONTRACT.md](TRANSCRIPT-CONTRACT.md) defines
Agent Transcript v1 — the normalized document an adapter records and
`TranscriptReplayRunner` replays — and the provenance rule: a transcript must be
a real capture to count, and an authored fixture may be replayed only by tests.

[`harness/transcript.ts`](harness/transcript.ts) validates the document against
[`schemas/research/phase1-benchmark-transcript-v1.schema.json`](../../schemas/research/phase1-benchmark-transcript-v1.schema.json)
and rejects absolute paths, decreasing timestamps, and unknown event kinds.
Replay applies recorded writes to the prepared workspace (so edit-task oracles
see the recorded state) and invokes no model and no subprocess.
[`harness/claudeCode.ts`](harness/claudeCode.ts) converts a Claude Code
`stream-json` session into the same document, and
[`harness/codex.ts`](harness/codex.ts) converts `codex exec --json`.

[`capture.ts`](capture.ts) is the entry point that runs an adapter over a saved
log and writes the document. It needs the checkout the session ran in, because a
Codex file change carries a path but no content:

```bash
pnpm research:benchmark-capture \
  --client codex --log session.jsonl \
  --task axios-02-add-devdep --condition raw --workspace /tmp/checkout \
  --started-at 2026-11-17T00:00:00.000Z --model-id <model> \
  --out transcripts/axios-02-add-devdep.json
```

`--client-version`, `--captured-at` and `--on-shell-mutation flag` are optional;
Claude Code logs may omit `--model-id` because their init event records it. A
Codex `file_change` carries no content, so convert against the untouched
checkout: the adapter reads each changed file when it runs.

[`captures/`](captures/README.md) holds real captured sessions with their raw
logs and replay results. They are single sessions, not protocol runs.

## Running trials

One command per run. It prepares a fresh checkout at the pinned SHA, builds the
snapshot for the `agent-ready` condition, runs the client once per trial, saves
the raw log and transcript, scores through `executeTrial`, and writes
`raw/<task>--<condition>--<runIndex>.json`:

```bash
pnpm research:benchmark-build-agent-ready   # once: builds the manifest's pinned commit
pnpm research:benchmark-run --out runs/phase1-v1          # all 78, in seed order
pnpm research:benchmark-run --out runs/pilot --task axios-03-add-sponsor-data-check --runs 1 --limit 2
pnpm research:benchmark-run --out runs/dry --dry-run      # scripted runner, no model
```

An existing record is skipped, so an interrupted run resumes where it stopped
(`--force` re-runs it). A trial that fails infrastructure is retried once and
then recorded with `infrastructureFailure: true`. The run stops when the
manifest's token or wall-clock cap is reached. `--dry-run` writes under
`<out>/dry-run` and cites `<manifest id>-dry-run`; those records are plumbing
evidence and must never be published as protocol results.

The `agent-ready` condition needs a CLI built from the manifest's pinned commit.
`research:benchmark-build-agent-ready` exports that commit with `git archive`,
builds it against this checkout's installed dependencies, and stamps the result
with `.agent-ready-build.json`. The runner then verifies the stamp: a missing
stamp, another commit, or a dirty tree is refused, so a stale `dist/` cannot
stand in for the artifact under test. Pass `--build-agent-ready` to build during
the run, or `--agent-ready-cli <path>` to verify a build you made yourself. The runner writes `<runRoot>/bin/agent-ready`, which calls
`twin query` with that trial's snapshot appended, and prepends the directory to
the client's `PATH`. That wrapper changes to the package root before executing,
because the CLI resolves its bundled schemas relative to the working directory.

## Protocol versions

Two frozen versions exist and both stay readable. v2 supersedes v1 by
correcting the `axios-01` script oracle (proposal 0001); every other task,
repository pin and budget is identical. `loadProtocolForVersion` selects the
directory, raw records are validated against the schema of the version they
cite, the runner writes the manifest's version, and aggregation refuses a
directory that mixes versions. New runs default to the v2 run manifest;
v1 records and their reports stay as written.

## Condition access

Both conditions receive the task prompt verbatim followed by one fixed
description block, built from a template rather than written per trial. The
`agent-ready` block names the snapshot, lists the query kinds, and says that
for repository-structure questions — the package set, a package's scripts,
module layout, imports, ownership — the query is the intended source and
answers in one command. It also points at `agent-ready twin query --help` for
the kinds that need `--parameter`.

The wrapper prepended to `PATH` binds the trial's snapshot by appending
`--snapshot <path>`, and refuses any caller-supplied `--snapshot`
(`--snapshot` or `--snapshot=`, exit 2), so a trial cannot query a different
artifact.

`verificationSelectionResult` is derived in
`harness/verificationSelection.ts` from the oracle's `command-exit-zero`
clauses and nothing else, and only when the check was actually `executed`. A
recorded shell call is tokenized with quote awareness, split into simple
commands, unwrapped from `bash -lc "…"`, stripped of `env`/`FOO=bar` prefixes,
and compared word for word, so `rg "npm run check:sponsor-data"`,
`echo …` and a command that only appears inside a log never count.

A script named in `verificationSurface` does not count. The surface records
where an answer lives, not what the agent should run — `axios-01` names
`package.json scripts.test` because the answer is that script's name, and a
read-only task must not read as verified because the agent happened to run the
suite. A task with no command clause leaves the field at its recorded value.

## Reproducing metrics and reports

Run from a clean checkout with raw records in `<run-dir>/raw/`:

```bash
pnpm research:benchmark-reproduce --raw <run-dir>/raw --out <run-dir>
```

This validates every raw record against the frozen schema, applies the unchanged `decision-rule.json`, and writes `<run-dir>/derived/metrics.json`, `<run-dir>/report/report.json`, and `<run-dir>/report/report.md`. The report includes every valid and excluded run, per-task tables, intervals, limitations, and per-file plus combined SHA-256 checksums. Output contains no timestamps or checkout paths, so the same raw bytes reproduce byte-identically. Verify an existing output tree with:

```bash
pnpm research:benchmark-reproduce --raw <run-dir>/raw --out <run-dir> --check
```

`--rule <path>` overrides the frozen decision rule only for testing; publication runs use the default.

A post-hoc, two-reviewer unnecessary-read adjudication sidecar can be applied with `--adjudications <path>`:

```json
{
  "protocolVersion": 1,
  "unnecessaryFileReads": [{ "runKey": "manifest#task#raw#0", "unnecessaryFileReads": 1 }]
}
```

The sidecar is kept outside `raw/` and outside the manual-rubric adjudication file. It replaces the flagged-read fallback only for the named runs; an unknown run key fails the reproduction rather than being ignored. Without a sidecar, only reads explicitly marked `unnecessary` are counted.

`fixtures/reproduction/` is a synthetic committed raw set (five valid runs, two excluded) with its sidecar and expected outputs. CI verifies it with `--check`; it is not a benchmark result.

`docs/research/phase1-benchmark-protocol/v1/FROZEN.sha256` is the freeze record for protocol v1; any change to a listed artifact requires a new `v2/`.

## Pilot dry run (#57)

Issue #57 fixes the pilot at one repository × one task × one run per condition. Validate a proposed run manifest and materialize the deterministic trial plan without invoking a model or network:

```bash
pnpm research:benchmark-pilot-dry-run --manifest <run-manifest.json> --out <plan.json>
pnpm research:benchmark-pilot-dry-run --manifest <run-manifest.json> --out <plan.json> --check
```

The planner validates the manifest against the frozen schema, cross-checks all five repository pins, the 3 × 13 × 2 = 78 arithmetic, and the required budgets, then orders trials by `SHA-256(randomizationSeed, runKey)`. The default pilot is the first protocol repository and its first task at run index 0; `--repository`, `--task`, and `--index` select a different pilot. Selecting a manual-rubric task exercises the adjudication path.

`fixtures/pilot/` is a synthetic manifest and committed expected plan used by CI. It is not the #57 manifest; no model, client, environment, budget, or date is selected for the real pilot here.

### Run-manifest checklist for #57

Record every row in the manifest from the actual run plan before the first trial, and do not copy the synthetic fixture values. Fixed rows are copied verbatim; rows marked Open or Blocked record decisions or external input that have not been made yet. `validateRunManifestAgainstProtocol` rejects `REPLACE_WITH_` placeholders, the all-zero commit, stale repository pins, run-arithmetic drift, and missing, non-finite, or negative budgets.

| Field                      | Must record                                                                                                                                                                                                                                                                                   | Basis                                           | Status                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| `protocolVersion`          | `1`.                                                                                                                                                                                                                                                                                          | Schema constant                                 | Fixed by protocol            |
| `id`                       | A unique manifest id. Every raw run cites it as `runManifestId`, so never reuse a fixture id.                                                                                                                                                                                                 | Schema and raw-run records                      | Open                         |
| `createdAt`                | The actual UTC timestamp at which the manifest is frozen, before the first trial. The schema accepts optional fractional seconds. The template date is the protocol freeze date, not a run date.                                                                                              | `YYYY-MM-DDTHH:MM:SS[.fraction]Z`               | Open                         |
| `agentReadyCommit`         | Full 40-character lowercase hex commit SHA of the Agent-Ready artifact under test from the #64 release. Schema validation rejects a tag, branch, abbreviated SHA, or any other non-40-character-lowercase-hex value; the protocol cross-check separately rejects the all-zero template value. | Release #64                                     | Blocked on #64               |
| `model.id`                 | The evaluation model, identical in both conditions.                                                                                                                                                                                                                                           | Selected model                                  | Open                         |
| `model.configuration`      | The exact inference configuration recorded for the harness and used identically in both conditions (for example temperature and output-token limit), not assumed defaults.                                                                                                                    | Harness configuration                           | Open                         |
| `agentClient.name`         | The agent client used for both conditions.                                                                                                                                                                                                                                                    | Selected client                                 | Open                         |
| `agentClient.version`      | The exact client version, not a range.                                                                                                                                                                                                                                                        | Selected client                                 | Open                         |
| `environment.os`           | The actual OS or runner image used for every trial.                                                                                                                                                                                                                                           | Execution environment                           | Open                         |
| `environment.node`         | The exact Node.js version; the project requires `>= 20`.                                                                                                                                                                                                                                      | Execution environment                           | Open                         |
| `repositories[]`           | All five protocol repositories (`axios`, `jest`, `vite`, `lodash`, `nestjs`), each at the full commit in `repositories.json`. No substitutions, additions, or abbreviated SHAs.                                                                                                               | Frozen protocol v1                              | Fixed; planner rejects drift |
| `runs.perTaskPerCondition` | `3`.                                                                                                                                                                                                                                                                                          | Frozen protocol v1                              | Fixed                        |
| `runs.perCondition`        | `39`.                                                                                                                                                                                                                                                                                         | 13 tasks × 3 runs                               | Fixed                        |
| `runs.total`               | `78`.                                                                                                                                                                                                                                                                                         | 39 × 2 conditions                               | Fixed                        |
| `budgets.maxTotalTokens`   | The total token ceiling for the declared 78-trial run, as a finite non-negative number. The template's `0` is a placeholder, not an approved budget.                                                                                                                                          | Run budget decision; validator requires the key | Open                         |
| `budgets.maxTotalCostUsd`  | The total cost ceiling in USD for the declared 78-trial run, as a finite non-negative number. The template's `0` is a placeholder.                                                                                                                                                            | Run budget decision; validator requires the key | Open                         |
| `budgets.*` (additional)   | Any other pre-declared numeric allowance (finite and non-negative), such as spare budget for an infrastructure replacement. Replacement runs are off by default; the protocol allows one only when its budget was declared here.                                                              | Protocol infrastructure-failure rule; validator | Optional                     |
| `randomizationSeed`        | A non-empty seed fixed before the first trial. It determines the `SHA-256(seed, runKey)` trial order; changing it changes the plan.                                                                                                                                                           | Pilot planner                                   | Open                         |
| `notes`                    | Optional free text; use it to record context such as the #57 pilot scope and the #64 release.                                                                                                                                                                                                 | Schema                                          | Optional                     |

After the manifest is complete and no row remains Open or Blocked, validate it and materialize the plan before starting any trial:

```bash
pnpm research:benchmark-pilot-dry-run --manifest <run-manifest.json> --out <run-dir>/plan.json
```

Commit the manifest and plan, and do not mutate the manifest after the first trial starts.

Directory convention for future runs:

```text
raw/       immutable run logs
derived/   computed metrics (reproducible from raw)
report/    publication artifacts
```
