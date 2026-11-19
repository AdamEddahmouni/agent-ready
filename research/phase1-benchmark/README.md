# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks the frozen protocol counts, task fields, oracles, decision-rule shape, run-manifest template, and freeze hashes
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics
- `aggregate.ts` — schema-validates raw runs, excludes infrastructure failures and forbidden actions, and computes the five predeclared summaries, sample variance, Wilson intervals, and per-task aggregates
- `report.ts` — validates that a report accounts for every raw run and renders deterministic JSON and Markdown with per-file SHA-256 checksums
- `adjudication.ts` — requires two reviewers for manual rubrics and a distinct third reviewer on disagreement; adjudications are stored in a separate sidecar file
- `capture.ts` — turns a saved client event log into Agent Transcript v1 (see below)

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

`tests/research/` exercises every oracle and forbidden-action class, a fake two-condition end-to-end run, the snapshot-only `twin query` guarantee, aggregation and Wilson arithmetic, all four decision outcomes, report completeness, and reviewer adjudication. `research:benchmark-test` runs the whole research test directory.

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
`harness/verificationSelection.ts`: the expected checks are the oracle's
`command-exit-zero` clauses plus any script named by `verificationSurface`
(`<manifest> scripts.<name>`), and a recorded shell call that runs one — under
any of `npm`, `pnpm`, `yarn` or `bun`, optionally inside a shell wrapper or a
`cd … &&` chain — sets the field to `true`. A task that declares no check
returns `undefined` and the recorded adjudication stands.

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

`docs/research/phase1-benchmark-protocol/v1/FROZEN.sha256` is the freeze record for protocol v1; any change to a listed artifact requires a new `v2/`.

Directory convention for future runs:

```text
raw/       immutable run logs
derived/   computed metrics (reproducible from raw)
report/    publication artifacts
```
