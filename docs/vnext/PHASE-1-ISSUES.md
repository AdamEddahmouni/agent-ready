# Phase 1 issue drafts: Repository Intelligence Kernel

Draft GitHub issue text for the first vNext implementation phase. These are
**drafts, not filed issues.** They exist so the maintainer can review the scope and
sequencing before anything is opened on the tracker.

Phase 1 is defined in [RFC-0001](RFC-0001-autonomous-software-evolution.md) and
[VISION.md §50](../../VISION.md). Its research question:

> Does a standardized repository model materially improve agent efficiency,
> correctness, and consistency compared with raw filesystem/shell access?

Phase 1 does not exit on "the commands work". It exits on an answer to that
question. Every issue below is written to produce evidence, not just capability.

## Sequencing and governance constraints

- Per [GOVERNANCE.md](../../GOVERNANCE.md), adding a command, schema field, or
  diagnostic code requires an ADR **before** implementation begins. Issue #1 is
  that ADR, and everything else is blocked on it.
- Per [ADR-0042](../decisions/0042-v1-freeze-and-parallel-vnext-surface.md), Phase
  1 adds new additive CLI surface only. The v1 contract, the eleven existing
  commands, and the adapter-output corpus are untouched.
- Per [ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md),
  Phase 1 is entirely offline. `discover` must work on a repository with no
  `agent-ready.yaml`, no network, and no API key. If any design proposal needs a
  network call, it belongs to a later phase.

---

## Issue #1 — Design ADR: repository model shape and the declared/derived boundary

**Labels:** `design`, `phase-1`, `blocked-by-nothing`

Phase 1 starts with a decision, not an implementation.

**Problem.** A "repository model" can mean many things, and the difference between a
useful snapshot and an unreadable data dump is decided entirely here. The RFC
already fixes one distinction — declared, derived, observed, and inferred facts must
never be conflated — but Phase 1 produces only the first two. Observed facts
require telemetry and inferred facts require analysis, and neither is in scope.

**Decide, in one ADR:**

- the smallest repository model that is still useful, and the specific evidence for
  excluding everything else;
- which fields are _derived_ (deterministic from the repository) versus _declared_
  (present in a file such as `package.json`, `CODEOWNERS`, or CI configuration),
  and how a snapshot marks the difference;
- whether an existing `agent-ready.yaml` may contribute facts, and if so, whether
  those facts are declared or merely author-declared;
- the snapshot's stability contract: what is versioned, what is explicitly
  unstable, and what a consumer may rely on in the first release;
- the false-positive policy. A snapshot that is confidently wrong about a
  repository's test command is worse than one that reports "unknown";
- CLI surface and diagnostic-code implications, including the reserved-code policy
  used by earlier commands.

**Non-goals.** No Twin, no transactions, no capability model, no MCP surface.

**Acceptance criteria.**

- The ADR is merged and every listed question has a recorded answer.
- The model contains no field whose derivation is not deterministic and testable
  from files present in the repository.
- A reviewer can restate the declared/derived rule in one sentence, and that
  sentence matches the schema.

---

## Issue #2 — `agent-ready discover` MVP

**Labels:** `enhancement`, `phase-1`, `blocked-by:#1`

The first wedge. It must create value on an arbitrary repository before anyone is
asked to adopt anything.

**Scope, TypeScript/Node only:**

- locate the repository root, using the same discovery semantics as the existing
  contract loader rather than a second, subtly different rule;
- detect package manager, workspaces, and package boundaries;
- read declared commands from `package.json` scripts and workspace manifests;
- detect test entry points and map them to their declaring package;
- map the build, lint, and typecheck commands a contributor would actually run;
- detect CI workflows and report what they run;
- emit a machine-readable snapshot on stdout, with a human-readable summary behind
  an explicit flag, following the existing dry-run-then-write discipline;
- operate on a repository with no `agent-ready.yaml`, and say so rather than
  failing.

