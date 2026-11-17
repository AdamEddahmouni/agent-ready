# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks the frozen protocol counts, task fields, oracles, decision-rule shape, run-manifest template, and freeze hashes
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics

Raw run records validate against `schemas/research/phase1-benchmark-raw-run-v1.schema.json`. Run manifests start from `docs/research/phase1-benchmark-protocol/v1/run-manifest.template.json` and validate against `schemas/research/phase1-benchmark-run-manifest-v1.schema.json`.

`docs/research/phase1-benchmark-protocol/v1/FROZEN.sha256` is the freeze record for protocol v1; any change to a listed artifact requires a new `v2/`.

Directory convention for future runs:

```text
raw/       immutable run logs
derived/   computed metrics (reproducible from raw)
report/    publication artifacts
```
