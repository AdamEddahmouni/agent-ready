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

## Environment checks already run

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

## Procedure for one pilot trial

1. `prepareConditionWorkspace` with the pin above and the condition. `raw` gets
   the checkout; `agent-ready` also gets `twin build` output outside the checkout.
2. Run the client once for the task's prompt with the condition's access, saving
   the raw `--json` stream.
3. `transcriptFromCodexStream` converts that log against the untouched checkout;
   `executeTrial` scores it with a real command executor and validates the raw
   record.
4. Write the record to the pilot run directory, then
   `pnpm research:benchmark-reproduce --raw <pilot>/raw --out <pilot>`.
5. Confirm the record validates, the report names every run, and the two
   conditions' observations differ only through access (same prompt, same config).

## What still blocks the 78 trials

1. **No trial orchestrator.** `executeTrial` is a library function and the only
   `AgentRunner` implementations are the scripted fake and the transcript
   replay. Nothing prepares a workspace, invokes `codex exec` for a trial,
   captures the log, scores it and writes a raw record; the seed above has no
   consumer yet.
2. **The `agent-ready` condition has no access wiring.** `AgentRunRequest.access`
   only carries booleans. No condition-specific tool description exists, and
   nothing exposes the snapshot path or `twin query` to the client, so a trial
   in that condition would silently be a second `raw` trial.
3. **The Agent-Ready pin is a SHA, not a release** (#64 open). The manifest
   records the SHA deliberately; publishing v0.7.0 afterwards cannot be
   retro-fitted into this manifest.
4. **48 of the 78 trials need human adjudication.** Eight tasks use
   `manual-rubric` (jest-01, jest-02, vite-01, vite-02, lodash-01, lodash-02,
   nestjs-01, nestjs-02): 8 × 3 runs × 2 conditions = 48 runs, each needing two
   blinded reviewers and a third on disagreement.
5. **Cost is a cap, not an estimate.** The manifest bounds spend in tokens and
   wall clock; a dollar figure needs the pilot's measured usage first.
