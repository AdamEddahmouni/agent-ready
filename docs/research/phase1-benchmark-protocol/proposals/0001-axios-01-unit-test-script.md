# Proposal 0001 — `axios-01` asks for a script the prompt does not describe

**Status:** applied in [`v2/`](../v2/PROTOCOL.md) with option B, on 2026-11-19.
v1 stays frozen and byte-identical, per
[`PROTOCOL.md`](../v1/PROTOCOL.md) and [`FROZEN.sha256`](../v1/FROZEN.sha256)
("Any edit to a listed artifact requires protocol v2").

**Affected task:** `axios-01-identify-test-script` (repository `axios`, pin
`2426e03ba9020be31ed013873423cea6b7cd2e67`).

## Defect

The prompt asks:

> Without modifying the repository, identify the npm script name and exact
> command body used to run the project's unit tests on the root package. Reply
> with a JSON object of the form `{"script": "<name>", "body": "<body>"}` and
> nothing else.

The oracle is `response-json-path-equals` on `script` with value `"test"`.

At the pin, the root `package.json` has:

| script                | body                           |
| --------------------- | ------------------------------ |
| `test`                | `npm run test:vitest`          |
| `test:vitest`         | `vitest run`                   |
| `test:vitest:unit`    | `vitest run --project unit`    |
| `test:vitest:browser` | `vitest run --project browser` |

`test` is the aggregate entry point and runs **every** project, browser
included; it is not "the script used to run the project's unit tests". The
script that runs only the unit project is `test:vitest:unit`.

## Evidence

Two independent agent sessions, one per condition, both answered
`{"script":"test:vitest:unit","body":"vitest run --project unit"}`
(`runs/phase1-pilot-axios-01/`, raw checksum `81692bd5…`), as did the preflight
attempt (`runs/phase1-pilot-axios-01-preflight/`, `b13ea1ef…`). The offline
`agent-ready` session found the same answer through the snapshot's
`commands-for-package` query; the raw session found it with `rg` on
`package.json`. Four for four, from two model sessions and two different access
paths, says the reading is the natural one.

Under v1 both records are `success: false` for a task both agents answered
correctly. The task therefore measures instruction-following fidelity to an
oracle, not the structural knowledge it was written to measure.

## Options

**A — make the prompt name the entry point.** Rewrite to "the root package's
`test` script", leaving the oracle at `"test"`. Smallest edit, but it bakes in
an answer that contradicts the task's own subject: `test` delegates to
`vitest run`, which includes the browser projects. Any agent that reasons about
the repository's semantics is penalised for being right.

**B — fix the oracle and disambiguate the prompt.** Set the oracle value to
`test:vitest:unit` and add one clause to the prompt: "the script that runs only
the unit project, not the aggregate entry point." Scoring stays mechanical, the
expected answer is a real command at the pin, and the task keeps measuring
whether the agent can locate the unit-project script rather than the first
`test`-looking key.

**C — accept either answer.** Introduce an oracle type that matches one of a
set of names. This needs a new oracle type, schema, validator and aggregator
support — more surface than the defect warrants, and it records ambiguity
instead of resolving it.

**Recommendation: B.** It is one value plus one clause, keeps the mechanical
oracle, and makes the expected answer true of the repository.

## What it affects

Must change (in a new `v2/`, leaving v1 intact):

- `tasks.json` — the `axios-01` prompt and `/` or oracle value.
- `FROZEN.sha256` — a v2 freeze record over the v2 artifacts and the v2 schemas.
- Protocol plumbing that currently hardcodes version 1:
  `research/phase1-benchmark/validate-protocol.mjs` (v1 root and
  `FROZEN_PATHS`), `harness/manifest.ts` and `harness/record.ts`
  (`protocolVersion: 1`), `harness/protocol.ts` (loads v1),
  `schemas/research/phase1-benchmark-raw-run-v1.schema.json` and
  `…-run-manifest-v1.schema.json` (`"const": 1`), and any aggregation that
  groups by version.
- A new run manifest for the revision (fresh `id` and `createdAt`) and its
  digest lock, mirroring `docs/research/phase1-benchmark-run-v1/`.
- The CI `benchmark protocol` job, so v1 keeps validating while v2 is added.

Not affected:

- The 78-trial plan. Task count, condition count, seed, order, budgets,
  repositories and pins are unchanged, so the projected cost stays at ~6.1M
  input tokens, ~19.5k output, ~24 minutes.
- Adjudication load. `axios-01` stays mechanically scored, so the 48
  `manual-rubric` trials still need the same two blinded reviewers.
- Every non-`axios-01` task's scoring, and the `verificationSelectionResult`
  rule, which reads command oracles and not this task's response oracle.

Consequences to accept:

- **Prior records do not carry over.** v1 `axios-01` records say `false` for a
  correct answer; v2 records say `true`. They are separate protocol versions and
  must not be pooled in one aggregate. The pilot pair in this branch is
  v1 evidence and stays as written; a v2 pilot would rerun both conditions
  (~2 trials, 12–30 s, on the order of 60–160k input tokens).
- **The published finding in the run book describes v1.** It stays accurate for
  v1 and points here; after v2 lands it should say which version each figure
  belongs to.
- **`FROZEN.sha256`'s meaning is unchanged.** v1 keeps its record and results;
  v2 gets its own, so a reader can always tell which bytes produced which
  numbers.

## Applied in v2

1. `v1/` was copied to `v2/` and option B applied there.
2. Parameterise the validator, loader, record and manifest types on the version,
   and add `-v2` schemas.
3. Re-freeze v2, add a run manifest pinned to it, and point CI at both.
4. Rerun the `axios-01` pair and confirm `success: true` in both conditions,
   with the `axios-03` metrics unchanged.
