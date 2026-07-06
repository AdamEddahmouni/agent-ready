# ADR-0021: CLI/package maturity direction (Path A) and first command selection

## Status

Accepted.

## Context

v0.2.0 has shipped (Phase 10 complete — `agent-ready analyze`, ADR-0020).
ROADMAP.md's "Recommended next phase" called for a focused ADR choosing
between broader architecture-dependency analysis, task/context packets,
and framework-specific examples; ADR-0019 covered the first of those
candidates by selecting Phase 10 itself but did not commit the project
to it for the _next_ phase.

A separate candidate has been on the table since
[docs/project-standing.md](project-standing.md) and
[docs/implementation-scope-cli-package.md](implementation-scope-cli-package.md)
were written: a "CLI/package maturity" increment adding four
adoption-focused commands (`agent-ready init`, `doctor`, `explain`,
`schema`) without changing what the contract means. ROADMAP.md lists this
as "candidate next increment," not decided scope.

Adoption friction is the project's stated "natural next problem"
([docs/project-standing.md](project-standing.md)) — handing a maintainer
an empty file and a 1 MB schema is the section of the funnel the existing
six commands do not address. Path A is the smallest concrete
counter-measure: each new command is read-only (except `init`, which is
last), no contract-schema field changes, no diagnostic codes need
reservation, and the write path follows the same pattern
`agent-ready generate --write` already established.

## Alternatives considered

- **Pick one of ADR-0019's three Phase 11 candidates instead** —
  architecture-dependency analysis (extends `analyze` beyond Markdown
  links), task/context packets (a richer "handoff" data model sketched
  in [docs/specification/evidence.md](specification/evidence.md) and
  [config-evolution-draft.md](specification/config-evolution-draft.md)),
  or framework-specific examples. Each is a valid direction; none is the
  right next step now. Framework examples are useful adoption work but
  do not strengthen Agent-Ready's central "deterministic evidence"
  claim. Architecture-dependency analysis is a natural Phase 10 follow-on
  but has no validated check yet proven to have a low false-positive
  rate. Task/context packets expand the public data model before
  usage evidence exists about what a packet should contain — the
  exact risk called out in ADR-0019's consequences.
- **Defer the picking ADR entirely** and pick next when Phase 10's
  release review uncovers more evidence. Rejected — the existing
  release-review evidence already names adoption friction
  (`docs/project-standing.md`), and deferring keeps that user-facing cost
  on the table behind no concrete next deliverable.
- **Build all four CLI/package commands at once** as a single phase.
  Rejected — sequencing matters for the only command that writes
  (`init`): per [docs/implementation-scope-cli-package.md](implementation-scope-cli-package.md)
  it should ship last, behind the second-proven safe writer pattern.
  Bundling skips that discipline.
- **Path A; ship `agent-ready schema` first.** Selected. `schema` is
  the lowest-risk of the four — read-only, no environment inspection,
  no validation logic, just printing an already-bundled file
  ([schemas/v1/agent-ready.schema.json](../schemas/v1/agent-ready.schema.json))
  the package already exposes via its `./schema` export. The remaining
  three are sequenced as the proposal already specifies.

## Decision

Select Path A — the CLI/package maturity direction — as the next
increment.

The first command to ship is **`agent-ready schema`**: a read-only
command that prints the bundled JSON Schema (and identifies which
schema version it corresponds to) for tooling that wants it without a
source checkout. Concretely, it reads the same file already exposed at
`schemas/v1/agent-ready.schema.json` and the package's `./schema`
subpath export, prints it (or its version annotation) to stdout, and
exits.

Subsequent commands ship in this order, each behind its own ADR
following the per-command format
[docs/specification/cli-reference.md](specification/cli-reference.md)
already establishes for every existing command:

1. `agent-ready doctor` — read-only environment inspection
   (Node/runtime versions, `git` on `PATH`, declared
   `environment.runtimes`/`environment.packageManager`) reusing the
   `GitClient`/ext-`execFile` pattern ADR-0013 established. Agent-Ready-
   hardcoded argv only — exactly like `check`'s `git` invocations.
2. `agent-ready explain` — reuses the existing diagnostic-code
   registry; primarily a documentation/rendering exercise, not new
   validation logic.
3. `agent-ready init` — the only one that writes; a starter
   `agent-ready.yaml` scaffolder from repository inspection. Mirrors
   `generate --write`'s "refuse to overwrite without `--force`" pattern
   and `verify --execute`'s "default to dry run, require explicit opt
   in" posture. Sequenced last because it is the only second writer in
   the codebase and deserves a second proof point from `doctor`/`explain`
   before it ships.

This ADR does not, by itself, add code, alter the contract schema, or
reserve diagnostic codes. The implementation of each command lands
behind its own ADR-0021-followup, which will independently justify any
additive schema change within `version: 1` (per [ADR-0009](0009-pre-1.0-stability-policy.md))
if and only if one is genuinely needed. As scoped here, none of the
four commands requires a contract-schema addition.

## Consequences

- The next feature work has a concrete, narrowly-scoped first commit
  (`agent-ready schema`), reusable as a containing ADR for trivial
  follow-on (`doctor`, `explain`, `init`).
- Three subtler, larger commands are explicitly deferred behind their
  own ADRs — not bundled — preserving the per-command ADR discipline the
  project has maintained through Phase 10.
- The contract schema is unaffected by Path A as scoped here; the
  public data model does not grow on this increment.
- ROADMAP.md's "CLI/package maturity direction (proposed, not committed)"
  entry flips to "(selected — ADR-0021)." The `init`/`sync` entry in
  the strict non-goals list immediately below remains authoritative
  until a dedicated ADR for `init` reconsiders it on its own merits.
- The "Recommended next phase" section of ROADMAP.md stops describing
  v0.2.0 stabilization and the three-candidate Phase 11 picker as
  outstanding — v0.2.0 is released, the picking ADR exists, and the
  pick was Path A. The three ADR-0019 candidates remain valid future
  directions behind their own ADRs.

## Reconsideration trigger

Revisit this decision if:

- Real adoption-friction research identifies a different "first
  command on Path A" slicing than `agent-ready schema` — the proposal's
  sequencing recommendation is based on risk analysis, not usage
  evidence, because usage evidence for this project does not yet exist.
- A pre-1.0 stabilization pass (e.g. SHA-pinned GitHub Actions,
  publication-cut review, threat-model hardening of documented "known
  limitations") needs to occur before adding CLI surface is sensible.
- The proposed `agents:` / `quality_gates:` / `architecture:` /
  `handoff:` schema evolution in
  [config-evolution-draft.md](specification/config-evolution-draft.md)
  becomes a more binding blocker for adoption than CLI/package
  maturity — i.e. the missing key is _what the contract can say_, not
  _how to author what it can already say_.