**Explicit non-goals.** No writing files, no network, no `agent-ready.yaml`
mutation, no other language ecosystem, no ownership inference (issue #4), no MCP.

**Acceptance criteria.**

- Runs read-only on this repository and on at least five public TypeScript
  repositories, including one pnpm workspace monorepo.
- With no `agent-ready.yaml` present, it produces a snapshot and a clear note that
  no contract was found.
- No ambient network access; the whole command runs with networking disabled.
- Output shape is machine-readable and covered by the same JSON discipline as the
  existing commands, including a documented stability boundary.
- Running it twice on an unchanged repository produces byte-identical output.
- Diagnostics for "found nothing", "partially discovered", and "could not
  determine" are distinct. Silence is not an acceptable answer.

---

## Issue #3 — Repository graph and `twin query`

**Labels:** `enhancement`, `phase-1`, `blocked-by:#2`

A flat inventory helps an agent list files. It does not help an agent reason about
structure.

**Scope.**

- internal module edges derived from imports, resolved to packages;
- dependency edges from manifests and the lockfile, distinguishing declared from
  resolved versions;
- ownership edges from `CODEOWNERS`, with an explicit "unowned" state rather than
  a guess;
- `twin build` to write a snapshot to a path the user names;
- `twin query` to answer bounded structural questions without the agent writing
  bespoke traversal code.

**Design constraint to surface in the issue discussion.** The Twin is not a vector
store and not a transcript. Every node and edge carries the provenance of the fact
it encodes. If a fact cannot be traced to a file and a line, it does not enter the
graph.

**Acceptance criteria.**

- Every graph node and edge reports its source file, and the source is verifiable.
- Missing ownership is representable and is reported as missing.
- `twin query` answers are derived from the snapshot only; it never re-scans the
  repository behind the caller's back.
- A snapshot of this repository demonstrates the graph is wrong somewhere, and the
  discovered inaccuracy is fixed or explicitly documented as a known limitation.

---

## Issue #4 — Discovery accuracy and honest unknowns

**Labels:** `bug`, `phase-1`, `blocked-by:#2`

The failure mode of a repository model is confident error. This issue exists to
measure it rather than assume it.

**Scope.**

- a labelled accuracy set: for a set of public TypeScript/Node repositories, the
  correct answers for package manager, test command, build command, typecheck
  command, and CI coverage, established by hand;
- measurement of the model's accuracy per field, reported as counts rather than
  vibes;
- an explicit vocabulary for uncertainty, so "unknown" and "not applicable" and
  "detected but ambiguous" are distinguishable in the output;
- a documented policy for what happens when a heuristic is wrong: the snapshot says
  so, rather than presenting a guess.

**Acceptance criteria.**

- Per-field accuracy numbers exist and are published, including the failures.
- A wrong-but-confident field counts as a defect, not a near miss.
- Heuristics that cannot be made accurate enough to be trustworthy are removed
  rather than downgraded in confidence prose.

---

## Issue #5 — Evaluation harness: does the Twin actually help?

**Labels:** `research`, `phase-1`, `blocked-by:#2, #3`

The Phase 1 exit condition. Without this, Phase 1 produces a feature instead of an
answer.

**Scope.**

- a fixed task set over a fixed set of public TypeScript/Node repositories, small
  enough to run repeatedly and public enough to be reproduced;
- two conditions: the same agent with raw repository tools, and the same agent with
  the Twin;
- measures recorded per run: task success, invalid or reverted edits, files opened,
  commands run, verification choices, and wall-clock time;
- multiple runs per condition, with variance reported rather than a single
  best-of;
- the full methodology, task set, and results published, including null results.

**Design constraint.** The agent, the model, and the task set must be held constant
across both conditions. If the harness cannot hold them constant, that is reported as
a limitation on the result rather than papered over.

**Acceptance criteria.**

- Results are published with raw data, not just a conclusion.
- A null or negative result is a publishable outcome. The issue does not close
  because the Twin looked helpful.
- Token or step counts are reported, since "better" must be measurable rather than
  a matter of taste.

---

## Issue #6 — Snapshot format stability and first conformance check

**Labels:** `phase-1`, `blocked-by:#1`

Every compatibility promise this project has made came with a corpus and a
conformance story. The new surface needs the same treatment before anyone depends
on it, not after.

**Scope.**

- version the snapshot format independently of the `agent-ready.yaml` contract, per
  the version-taxonomy rule in
  [ADR-0040](../decisions/0040-release-and-version-taxonomy.md);
- publish a small conformance corpus: representative repositories with their
  expected snapshot output, including the known-inaccurate cases from issue #4;
- state plainly which snapshot fields a consumer may rely on in the first release
  and which are provisional;
- decide the compatibility policy for a format that is still learning its shape
  from Phase 1 experiments.

**Acceptance criteria.**

- A repository that conforms produces a snapshot that matches the corpus exactly.
- Known-inaccurate cases are in the corpus, so regressions in heuristics are
  detectable.
- The stability statement is written before the format is depended on externally,
  and is specific enough to fail a future change.

---

## Not filed, deliberately

- **Constitution.** Explicitly deferred to Phase 4. Authoring governance before
  real transactions exist produces governance for imagined work.
- **Capability model and identity.** Phase 5. Resolving it now would be a guess
  about a standard that does not exist yet.
- **MCP surface.** Worth an experimental spike, but any shipped MCP surface is an
  integration-layer capability under
  [ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md) and
  needs its own design ADR.
- **Monorepo restructuring.** The workspace layout in [VISION.md §37](../../VISION.md)
  is directional. A workspace conversion is not justified until there is a working
  implementation that needs one.

## Opening these

Nothing here is filed. When the maintainer is ready, the drafts above are the
starting text; each should be opened as a separate issue with the `blocked-by`
relationships intact, because the ordering is the point. Issue #1 must land first.
