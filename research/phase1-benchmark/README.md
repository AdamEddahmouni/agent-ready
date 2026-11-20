# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks the frozen protocol counts, task fields, oracles, decision-rule shape, run-manifest template, and freeze hashes
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics
- `aggregate.ts` — schema-validates raw runs, excludes infrastructure failures and forbidden actions, and computes the five predeclared summaries, sample variance, Wilson intervals, and per-task aggregates
- `report.ts` — validates that a report accounts for every raw run and renders deterministic JSON and Markdown with per-file SHA-256 checksums
- `adjudication.ts` — requires two reviewers for manual rubrics and a distinct third reviewer on disagreement; also parses the separate post-hoc unnecessary-read sidecar
- `run-manifest.ts` — schema-validates a run manifest and cross-checks its repository pins, run arithmetic, and budgets against protocol v1
- `pilot.ts` — deterministic pilot/full-run dry-run planner from a validated manifest and its randomization seed
- `reproduce.ts` — one-command raw → derived → report reproduction

Raw run records validate against `schemas/research/phase1-benchmark-raw-run-v1.schema.json`. Run manifests start from `docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json` and validate against `schemas/research/phase1-benchmark-run-manifest-v1.schema.json`.

## Evaluation harness

`harness/` contains the typed, offline-testable stages:

- `prepare.ts` — fresh checkout per trial at the full pinned SHA, plus an agent-ready snapshot outside the checkout
- `run.ts` — identical prompt/model/config for both conditions; only the access descriptor differs
- `score.ts` — all six oracle types, post-hoc forbidden-action detection, and the partial-oracle timing metric
- `record.ts` — strict validation against the raw-run schema
- `fakeRunner.ts` — scripted runner for CI; no model, network, or subprocess calls

`tests/research/` exercises every oracle and forbidden-action class, a fake two-condition end-to-end run, the snapshot-only `twin query` guarantee, aggregation and Wilson arithmetic, all four decision outcomes, report completeness, reviewer adjudication, the unnecessary-read sidecar, run-manifest validation, and the pilot plan. `research:benchmark-test` runs the whole research test directory.

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

`fixtures/pilot/` is a synthetic manifest and committed expected plan used by CI. It is not the #57 manifest: the real manifest must pin release #64 and the selected model, client, environment, budgets, and date before the first official trial.

Directory convention for future runs:

```text
raw/       immutable run logs
derived/   computed metrics (reproducible from raw)
report/    publication artifacts
```
