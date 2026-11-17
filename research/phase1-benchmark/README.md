# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks the frozen protocol counts, task fields, oracles, decision-rule shape, run-manifest template, and freeze hashes
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics

Raw run records validate against `schemas/research/phase1-benchmark-raw-run-v1.schema.json`. Run manifests start from `docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json` and validate against `schemas/research/phase1-benchmark-run-manifest-v1.schema.json`.

## Evaluation harness

`harness/` contains the typed, offline-testable stages:

- `prepare.ts` — fresh checkout per trial at the full pinned SHA, plus an agent-ready snapshot outside the checkout
- `run.ts` — identical prompt/model/config for both conditions; only the access descriptor differs
- `score.ts` — all six oracle types, post-hoc forbidden-action detection, and the partial-oracle timing metric
- `record.ts` — strict validation against the raw-run schema
- `fakeRunner.ts` — scripted runner for CI; no model, network, or subprocess calls

`tests/research/` exercises every oracle and forbidden-action class, a fake two-condition end-to-end run, and the snapshot-only `twin query` guarantee. `research:benchmark-test` runs the whole research test directory.

`docs/research/phase1-benchmark-protocol/v1/FROZEN.sha256` is the freeze record for protocol v1; any change to a listed artifact requires a new `v2/`.

Directory convention for future runs:

```text
raw/       immutable run logs
derived/   computed metrics (reproducible from raw)
report/    publication artifacts
```
