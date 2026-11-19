# Phase 1 run v1 — frozen environment

The run manifest for protocol v1 lives here and nowhere else:

| Artifact                                     | Purpose                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`run-manifest.json`](run-manifest.json)     | Pins model, client, environment, Agent-Ready commit, repository commits, run arithmetic, budgets and seed. Parity with the schema in [`schemas/research/phase1-benchmark-run-manifest-v1.schema.json`](../../../schemas/research/phase1-benchmark-run-manifest-v1.schema.json). |
| [`run-manifest.sha256`](run-manifest.sha256) | The digest frozen at commit time. `tests/research/phase1BenchmarkRunManifest.test.ts` fails if the manifest bytes change without a deliberate re-freeze.                                                                                                                        |

Raw records, derived metrics and the report for this run go in their own directory and cite `runManifestId: "phase1-v1-2026-11-19"`:

```text
raw/       immutable run logs (one JSON document per trial)
derived/   metrics computed from raw/ only
report/    publication artifacts
```

Pilot trials are stored under their own run directory with the same id. They are
published separately and are excluded from the 78-trial results.

## What is frozen

| Field            | Value                                                                                     | Source                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol         | `1`                                                                                       | [`docs/research/phase1-benchmark-protocol/v1`](../phase1-benchmark-protocol/v1/PROTOCOL.md)                                                    |
| Model            | `gpt-6.2-sol`                                                                             | The two committed captures ([`captures/`](../../../research/phase1-benchmark/captures/README.md))                                              |
| Agent client     | `codex-cli` 0.166.0, `codex exec --json`, `--sandbox workspace-write`                     | Same                                                                                                                                           |
| Environment      | Ubuntu 24.04.5 LTS (Linux 6.1.102 x86_64), Node 26.13.0                                   | Measured on the machine the captures ran on                                                                                                    |
| Agent-Ready code | `2a0515e1f01af61d1379dfe8149b30227769d533` (main)                                         | Stands in for the v0.7.0 tag, which does not exist yet (#64)                                                                                   |
| Repositories     | The five pins in [`repositories.json`](../phase1-benchmark-protocol/v1/repositories.json) | Copied verbatim; the test rejects any drift                                                                                                    |
| Runs             | 3 per task per condition → 39 per condition → 78 total                                    | Protocol v1 arithmetic                                                                                                                         |
| Seed             | `phase1-v1-2026-11-19-codex-gpt-6.2-sol-8f3c1a`                                           | Recorded; consumed by the trial scheduler                                                                                                      |
| Budgets          | 20,000,000 total tokens, 2,880 wall-clock minutes, 1 infrastructure retry per trial       | Token cap ≈ 2.8× the 78 × 92,038 implied by the largest measured session; wall clock = 2× the 6 × 240 minutes the declared task timeouts imply |

Every value above is either read from a frozen artifact, measured, or derived
from measurements; none is a placeholder. `temperature` and `maxOutputTokens`
are `null` because `codex exec --json` has no flag for either.

## Checkout, snapshot and oracle checks

`prepareWorkspace` (fresh clone at the pinned SHA, detached) and `TwinSnapshotBuilder`
(`twin build`) on the two pilot candidates:

| Repository | Pinned commit   | Checkout + snapshot | Snapshot bytes |
| ---------- | --------------- | ------------------- | -------------- |
| axios      | `2426e03b…2e67` | ~2 s                | 823,541        |
| nestjs     | `b58554ea…3a4`  | ~3 s                | 4,206,654      |

The five `command-exit-zero` clauses in the protocol run `npm run <script>` where
the script is an inline `node -e`, so no `node_modules` install is needed for
oracle evaluation. Both captured sessions report usage through
`turn.completed`, so `tokenMetrics` is available rather than `null`.

## Pilot matrix

1 repository × 1 task × 1 run per condition, per the protocol's pilot rule
(pilot runs are not protocol results):

| Field         | Value                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository    | `axios` at `2426e03ba9020be31ed013873423cea6b7cd2e67`                                                                                                                                                                                                                     |
| Task          | `axios-03-add-sponsor-data-check` (edit-and-verify, `all-of` oracle, 20 min timeout)                                                                                                                                                                                      |
| Runs          | `runIndex: 0` for `raw` and for `agent-ready`                                                                                                                                                                                                                             |
| Why this pair | It is the only task whose oracle both edits a file and runs a command, so the pilot exercises the write path, the `command-exit-zero` clause and the oracle aggregation in one trial. A real session for it is already committed, so the pilot has a known-good baseline. |

## Pilot results (2026-11-19)

Two task pairs, one run per condition each, all from the committed manifest. The
report for every pair is stored beside its records and reproduces with
`--check`.

### Snapshot access is used

`axios-01-identify-test-script` is a pure structure question — which npm script
runs the unit tests — so it is the task that should make the treatment reach for
the snapshot. `runs/phase1-pilot-axios-01/`:

|               | raw                             | agent-ready                           |
| ------------- | ------------------------------- | ------------------------------------- |
| Success       | no                              | no                                    |
| Input tokens  | 35,854 (31,488 cached)          | 56,288 (45,440 cached)                |
| Output tokens | 58                              | 121                                   |
| Twin queries  | 0 (`rg` against `package.json`) | **2** (`--kind commands-for-package`) |
| Wall clock    | 6 s                             | 12 s                                  |

Both runs answered `{"script":"test:vitest:unit","body":"vitest run --project unit"}`
and the oracle wants `script == "test"`. The repository at the pin has
`test: "npm run test:vitest"` and `test:vitest:unit: "vitest run --project unit"`,
so the prompt's "unit tests" and the oracle's `test` disagree. That is task
data to settle in a protocol revision, not a harness fault, and it fails
identically in both conditions so the pair stays comparable. It is recorded here
rather than edited, because the protocol is frozen with a digest lock. The
correction was drafted in
[`proposals/0001-axios-01-unit-test-script.md`](../phase1-benchmark-protocol/proposals/0001-axios-01-unit-test-script.md)
and is applied in [protocol v2](../phase1-benchmark-protocol/v2/PROTOCOL.md).

The first attempt at this pair is kept at
`runs/phase1-pilot-axios-01-preflight/`: the treatment made three queries, the
first failing because the description never said that
`commands-for-package` needs `--parameter`, then read `--help`, then bypassed
the wrapper by passing its own `--snapshot`. Both gaps are closed: the
description now points at `--help` for each kind's form, and the wrapper refuses
`--snapshot` (either spelling, exit 2) so the trial's artifact is fixed.

### Steering the description

The agent-ready description now names repository-structure questions — package
sets, a package's scripts, module layout, imports, ownership — and says to call
the query first. The effect is visible on a task that is not a structure
question: on the axios-03 recheck below the treatment made three queries where
the original pair made none, and its input tokens rose accordingly.

### Verification selection is measured, not assumed

`verificationSelectionResult` used to come only from adjudication, so it
defaulted to `false` and a run that executed the task's own check was reported
as a verification failure. It is now derived from the task's own
`command-exit-zero` clauses: a recorded shell call that runs one satisfies the
metric. A script merely named in `verificationSurface` does not count — the
surface says where an answer lives, not what the agent must run, and otherwise a
read-only task would score as verified for running `npm test`. Tasks with no
command clause keep the recorded value.

`runs/phase1-pilot-axios-03-recheck/` runs the same task and conditions as the
earlier pair, which is kept untouched as pre-fix evidence:

|                               | raw                    | agent-ready              |
| ----------------------------- | ---------------------- | ------------------------ |
| Success                       | yes                    | yes                      |
| Input tokens                  | 92,114 (68,864 cached) | 159,363 (143,872 cached) |
| Output tokens                 | 294                    | 509                      |
| Twin queries                  | 0                      | 3                        |
| Wall clock                    | 17 s                   | 28 s                     |
| `verificationSelectionResult` | **true** (was false)   | **true** (was false)     |
| Verification failure rate     | **0.0%** (was 100.0%)  | **0.0%** (was 100.0%)    |

### Full-run cost estimate

Measured over the six fresh pilot trials (three pairs, including one 159k-token
run): mean 78,836 input and 250 output tokens per trial, of which 86% of input
is reported as cached. The manifest's 78 trials therefore project to:

- **~6.1M input tokens** (median-based ~5.0M; observed range 35.9k–159.4k per
  trial) and **~19.5k output tokens**, about 31% of the 20M-token cap;
- **~24 minutes** of client wall clock at ~14 s per trial plus ~4 s of checkout
  and snapshot per trial, far under the 2,880-minute cap.

Dollar cost needs the model's prices, which this repository does not record, so
it is given as a sensitivity rather than a number:

| assumed price per 1M (input / cached / output) | full-run cost |
| ---------------------------------------------- | ------------- |
| \$0.25 / \$0.025 / \$2                         | ~\$0.39       |
| \$1.25 / \$0.125 / \$10                        | ~\$1.93       |
| \$15 / \$1.50 / \$60                           | ~\$22         |

These are projections from six single runs of two tasks. The 48 `manual-rubric`
trials may read more than a two-file edit does, and one pilot run was 2.7× the
mean, so treat the token figure as ±50% until a wider pilot lands.

## Running a trial

One command per run. It prepares a fresh checkout at the pinned SHA, builds the
snapshot for the `agent-ready` condition, runs `codex exec --json` once per trial,
saves the client log and transcript, scores through `executeTrial`, and writes
one schema-valid record to `raw/`:

```bash
pnpm research:benchmark-build-agent-ready   # once: builds the pinned commit
pnpm research:benchmark-run --out runs/pilot \
  --task axios-03-add-sponsor-data-check --runs 1
pnpm research:benchmark-reproduce --raw runs/pilot/raw --out runs/pilot
```

The run resumes by skipping trials that already have a record (`--force`
re-runs), retries an infrastructure failure once, stops at the manifest's token
or wall-clock cap, and refuses to run an `agent-ready` trial without snapshot
access rather than silently recording a second raw trial. The CLI itself is
verified against the pinned commit (`--build-agent-ready` builds it, otherwise a
stamp of `agentReadyCommit` and a clean tree are required), because the artifact
under test is the pinned code, not whatever `dist/` is on the machine.

`--dry-run` executes the full 78-trial order with a scripted runner and no
model: it writes under `<out>/dry-run` citing `phase1-v1-2026-11-19-dry-run`, so
those records cannot be confused with protocol results.

## Environment checks already run

| Check                          | Result                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeded plan                    | 78 trials, 39 per condition, identical for the same seed and a permutation for another                                                                                |
| Dry run end to end             | 78 records written and validated, then reproduced into `derived/metrics.json` and both report files                                                                   |
| Live runner against a real log | The committed axios-03 session replayed through the spawner: 54,211 input / 251 output tokens, measured (not sequence-derived) event timing, log byte-count preserved |
| Twin wrapper                   | Built CLI answers `summary` (`13 facts, 7 known, 6 unknown`) and `packages` from the snapshot when called from inside the checkout                                    |
| Snapshot build                 | axios 823,541 B in ~2 s, nestjs 4,206,654 B in ~3 s                                                                                                                   |

## What still blocks the 78 trials

1. **The Agent-Ready pin is a SHA, not a release** (#64 open). The manifest
   records the SHA deliberately; publishing v0.7.0 afterwards cannot be
   retro-fitted into this manifest.
2. **48 of the 78 trials need human adjudication.** Eight tasks use
   `manual-rubric` (jest-01, jest-02, vite-01, vite-02, lodash-01, lodash-02,
   nestjs-01, nestjs-02): 8 × 3 runs × 2 conditions = 48 runs, each needing two
   blinded reviewers and a third on disagreement, scored through the
   adjudication sidecar rather than the raw log.
3. **Cost is a cap, not an estimate.** The manifest bounds tokens and wall clock;
   a dollar figure needs the pilot's measured usage first.
4. **Client quota is unproven at 78 trials.** Two pilot sessions completed in
   32 s, but sustained rate limits, per-trial login expiry and the wall-clock
   cost of five repository checkouts per pass remain unmeasured at scale.
