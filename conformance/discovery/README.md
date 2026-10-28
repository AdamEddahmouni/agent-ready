# Discovery snapshot conformance corpus

This directory holds **local, synthetic fixtures** that decide whether an
Agent-Ready build **behaves** like Discovery Snapshot Format 1, not merely whether
it emits JSON that validates.

## Two different passes

| Term | Meaning |
| ---- | ------- |
| **Schema-valid snapshot** | Parses and validates against [`schemas/discovery/snapshot-v1.schema.json`](../../schemas/discovery/snapshot-v1.schema.json). Necessary, not sufficient. |
| **Conforming implementation** | For every case in `v1/`, `discover --json` over the fixture produces **byte-identical** output to `expected.json`, and that output is schema-valid. |

Stability promises for consumers are in
[`docs/vnext/SNAPSHOT-STABILITY.md`](../../docs/vnext/SNAPSHOT-STABILITY.md).

## Layout

```text
conformance/discovery/v1/<case-name>/
  metadata.json     machine-readable case contract (required)
  repo/               fixture tree (no committed .git — tests add one in memory or in temp)
  expected.json       canonical snapshot bytes (required for check)
```

Future Format 2 would live in `v2/` as a sibling; each case’s `metadata.json`
must declare its `snapshotVersion`.

## Case status (`metadata.json`)

| `status` | Meaning |
| -------- | ------- |
| `normative` | Recorded output is **correct**; changing it is a deliberate compatibility decision. |
| `known-inaccurate` | Recorded output is **wrong on purpose** — pins a documented limitation. Conformance means the bug still reproduces until the limitation is **closed** in review, not fixed silently. Requires `knownLimitation` and `correctFutureBehaviour`. |
| `unsupported` | Proves an unsupported construct is **declined honestly**, not guessed. |

## Commands

From the repository root:

```bash
pnpm conformance:check    # read-only; CI runs this
pnpm conformance:update   # rewrite expected.json where bytes differ — maintainer only
```

**CI never runs `conformance:update`.** A green CI run means the implementation
matches committed expectations.

`conformance:update` is deterministic: running it twice on a clean tree should
produce **no diff**.

Both commands:

- use only fixtures under this directory;
- never use the network or clone third-party repositories;
- never require `node_modules` inside fixture repos.

`discover` itself remains read-only on fixture trees; the in-memory runner has no
write API.

## Adding a case

1. Create `v1/<name>/repo/` with the smallest tree that exercises one decision.
2. Add `metadata.json` (`name`, `purpose`, `exercises[]`, `snapshotVersion: 1`, `status`, …).
3. Run `pnpm conformance:update` and **review the diff** line by line.
4. Ask (per SNAPSHOT-STABILITY): did any **stable** field change? If yes, bump
   `snapshotVersion` instead of overwriting v1 expectations.
5. Ensure [`tests/integration/discoveryConformance.test.ts`](../../tests/integration/discoveryConformance.test.ts) still passes (it loads every case automatically).

## Reviewing expected-output changes

Before merging a changed `expected.json`:

1. Stable field or identity rule changed? → **`snapshotVersion` bump**, not a silent regen.
2. Known-inaccurate case changed? → Was the limitation **closed** intentionally?
3. Provisional-only change? → Regen is OK; note in PR.

Drift output from `conformance:check` names a JSON path — use it to locate the
semantic change.

## Normative authority

- Behaviour: this corpus + integration tests.
- Compatibility labels: SNAPSHOT-STABILITY + ADR-0048.
- Shape floor: published JSON Schema.
