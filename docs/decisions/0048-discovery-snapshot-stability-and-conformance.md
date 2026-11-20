# ADR-0048: Discovery snapshot stability and conformance

## Status

Accepted

Amends [ADR-0044](0044-repository-discovery-model.md) only where named under
[Amendments](#amendments). Builds on, and does not replace,
[ADR-0040](0040-release-and-version-taxonomy.md),
[ADR-0045](0045-package-and-workspace-discovery-semantics.md),
[ADR-0046](0046-command-and-verification-discovery-semantics.md) or
[ADR-0047](0047-provenance-carrying-repository-graph.md), all of which continue
to govern the model this record versions.

## Context

`agent-ready discover --json` has emitted a `snapshotVersion` since Issue #36.
That number was `0` and it meant exactly one thing: **nothing is promised**. Every
field was experimental, every shape could change, and no external consumer could
rely on any of it. That was the correct state for four issues of model-building,
and it is now the wrong state to stay in — but the way out is not "declare it
stable", because the snapshot's most expensive properties are exactly the ones
that have been exercised least.

The trap this record exists to avoid is stated in the issue:

> **Write JSON Schema for whatever the code happens to emit today.**

Doing that would produce a schema, a version number, and a document saying the
format is stable — and every one of the three would be a description of the
implementation rather than a decision about what other software may depend on.
Three of the fields most tempting to freeze (the source universe, the import
resolution vocabulary, the command role projection) turned out, on inspection, to
be the fields the reconnaissance could least defend.

So the work was ordered the other way round. Fifteen third-party
TypeScript/JavaScript repositories were cloned, pinned, and inspected with
`discover --json` and nothing else, **before** any field was classified. The
evidence is in
[the corpus study](../research/snapshot-v1-corpus-study.md). It found three
implementation defects that no synthetic fixture had reached — one of which
suppressed the entire graph for seven of the fifteen repositories — and it
separated the fields that survived contact with real code from the fields that
did not.

Those defects were fixed first, in the commit before this one. This record
therefore describes a model that has already been corrected by its own evidence,
which is the only order in which the word "stable" means anything.

## Alternatives considered

### One version, everything stable, corrections issued as patches

Rejected. The source universe admits committed `dist/` and generated `lib/`
trees by two independent routes, and the `require` story means a CommonJS
repository's import graph is a wall of `unsupported-syntax`. Freezing either
would be freezing a heuristic. A stability promise that has to be withdrawn is
worse than no promise, because a consumer will have built on it.

### Schema-validation-only stability

Rejected, and the distinction matters. "The output validates against the
schema" says nothing about whether the graph is _right_ — an implementation can
emit a structurally perfect, semantically fabricated graph. The corpus checks
behaviour; the schema checks shape. §10 defines both terms separately for this
reason.

### Generated schema from the TypeScript types

Rejected. A generator is a second source of truth that must be re-run on every
change, and the point of this record is that a schema change must be a _reviewed
decision_, not a side effect. The schema is hand-authored, and the drift guard
(§11) is a test rather than a build step. The cost is that the schema can go
stale, so the guard has to be real.

### A single "stable projection" as the only conformance surface

Considered seriously (§50–51 of the issue) and **partially adopted**: a stable
projection exists and is exercised by tests, but it is a compatibility _check_,
not the conformance comparison. The full snapshot is still compared byte for
byte, because a provisional field changing is information a consumer of this
repository wants, and hiding it behind a projection would have made the corpus
blind to exactly the drift it exists to catch.

### Bumping the contract version, or the npm version, alongside

Rejected by ADR-0040. The three axes are independent and this record touches
only one.

### Emitting both versions during a transition

Rejected for a format with no external consumers yet. There is nothing to
migrate; §16 records what happens when there is.

## Decision

### 1. What is versioned

The **shape and semantics of the JSON document written to stdout by
`agent-ready discover --json`**, and nothing else. Concretely:

- the set of top-level fields and their types;
- the discriminators and required properties of every nested object;
- the meaning of each field;
- the canonical form of the document — key order, array order, number and
  string form, and the repository-relative path convention.

Not versioned by this record: the human-readable `discover` output, the npm
package version, the `agent-ready.yaml` contract version, the diagnostic-code
registry, the adapter-output corpus version, or any persisted artefact. §15 and
§16 say why each of those is separate.

### 2. The first version number

**`snapshotVersion: 1`**, and `1` is the first version carrying a compatibility
promise. `DISCOVERY_SNAPSHOT_VERSION` moves from `0` to `1`.

`0` remains a real, recorded historical value: it is what #36 through #39
emitted, and the fixture that pinned it is still in this repository's history.
There is **no migration path from `0`** and no `0` schema is published, because
`0` promised nothing and there is therefore nothing to migrate _from_. A consumer
holding a `0` snapshot regenerates it; it does not convert it.

The name in prose is **Discovery Snapshot Format 1**. It is never called
"Agent-Ready v1", which is the npm version, and never "contract v1", which is
`agent-ready.yaml`.

### 3. What version 1 guarantees

For the fields listed in §5, and only those:

- the field is present wherever the model says it is, and is absent where the
  model says it is;
- its JSON type does not change;
- its meaning does not change;
- its canonical ordering, where ordering is canonical, does not change;
- a value produced by version 1 remains a value version 1 consumers understand,
  and the identities in it remain computable the same way.

Plus one guarantee that applies to the document as a whole:

> **Identical repository content and an identical Agent-Ready build produce
> byte-identical output.** Verified by the conformance corpus, which compares
> canonical bytes, and by the determinism tests that predate this record.

The inputs are repository content, the Agent-Ready build, and the supported Node
baseline. Checkout location, directory enumeration order, and install state are
_not_ inputs, and the corpus fails if any of them leaks in. A filesystem's own
path semantics (case sensitivity, realpath resolution) remain a property of that
filesystem, and the claim is scoped to a given checkout, not across exotic
filesystems.

### 4. What version 1 explicitly does not guarantee

- That discovery found everything. `summary.complete` and `graph.complete` are
  the honest answers to that, and both are read before anything else.
- That the model covers a construct it does not support. Unsupported constructs
  are reported, not modelled.
- That `graph.sourceUniverse.files` is the repository's source. It is a lower
  bound — see §6 and the study's finding D1.
- That human-readable `discover` output is unchanged in any way.
- Lifetime support. §17.

### 5. Stable in version 1

Stability is **field-specific**, never "the snapshot is stable except where
documented". The list below is what a consumer may build on. Everything not
listed is provisional by default — an unlisted field is provisional, not stable
by omission.

**Snapshot envelope**

| Field             | Guarantee                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `snapshotVersion` | Always present, always the integer `1` in this format.                                                   |
| `ok`              | Always `true` in a snapshot. A fatal discovery failure is a CLI error envelope, not a snapshot (§14).    |
| `root`            | Always `"."`. The repository-relative anchor for every path.                                             |
| `facts`           | Present, an object keyed by fact id, always including the key `id` equal to its own map key.             |
| `graph`           | Present. `null` only when the graph could not be built at all, and never standing in for an empty graph. |
| `summary`         | Present.                                                                                                 |
| `diagnostics`     | Present, possibly empty.                                                                                 |

**Fact model** — the most valuable guarantee in the format, and the one the
corpus exercises hardest

| Field                    | Guarantee                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `facts[].id`             | The fact's identity. Stable vocabulary; `repository.packageManager.<path>` is the only scoped form.                              |
| `facts[].kind`           | `"declared"`, `"derived"`, `"author-declared"`, or `"unknown"`. **Closed.**                                                      |
| `facts[].reason`         | Present iff `kind` is `"unknown"`. `"no-evidence"`, `"probe-failed"`, `"not-probed"`. **Closed.**                                |
| `facts[].value`          | Present iff the fact asserts one. Absent on `unknown` and on a conflict.                                                         |
| `facts[].claims[]`       | Every claim retained verbatim, never merged, never dropped.                                                                      |
| `facts[].corroboration`  | `kinds`, `authorDeclared`, `corroborated`; the meaning of `corroborated` is ADR-0045's "at least two claims support the value".  |
| `facts[].contradictedBy` | Present iff the fact is **incomplete**; never present otherwise. An incomplete fact carries a value, a conflicted fact does not. |
| `facts[].evidence[]`     | `source` is repository-relative; `pointer` and `detail` optional.                                                                |

**Package, workspace, and command values**

| Field                          | Guarantee                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package `path`                 | Canonical repository-relative directory; the package's identity, and never inferred from a name.                                                                        |
| `nameStatus`, `manifestStatus` | Membership is stable; the string unions are **closed** for `nameStatus` (`declared`/`absent`/`invalid`) and `manifestStatus` (`read`/`malformed`/`unreadable`).         |
| `scriptsStatus`                | **Closed**: `declared` / `absent` / `unsupported` / `unobservable`. The distinction between _known empty_ and _never observed_ is guaranteed and must not be collapsed. |
| `repository.commands`          | The **inventory**: every declared script, its verbatim body, and the package that declares it. Complete and unfiltered.                                                 |
| `PackageCommandsEntry`         | `packagePath`, `scriptsStatus`, `commands`, `unmodelledScripts`, `unsupportedReason` (`null` iff not unsupported).                                                      |

**Graph structure and provenance** — the container and the invariant, not the
heuristics inside it

| Field                                                     | Guarantee                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `graph.nodes` / `graph.edges`                             | Present; every entry carries `id`, `kind`, and `provenance`.                                                                                                             |
| `provenance.source`                                       | Always repository-relative, `/`-separated, never absolute, never escaping the root.                                                                                      |
| `provenance.line`                                         | Always present, always an integer, always **1-based**, always within the cited file.                                                                                     |
| `provenance.column` / `endLine` / `endColumn` / `pointer` | Optional, present when the parser produced them. Their _absence_ is meaningful and must not become presence.                                                             |
| `graph.sourceUniverse`                                    | Present, with `strategy`, `files`, `truncated`. The **contents** are provisional (§6); the container and the fact that it states how the universe was chosen are stable. |
| `graph.ownership`                                         | Present, with a `status`. The **pattern subset** is provisional (§6).                                                                                                    |
| `graph.complete`, `graph.truncatedBy`                     | Present. `complete: false` is always accompanied by a diagnostic.                                                                                                        |
| `ownership.status` on a node                              | The discriminated pair `owned` / `unowned` and the rule that an `unowned` node carries no owners. **Closed** — the shape is the guarantee.                               |
| resolved/unresolved edge invariants                       | A resolved edge carries a target; an unresolved edge carries a `reason` and no target. Enforced by the schema, not by convention.                                        |

**Summary and diagnostics**

| Field                    | Guarantee                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `summary.complete`       | Present. False means something was not established; it is never a quality judgement.                                         |
| `diagnostics[].code`     | A `DISCOVERY_*` code from the existing registry. **Stable vocabulary**; codes are not renamed or renumbered for this record. |
| `diagnostics[].severity` | Present. `error` is used for an Agent-Ready defect only.                                                                     |

### 6. Provisional in version 1

A provisional field is still **deterministic, still provenance-bearing, still
type-correct, and still schema-validated**. Provisional means _compatibility is
not promised_, not _unreliable_. For each entry below, what may change is stated
precisely, because "the graph is experimental" helps nobody.

| Domain                                                                    | What may change                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph.sourceUniverse.files`, `strategy`, `resolutionMode`, `extensions`  | The whole selection may change. Committed `dist/` and generated `lib/` enter the universe by two independent routes (study D1), and the honest fix — a documented exclusion rule with its own decision — has not been made. Treat the universe as a **lower bound**.                                                                                                                                                                  |
| `graph.nodes[].kind`, `graph.edges[].kind`                                | **Open enums.** A later phase will plausibly add `calls`, `exports`, or `owns`. Consumers must not exhaustively switch.                                                                                                                                                                                                                                                                                                               |
| Import `resolution.status`                                                | **Open**, and the vocabulary is young: `target-not-readable` was added by this issue.                                                                                                                                                                                                                                                                                                                                                 |
| `UnresolvedReason`                                                        | **Open.** Five of six values occurred in the corpus; the dominant real-world answer for CommonJS is currently `unsupported-syntax`, which is a statement about this version rather than about the repository.                                                                                                                                                                                                                         |
| `CommandRole`                                                             | **Open** in practice, and a deliberate consequence: `check`, `format`, `validate`, and `test-ci` are real verification surfaces the four-role grammar misses (study: 20 %–73 % of declared scripts get no role). The grammar is **not** broadened here — §9 measures, it does not mandate — so a future version may add roles. `repository.verificationEntrypoints[].role` is provisional; the `script` and `body` beside it are not. |
| `graph.ownership.unsupportedPatterns`, pattern breadth                    | The supported subset is documented, not validated by the corpus: no advanced-pattern repository was inspected. What is stable is that an unsupported rule is **surfaced and skipped**, never approximated.                                                                                                                                                                                                                            |
| Dependency `resolution.status` and `resolvedVersion` availability         | **Conditional per adapter.** pnpm and npm produce citable versions; Yarn and npm lockfile v1 produce `no-evidence` or `unsupported` by design. A consumer must branch on the status, never assume a version exists. The **declaration** shape is stable; its resolution is not.                                                                                                                                                       |
| `PackageNode` / `ModuleNode` identity strings                             | Readable and deterministic, but the _scheme_ is incidental to the current graph. Node ids may gain a disambiguating prefix; nothing may depend on their exact spelling.                                                                                                                                                                                                                                                               |
| `graph.counts`, `summary.facts`/`known`/`unknown`/`conflicts`             | Derivable from the arrays. Frozen redundancy buys a consumer nothing and costs a change per count.                                                                                                                                                                                                                                                                                                                                    |
| `diagnostics[].detail`, `remediation`, `metadata`, ordering, array length | Prose, metadata shape, and volume. One inspected repository emitted 216 diagnostics; another 64.                                                                                                                                                                                                                                                                                                                                      |
| `workspace`/`package` scope completeness                                  | A manifest outside every declaration is invisible. A `sample/*` tree in a workspace repository was invisible in the corpus. The boundary is deliberate and published; its _extent_ is provisional.                                                                                                                                                                                                                                    |

### 7. Enum policy

Chosen per enum, deliberately, and documented in the schema:

- **Closed** — adding a value is a breaking change requiring a version bump:
  `FactKind`, `UnknownReason`, `CommandRole` _as currently published_ (see the
  open/provisional note in §6), `ScriptsStatus`, `PackageNameStatus`,
  `ManifestStatus`, `DependencyClass`, `ImportSyntax`, `OwnershipSurfaceStatus`,
  `GraphItemEpistemic`.
- **Open** — a consumer must have a default branch: `GraphNodeKind`,
  `GraphEdgeKind`, `ImportResolution.status`, `UnresolvedReason`,
  `DependencyResolution.status`, `OwnershipState.status`, `OwnershipPolicy.status`,
  `InvocationStatus`, `WorkspaceDeclarationForm`, `ManifestStatus`-adjacent
  extension points.

Where an enum is open, the JSON Schema says so in its `description` and does not
constrain the value. Where it is closed, the schema enumerates it, so an
unrecognised value fails validation rather than passing silently. **A closed enum
that turns out to need a new value is a version bump; that is the cost of
closing it, and it was chosen for the fields a consumer will branch on.**

### 8. Array ordering

Three rules, all observable:

- **Canonical (stable).** Where ordering is part of the guarantee, arrays are
  sorted by code-unit comparison of a stated key, and a consumer may compare
  snapshots byte for byte. This covers `graph.nodes` (by `id`), `graph.edges` (by
  `(kind, source, target, provenance.line)`), `facts` keys, claims, evidence,
  `sourceUniverse.files`, `tsconfigs`, `extensions`, and `packageManager` scopes.
- **Declaration order (stable, and different).** Where the repository's own
  order _is_ the information, the array preserves it and must not be sorted:
  `workspace.declarations[].patterns` — a `!` exclusion only means something
  relative to the patterns around it.
- **Unspecified (provisional).** Everything else, including `claims` within a
  fact whose `kinds` overlap. Byte comparison still works because the order is
  deterministic; the order itself carries no promise.

### 9. Identity guarantees

- **Fact id** — from the fixed `FACT_IDS` vocabulary, or the
  `repository.packageManager.<scope>` template. Stable.
- **Package identity** — the canonical repository-relative path. Never the name,
  never a directory-naming inference. Stable.
- **Graph node id** — deterministic, checkout-independent, and hand-derivable
  (`package:packages/api`, `module:src/index.ts`, `dependency:ajv`,
  `owner:@org/platform`). _Values_ are provisional (§6); the _properties_ —
  deterministic, no UUID, no counter, no hash, no absolute path — are stable,
  because a consumer may key a cache on them.
- **Edge id** — provisional in spelling. It identifies one declaration site, not
  a conceptual property, and no consumer needs it.

### 10. Provenance guarantees

Stable, and the reason the corpus exists:

- every graph node and every graph edge has a `provenance` with a
  repository-relative `source` and a 1-based `line` that exists in that file;
- a citation into a file this run did not read is an **error**, and the graph is
  not published. This is not a preference: the study's first finding was a
  citation into a file nobody had opened, and it is the reason seven of fifteen
  repositories published no graph at all;
- a fact that asserts a value cites at least one claim with non-empty evidence;
- a `derived` fact citing more than its evidence budget is rejected.

`column`, `endLine` and `endColumn` are provisional: they are present when the
parser produced them and their absence is meaningful, but no consumer should
build a tool that breaks if one is added or removed.

### 11. Schema, and the drift guard

The schema is **hand-authored** at
`schemas/discovery/snapshot-v1.schema.json`, in its own directory so it can never
be confused with `schemas/v1/agent-ready.schema.json` (contract v1, frozen). One
schema per snapshot version; a version-2 schema would be a sibling directory.

Authored rather than generated, so that adding a field is a reviewed decision
rather than a build side effect. The cost is drift, so the guard is:

- every normative corpus case's expected snapshot must validate;
- the CLI's own `discover --json` output on this repository must validate;
- a set of **negative fixtures** — impossible states the TypeScript types already
  forbid — must fail, for the right reason;
- a canonical snapshot of Agent-Ready's own repository is kept as a golden
  stable-surface fixture.

Schema authority: the **schema describes the snapshot**, and the stability
document says which parts are promises. A provisional field is in the schema.
The schema never omits a field because it is provisional, and never encodes a
compatibility promise that the stability document does not make.

`snapshotVersion` vs schema revision: `snapshotVersion` tracks **semantic**
compatibility. Editorial changes to the schema file — descriptions, `title`,
`$comment`, ordering of keys in the schema document — do not require a new
snapshot version when they neither accept nor reject a different set of
snapshots. A schema change that alters which snapshots validate is a semantic
change and requires review against §13.

### 12. `additionalProperties`, per object

Not defaulted, and not uniform:

- **Stable, closed objects** — the snapshot envelope, a fact, `Evidence`, a
  `CommandEntry`, a `DependencyDeclaration`, `SourceLocation`, `Corroboration` —
  are `additionalProperties: false`. A consumer writing a strict parser should
  not be defeated by a typo, and there is no extension point here that needs
  one.
- **Open containers** — a fact's `value`, `diagnostics[].metadata`,
  `diagnostics[].remediation`, and the `UnsupportedPattern.reason` free text are
  open, because they carry repository-supplied or human-supplied content whose
  shape is not Agent-Ready's to constrain.
- **Nested domain objects reachable only through an open value** are described
  structurally where they are stable (`PackageEntry`, `WorkspaceDeclarationEntry`,
  `PackageCommandsEntry`, `VerificationEntrypointEntry`) and left to the fact
  value's own schema where they are not.

### 13. What is a breaking change, and what is not

**Breaking — requires a new `snapshotVersion`:**

- removing a field listed as stable in §5, or making a stable field optional;
- renaming a stable field, or changing its JSON type;
- changing the _meaning_ of a stable field, even with the same name and type;
- changing a **closed** enum (§7) by adding, removing, or renaming a value;
- changing how a stable identity is constructed — a fact id, a package path, the
  node-id properties of §9;
- changing a canonical ordering rule for a canonically-ordered array, in a way
  that changes the bytes a conforming implementation produces;
- changing what `kind`, `reason`, or `contradictedBy` _mean_ — the epistemic
  discriminators are the core of the format;
- making a previously-valid snapshot invalid, or an invalid one valid, where the
  shape is a stable one;
- adding a field to a stable object that is `additionalProperties: false` in a
  way a strict consumer could not ignore.

**Not breaking — a conforming implementation may ship it under version 1:**

- adding a **provisional** field, anywhere;
- adding a value to an **open** enum (§7);
- adding a new diagnostic code, or a new `metadata` key;
- adding a new `UnknownReason`-shaped condition that still maps to an existing
  reason;
- fixing an implementation defect that changes output, **provided** no stable
  field's meaning changes — and this is why the corpus review rule in §18 exists:
  a drift in a provisional field is invisible to a consumer, and a drift in a
  stable field is a bug that must be caught before release;
- editorial schema changes that do not change which snapshots validate.

### 14. Two interfaces, not one

`discover --json` has two failure shapes and only one of them is a snapshot:

- **success** → a snapshot document, which this record versions;
- **fatal failure** (no readable repository root) → a CLI error envelope
  `{"ok": false, "diagnostics": [...]}` on stdout, plus a non-zero exit.

The error envelope is **not** Snapshot Format 1, is not described by its schema,
and is not covered by any promise here. It exists because a consumer needs
_something_ parseable, and because the same `ok` discriminator is the cheapest
possible test. Mixing the two into one schema would have meant promising the
shape of a failure path nobody has designed.

The human-readable `discover` output is likewise not Snapshot Format 1. Terminal
formatting, column widths, truncation, and ordering will change freely, and
§7's stability claims do not reach it. The one thing the corpus _does_ pin is
that the machine JSON carries the verbatim declaration where the terminal
elides it — a display limit must never become a model limit.

### 15. Independence from the other version axes

ADR-0040 established that these are separate identifiers, and this record
depends on that:

| Axis                        | Value               | Effect of this record                                                                                                                                          |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-ready.yaml` contract | `1`, **frozen**     | **None.** `schemas/v1/agent-ready.schema.json` is untouched; no snapshot field is added to it; `agent-ready.yaml` never validates against the snapshot schema. |
| npm package                 | `0.x`               | **None.** Snapshot Format 1 may exist while the package is `0.6.x`. No npm release is cut by this record.                                                      |
| Adapter-output corpus       | `adapter-output/v1` | **None.**                                                                                                                                                      |
| Discovery snapshot          | `1`                 | Set here, for the first time, to a value that promises something.                                                                                              |

A breaking snapshot change may land in a **pre-1.0 minor** release, because the
npm version and the snapshot version are different axes and SemVer does not
override ADR-0040. This is stated here so the next maintainer does not read
"pre-1.0" as "nothing is stable".

### 16. Future versions

- One schema per version, in its own directory:
  `schemas/discovery/snapshot-v1/`, `snapshot-v2/`, and so on.
- The CLI emits the **latest** version. No `--snapshot-version` flag, no `Accept`
  header, no negotiation: there is exactly one stable version, and adding a
  negotiation protocol before a second version exists would be building for a
  problem that has not happened.
- A version-2 corpus is a sibling directory, `conformance/discovery/v2/`.
- **Support policy:** an implementation that claims to emit version _N_ must
  pass `conformance/discovery/vN`. Whether an implementation must _continue_ to
  emit older versions is a release-time decision, not a format one; the default
  is that it need not, because the format has no negotiation and a consumer
  reading `snapshotVersion` can tell what it has.

### 17. Pre-1.0 compatibility, honestly stated

Version 1 is a real promise and this project is not at 1.0. Both are true, and
the resolution is scope rather than hedging:

- **Promised:** the §5 list, for the lifetime of version 1.
- **Not promised:** that version 1 will exist forever. A future version 2 may
  break it, and the cost of that is stated in §13 rather than left implicit.
- **Not promised:** a maintenance SLA, a deprecation window, or a response time
  for a breaking change. This project is pre-1.0 and single-maintainer;
  ADR-0009's per-surface policy governs, and this record adds to it rather than
  replacing it.
- **Promised:** that a breaking change will be a **decision with a recorded
  reason**, not a refactor. That is what §13 is for.

### 18. Conformance

Defined precisely, because "conforms to Snapshot Format 1" is otherwise
ambiguous:

- a **schema-valid snapshot** is a document that validates against
  `schemas/discovery/snapshot-v1.schema.json`. This is a statement about shape
  and is not sufficient: an implementation can emit a structurally perfect,
  semantically fabricated graph.
- a **conforming implementation** is one that, for every normative case in
  `conformance/discovery/v1/`, produces the recorded expected snapshot
  byte-for-byte, and whose output validates against the schema. This is a
  statement about behaviour.
- a **known-inaccurate case** is one where the recorded output is _wrong on
  purpose_ — it pins a limitation the project knows about. Conformance means
  the implementation still produces it, and the case must stay visible in the
  corpus output. It does **not** mean correct.

**Review rule, and the most important sentence in this record:**

> Any change to an expected output requires reviewing whether a **stable** field
> changed, and therefore whether `snapshotVersion` must be bumped.

A developer who regenerates the corpus to make CI green has made a decision, and
this rule exists so they cannot make it by accident.

`conformance:check` runs discovery and compares. `conformance:update` rewrites
the expected files and is a conscious maintainer action that is **never** run in
CI. Neither touches the network, and no case clones anything.

### 19. Schema validation is the floor, not the ceiling

Every one of these must validate, and each is in the test suite:

- a canonical real snapshot;
- a snapshot with an `unknown` fact, a `conflicted` fact, an `incomplete` fact,
  an unresolved import edge, a `no-evidence` dependency, and an explicitly
  `unowned` subject — a schema that only describes happy repositories is not a
  schema for this format;
- **negative** fixtures that must be rejected: an unknown fact carrying a
  `value`, a known fact with no evidence, an absolute `provenance.source`, a
  `snapshotVersion` other than `1`, a resolved edge with no target, an unresolved
  edge with a target, an `unowned` node with owners, a provenance line of `0`.

The TypeScript types already make most of these impossible; the schema exists so
that a **non-TypeScript** consumer gets the same protection from the published
artifact rather than from having to trust that we did our job.

### 20. What remains explicitly experimental

Named here so "experimental" cannot quietly become "stable by silence":

- the human-readable `discover` rendering;
- the whole `graph.sourceUniverse` selection heuristic;
- the CODEOWNERS pattern subset beyond what §5 stabilises;
- CommonJS `require` support, and every resolver form this version declines;
- anything at all about persistence, querying, and evaluation — Issues #41 and
  #42, neither of which is constrained by this record.

## Amendments

1. **`snapshotVersion` becomes `1`.** `DISCOVERY_SNAPSHOT_VERSION` in
   `src/discover/types.ts` moves from `0` to `1`, and the comment attached to it
   is rewritten to state what `1` promises rather than what `0` denied. No
   snapshot field is added, removed, or renamed by this record.
2. **`UnresolvedReason` gains `target-not-readable`.** Additive, and forced by
   the study's first finding: a resolved target outside the module universe must
   be read before it is cited, and one that cannot be is reported as unresolved
   with a reason of its own rather than given a fabricated line 1. Recorded here
   because it is a snapshot-visible vocabulary change, made in the same window
   in which such changes are cheap.
3. **ADR-0047's source-universe reconsideration trigger is answered.** The
   trigger asked whether committed build output in the fallback walk is "a rare
   theoretical edge case or common enough to invalidate stability". The answer is
   **common enough**, and the trigger's framing was too narrow: it is not only
   the fallback walk — a `tsconfig.json` that states no `files` and no `include`
   reproduces TypeScript's own `**/*` default and admits generated trees just as
   well (webpack: 640 of 765 modules in a committed, generated `lib/`). The
   response taken here is **not** a new exclusion heuristic: `graph.sourceUniverse`
   is marked provisional, `files` is documented as a lower bound, and the corpus
   carries a known-inaccurate case that pins the behaviour so a future fix is a
   deliberate act rather than a silent improvement.
4. **ADR-0047 §12's `require` reconsideration trigger is answered.** The trigger
   asked about `require` in `.ts` files; the corpus shows it overwhelmingly in
   `.js` files (express 402/402 unresolved, webpack 3 249/3 258, undici
   2 839/2 871). The trigger is therefore **not** met in the form it was written,
   and is superseded by the finding that the CommonJS case is the larger and less
   explicable one. Import resolution is provisional; no resolver work is done here.
5. **The diagnostic registry is unchanged.** No `DISCOVERY_*` code is added,
   renamed, or renumbered. `DISCOVERY_GRAPH_PROVENANCE_INVALID` already covers
   the defect the study found, and already said the right thing about it.
6. **The webpack half of amendment 3's evidence was a misreading.** The pinned
   `tsconfig.json` at `e95be18b4651` explicitly lists `lib/**/*.js` in `include`
   (with `allowJs`/`checkJs`, `noEmit`), so its 640 modules in `lib/` are a
   **declared** TypeScript program, not a default-`**/*` accident. Excluding that
   tree would silently narrow a universe the repository named. The corpus now
   pins the inclusion as correct behaviour in the normative case
   `declared-include-admits-generated-tree`; the fallback-walk limitation in
   `known-inaccurate-fallback-source-universe` is the only remaining route, and
   amendment 3's decision (no exclusion heuristic; `sourceUniverse` provisional,
   `files` a lower bound) stands unchanged.

## Consequences

- Another tool can now write a parser against a **named, small** subset and know
  that the subset will not move under it: the envelope, the epistemic
  discriminators, evidence and provenance, package identity, the command
  inventory, and the graph's structural invariants. Everything else is declared
  provisional, precisely, so a consumer knows which parts are promises.
- The promise is **smaller than the implementation**, deliberately. The three
  most interesting domains — the source universe, the import resolver, and the
  verification role projection — are provisional, and each carries a written
  reason. That is the intended shape of this record: the interesting parts are
  the ones with the least evidence behind them.
- A consumer can tell the difference between "Agent-Ready says this" and
  "Agent-Ready could not find out", which is the property the whole fact model
  was built for and the one most worth protecting through a version number.
- A known-inaccurate behaviour is now a **committed, visible, machine-marked**
  artefact rather than a footnote. A future fix changes CI output, which forces
  a human to decide whether a limitation is closed and whether a compatibility
  classification moves with it.
- The cost is real: three defects had to be fixed before this record could be
  written honestly, and one of them meant seven of fifteen real repositories were
  publishing **no graph at all**. "Stable" would have been a lie in every one of
  those runs. Stability is only worth declaring after the corpus says the thing
  is true, and that ordering is now the project's practice rather than a habit.

## Reconsideration trigger

Reconsider this record when **any** of the following happens, and not before:

- the corpus grows a case whose drift is in a **stable** field, which means the
  stable set is wrong rather than the implementation;
- a second snapshot version is proposed, which makes §16's negotiation question
  real rather than hypothetical;
- CommonJS `require` is modelled, which would move the import resolution
  vocabulary and probably a third of §6;
- the source universe gains a documented exclusion rule, which would let
  `graph.sourceUniverse` be considered for stability;
- the verification role grammar is broadened, which would make `CommandRole` a
  closed enum that is actually closed;
- an external consumer appears, which is the first thing that would make the
  §17 support policy worth writing down properly.
