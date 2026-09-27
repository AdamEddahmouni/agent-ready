# Phase 1: Repository Intelligence — issue set

Phase 1 is defined in [RFC-0001](RFC-0001-autonomous-software-evolution.md) and
[VISION.md §50](../../VISION.md). This document records the issue set and the
order it must be worked in.

## The falsifiable thesis for Phase 1

> **Can Agent-Ready construct a useful, deterministic machine model of an arbitrary
> TypeScript/Node repository without requiring the maintainer to manually describe
> that repository?**

If the answer is no, the project should learn that before building anything on top
of the model. The cost of finding out late is the entire control plane.

## Architectural order

```text
DISCOVER   raw repository  ->  deterministic facts
MODEL      facts           ->  normalized Repository Model
QUERY      Repository Model ->  stable machine interface
EVALUATE   does an agent actually do better with it?

only then: EVOLUTION, TRANSACTION, PROOF, CONSTITUTION
```

Each stage is worthless without the previous one being true. A query interface over
an unmeasured model measures nothing.

## Explicit non-goals for the whole phase

Not in Phase 1, in any issue, at any point:

- embeddings, vector stores, or semantic search;
- LLM-based repository analysis;
- production telemetry or runtime observation;
- System Twin persistence or a stored graph database;
- agent orchestration, capability models, or identity;
- Claude/Codex integration or any agent invocation;
- monorepo restructuring or a workspace conversion.

If a change requires any of the above, it belongs to a later phase and needs its own
decision.

## Standing constraints

- [GOVERNANCE.md](../../GOVERNANCE.md) requires an ADR before adding a command,
  schema field, or diagnostic code. The design decision comes first; the issues
  below are sequenced so that decision is made explicitly and early.
- [ADR-0042](../decisions/0042-v1-freeze-and-parallel-vnext-surface.md): Phase 1
  adds new additive CLI surface only. The v1 contract, the eleven shipped commands,
  and the adapter-output corpus are untouched.
- [ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md): Phase 1
  is entirely offline. Every command must work with networking disabled, no API key,
  and no `agent-ready.yaml` present.

## Dependency chain

Work strictly in this order. Each issue is the narrowest executable slice that
leaves the next one unblocked.

```text
#1 Repository discovery model
       ↓
#2 Package/workspace discovery
       ↓
#3 Commands + verification discovery
       ↓
#4 Module/dependency graph
       ↓
#5 Stable JSON snapshot/schema
       ↓
#6 Experimental query interface + evaluation harness

#7 Phase 1 benchmark protocol — defined BEFORE #6 runs, not after
```

---

### Issue #1 — Repository discovery model

**Status**: implemented. Recorded in
[ADR-0044](../decisions/0044-repository-discovery-model.md).

**Depends on:** nothing. **Blocks**: #2.

The first wedge. It must produce value on an arbitrary repository before anyone is
asked to adopt anything.

**Deliverable.** `agent-ready discover --json` emitting a deterministic snapshot.
Initially: repository identity, languages/runtime, package manager, and the presence
or absence of a declaration surface. No guessing beyond what is directly readable.

**Decisions this issue must record in its ADR.**

- What the repository model is, in the smallest form that is still useful.
- Which fields are **declared** (present in a file such as `package.json`,
  `CODEOWNERS`, or CI configuration) versus **derived** (determined
  deterministically from repository content), and how a snapshot marks the
  difference. Never conflate them.
- Whether an existing `agent-ready.yaml` may contribute facts, and if so, whether
  those facts are declared or merely author-declared.
- The false-positive policy: a snapshot confidently wrong about a repository is
  worse than one reporting "unknown".
- CLI surface and diagnostic-code implications, including the reserved-code policy
  used by earlier commands.

**Non-goals.** Packages, workspaces, commands, graphs. No writing. No network.

**Acceptance criteria.**

- Runs read-only with networking disabled, on a repository with no
  `agent-ready.yaml`, and says clearly that no contract was found.
- Running it twice on an unchanged repository produces byte-identical output.
- Every field is traceable to a file and line, or is explicitly marked unknown.
- "Found nothing", "partially discovered", and "could not determine" produce
  distinct diagnostics. Silence is not an acceptable answer.
- No field is present whose derivation is not deterministic and testable.

---

### Issue #2 — Package and workspace discovery

**Status**: implemented. Recorded in
[ADR-0045](../decisions/0045-package-and-workspace-discovery-semantics.md).

**Depends on:** #1. **Blocks**: #3, #4.

**Deliverable.** Package boundaries, workspace roots, and the package manager,
derived from the workspace configuration and the manifests themselves.

**Acceptance criteria.**

- A pnpm workspace monorepo, an npm workspace monorepo, and a single-package
  repository are each classified correctly.
- Package identity comes from the manifest, not from directory naming convention.
- Internal versus external dependency is distinguishable at this stage, even though
  the full graph is #4.
- An unrecognized workspace layout is reported as unrecognized, not coerced into a
  shape that happens to fit.

---

### Issue #3 — Commands and verification discovery

**Status**: implemented. Recorded in
[ADR-0046](../decisions/0046-command-and-verification-discovery-semantics.md).

