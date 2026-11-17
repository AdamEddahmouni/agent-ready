# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks the frozen protocol counts, task fields, oracles, decision-rule shape, run-manifest template, and freeze hashes
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics
- `aggregate.ts` — schema-validates raw runs, excludes infrastructure failures and forbidden actions, and computes the five predeclared summaries, sample variance, Wilson intervals, and per-task aggregates
- `report.ts` — validates that a report accounts for every raw run and renders deterministic JSON and Markdown with per-file SHA-256 checksums
- `adjudication.ts` — requires two reviewers for manual rubrics and a distinct third reviewer on disagreement; adjudications are stored in a separate sidecar file
- `reproduce.ts` — one-command raw → derived → report reproduction

Raw run records validate against `schemas/research/phase1-benchmark-raw-run-v1.schema.json`. Run manifests start from `docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json` and validate against `schemas/research/phase1-benchmark-run-manifest-v1.schema.json`.

## Evaluation harness

`harness/` contains the typed, offline-testable stages:

- `prepare.ts` — fresh checkout per trial at the full pinned SHA, plus an agent-ready snapshot outside the checkout
- `run.ts` — identical prompt/model/config for both conditions; only the access descriptor differs
- `score.ts` — all six oracle types, post-hoc forbidden-action detection, and the partial-oracle timing metric
- `record.ts` — strict validation against the raw-run schema
- `fakeRunner.ts` — scripted runner for CI; no model, network, or subprocess calls

`tests/research/` exercises every oracle and forbidden-action class, a fake two-condition end-to-end run, the snapshot-only `twin query` guarantee, aggregation and Wilson arithmetic, all four decision outcomes, report completeness, and reviewer adjudication. `research:benchmark-test` runs the whole research test directory.

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
