# Reproduction fixture

Synthetic raw records only. This is **not** a Phase 1 benchmark result.

The seven schema-valid records contain five valid runs and two excluded runs
(one forbidden action, one infrastructure failure), cover both conditions, and
are paired with `adjudications.json` to exercise the post-hoc unnecessary-read
override. `derived/` and `report/` are committed outputs.

Regenerate and verify from the repository root:

```bash
pnpm research:benchmark-reproduce --raw research/phase1-benchmark/fixtures/reproduction/raw --out research/phase1-benchmark/fixtures/reproduction --adjudications research/phase1-benchmark/fixtures/reproduction/adjudications.json
pnpm research:benchmark-reproduce --raw research/phase1-benchmark/fixtures/reproduction/raw --out research/phase1-benchmark/fixtures/reproduction --adjudications research/phase1-benchmark/fixtures/reproduction/adjudications.json --check
```

CI runs the `--check` form, so a change to a raw record, the sidecar, or the
renderer without regenerating the outputs fails the benchmark-protocol job.