**Depends on:** #2. **Blocks**: #4, #6.

**Deliverable.** Declared commands, test entry points, and the build, lint, and
typecheck commands a contributor would actually run — plus which verification
surface already exists.

**Acceptance criteria.**

- Commands are reported with the package that declares them.
- A test command is distinguished from a build command, and a script that runs
  neither is not silently reported as either.
- The output answers "how do I verify this?" for a package without asking a human.
- Heuristics that cannot be made accurate enough to be trustworthy are removed
  rather than shipped with a confidence disclaimer.

---

### Issue #4 — Module and dependency graph

**Depends on:** #2, #3. **Blocks**: #5.

**Deliverable.** Internal module edges derived from imports and resolved to
packages; dependency edges from manifests and the lockfile, distinguishing declared
from resolved versions; ownership edges from `CODEOWNERS` with an explicit "unowned"
state rather than a guess.

**Design constraint.** Every node and edge carries the provenance of the fact it
encodes. If a fact cannot be traced to a file and a line, it does not enter the
graph. Missing ownership must be representable and reported as missing.

**Acceptance criteria.**

- Every edge reports its source file, and the source is verifiable.
- A graph built from this repository demonstrably has a defect, and the defect is
  either fixed or documented as a known limitation.
- Import resolution failures are surfaced, not swallowed.

**Status.** Shipped as GitHub
[#39](https://github.com/AdamEddahmouni/agent-ready/issues/39), decided in
[ADR-0047](../decisions/0047-provenance-carrying-repository-graph.md). The graph
is a top-level `graph` field on the `discover` snapshot rather than a fact, so
`FACT_IDS` is unchanged. Dogfooding on this repository found three implementation
defects (the root path `"."` never resolving to the root, a three-character
declaration extension being sliced wrong, and a trailing newline counting as an
extra line against the validator's range check), all fixed, plus one repository
condition published rather than repaired: ten declared `devDependencies` that no
module imports. Unresolved imports and unowned subjects are each represented
explicitly, and the graph is not persisted and has no command of its own.

---

### Issue #5 — Stable JSON snapshot and schema

**Depends on:** #4. **Blocks**: #6.

**Deliverable.** The snapshot format versioned independently of the `agent-ready.yaml`
contract, per the version-taxonomy rule in
[ADR-0040](../decisions/0040-release-and-version-taxonomy.md), with a small
conformance corpus.

**Acceptance criteria.**

- A published statement of which snapshot fields a consumer may rely on in the
  first release and which are provisional.
- A conformance corpus of representative repositories with their expected output,
  **including the known-inaccurate cases**, so heuristic regressions are detectable.
- The stability statement is written before any external consumer depends on the
  format, and is specific enough to fail a future change.

---

### Issue #6 — Experimental query interface and evaluation harness

**Depends on:** #3, #5, **and the protocol in #7**.

**Deliverable.** `twin build` writes a snapshot to a path the user names; `twin
query` answers bounded structural questions from the snapshot alone, never
re-scanning the repository behind the caller's back. Then run the evaluation
required by #7.

**Acceptance criteria.**

- Query answers are derived from the snapshot only.
- The evaluation is run with the protocol agreed in #7, unchanged, and published
  with its raw data.
- A null or negative result is a publishable outcome. The issue does not close
  because the model looked helpful.

---

### Issue #7 — Phase 1 benchmark protocol

**Depends on:** nothing, and must be agreed **before** #6 runs. **Blocks**: #6.

The easiest issue to defer and the one that most determines whether Phase 1
produces an answer or a feature. Agreeing the protocol after the model exists
invites metrics chosen because they flatter it.

**Deliverable.** A written, published protocol for comparing:

```text
raw filesystem + shell
vs.
Agent-Ready repository model
```

on the same tasks, with the same model, in the same environment.

**Metrics.**

- task success
- unnecessary file reads
- tool calls
- tokens
- invalid assumptions (statements about the repository that turn out false)
- incorrect dependency reasoning
- verification selection (did it run the right checks)
- time to first correct modification

**Protocol requirements.**

- A fixed, public task set over a fixed set of public TypeScript/Node repositories.
- The model, agent configuration, and task set are held constant across both
  conditions. If they cannot be held constant, that is reported as a limitation on
  the result rather than papered over.
- Multiple runs per condition, with variance reported rather than a single best-of.
- Raw data published, not only a conclusion.
- A pre-declared decision rule: what result counts as "the model helps", stated
  before the run.

**Acceptance criteria.**

- The protocol is merged and immutable before the first evaluation run.
- Any later change to it is a new protocol version, with the original results kept.
- Null results are publishable and expected.

---

## Not filed in Phase 1

- **Constitution.** Explicitly deferred to Phase 4. Governance written before real
  transactions exist is governance for imagined work.
- **Capability model and identity.** Phase 5. Resolving it now would be guessing at
  a standard that does not exist yet.
- **MCP surface.** Any shipped MCP surface is an integration-layer capability under
  [ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md) and needs
  its own design ADR, not an implementation ticket.
- **Monorepo restructuring.** The workspace layout in [VISION.md §37](../../VISION.md)
  is directional. A conversion is not justified until a working implementation
  needs one.
