# Pilot dry-run fixture

`run-manifest.json` is a synthetic, schema-valid manifest for exercising the
dry-run planner. It is **not** the run manifest required by issue #57: the real
manifest must pin release #64 and the selected model, client, environment,
budgets, seed, and date before the first official trial.

`plan.json` is the committed expected plan for this fixture. Regenerate and
verify from the repository root:

```bash
pnpm research:benchmark-pilot-dry-run --manifest research/phase1-benchmark/fixtures/pilot/run-manifest.json --out research/phase1-benchmark/fixtures/pilot/plan.json
pnpm research:benchmark-pilot-dry-run --manifest research/phase1-benchmark/fixtures/pilot/run-manifest.json --out research/phase1-benchmark/fixtures/pilot/plan.json --check
```

CI runs the `--check` form. The planner never invokes a model, network, or
subprocess; it only validates the manifest and expands the predeclared trial
set into the seeded order.
