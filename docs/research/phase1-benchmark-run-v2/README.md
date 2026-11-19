# Phase 1 benchmark run, protocol v2

The run manifest for protocol v2, and the second committed environment the trial
runner executes inside. It supersedes
[the v1 run](../phase1-benchmark-run-v1/README.md), whose records keep citing
that manifest's id and stay valid.

| Field              | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Manifest id        | `phase1-v2-2026-11-19`                                               |
| Protocol           | v2 (`docs/research/phase1-benchmark-protocol/v2/`)                   |
| Model              | `gpt-6.2-sol` via `codex-cli` 0.166.0, `codex exec --json`           |
| Environment        | Ubuntu 24.04.5, Node 26.13.0                                         |
| agent-ready commit | `2a0515e1f01af61d1379dfe8149b30227769d533`                           |
| Size               | 3 runs per task per condition — 39 per condition, 78 in total        |
| Budgets            | 20,000,000 tokens, 2,880 minutes, one infrastructure retry per trial |
| Seed               | `phase1-v1-2026-11-19-codex-gpt-6.2-sol-8f3c1a`                      |
| Digest             | [`run-manifest.sha256`](run-manifest.sha256)                         |

## What v2 changes

Only one task, per [proposal 0001](../phase1-benchmark-protocol/proposals/0001-axios-01-unit-test-script.md):
`axios-01-identify-test-script` now asks for the script that runs only the unit
project and scores `test:vitest:unit`. Under v1 it asked for "the unit tests"
but scored the aggregate `test` script, which at the pinned axios commit also
runs the browser projects, so both conditions failed it with a correct answer.

Everything else is identical to v1: the same five repository pins, thirteen
tasks, three runs per task per condition, decision rule, budgets (re-argued in
this manifest's `notes`), and the same randomization seed. Reusing the seed is
deliberate — the 78-trial order is the same as v1's, so the two versions can be
compared trial for trial instead of through different shuffles.

## Records do not cross versions

A raw record carries the protocol version it was scored under, and the runner
writes the manifest's version. Aggregation refuses a directory that mixes
versions rather than blending two frozen oracles into one number, and
`research:benchmark-reproduce` picks the decision rule of the version the
records cite. v1 records stay in `runs/` untouched.

## Pilot

`runs/phase1-pilot-v2-axios-01/` — `axios-01`, run 0, both conditions, through
the verified v2 CLI build:

|               | raw                    | agent-ready            |
| ------------- | ---------------------- | ---------------------- |
| Success       | **yes**                | **yes**                |
| Input tokens  | 55,469 (41,216 cached) | 55,974 (39,040 cached) |
| Output tokens | 74                     | 103                    |
| Twin queries  | 0                      | 2                      |
| Wall clock    | 9 s                    | 10 s                   |

Both records are `protocolVersion: 2`, the report reproduces from their bytes
(raw checksum `b279ff90…`), and the task success rate is 100% per condition
against the v1 pairs' 0%.

## Cost

The measured cost model is unchanged, because v2 changes one oracle value and
no task, timeout, or budget: **~6.1M input + ~19.5k output tokens** and
**~24 minutes** for 78 trials, which is 31% of the token cap and 1% of the time
cap. Dollars remain a sensitivity, since the repository records no prices:
~$0.39 / ~$1.93 / ~$22 at (input / cached / output) of $0.25/$0.025/$2,
$1.25/$0.125/$10, and $15/$1.50/$60 per 1M.

## Known limitation carried into v2

`verificationSelectionResult` is derived from the task's `command-exit-zero`
clauses, and `axios-01` has none — it is scored from the response JSON. A task
with no check to run therefore records `false`, and the report's
"verification failure rate" reads 100% for it even though nothing failed to
verify. The metric is fail-closed by design; treating "not applicable" as a
separate state is a protocol question for a future revision, not something to
silently reinterpret here.
