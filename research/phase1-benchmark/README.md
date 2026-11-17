# Phase 1 benchmark research tooling

Offline tooling for protocol v1. **Does not invoke models or run the benchmark.**

- `validate-protocol.mjs` — checks committed protocol JSON consistency
- `evaluate-decision.mjs` — applies `decision-rule.json` to aggregated metrics

Raw run records validate against `schemas/research/phase1-benchmark-raw-run-v1.schema.json`.

Directory convention for future runs:

```text
raw/       immutable run logs
derived/   computed metrics (reproducible from raw)
report/    publication artifacts
```
