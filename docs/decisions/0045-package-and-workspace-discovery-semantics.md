# ADR-0045: Package and workspace discovery semantics

## Status

Accepted

Amends [ADR-0044](0044-repository-discovery-model.md) in the three places
named under [Amendments to ADR-0044](#amendments-to-adr-0044). Everything else in
ADR-0044 stands.

## Context

[ADR-0044](0044-repository-discovery-model.md) built the discovery substrate and
deliberately shipped a four-fact vocabulary. Its own closing note anticipated this
issue:

> Reconsider the read budget when package discovery lands, since the bounded
> root-level probe set must then become a bounded but recursive walk. That change
> alters the determinism argument and needs its own decision.

That is the decision this record makes. Everything below is a semantic choice —
what a package _is_, what a workspace _is_, what a package manager _is_ — that a
future contributor could not reconstruct from the code alone.

The domain is genuinely messy, and the messiness is the point. The following are
all real repositories, not hypotheticals:

```text
package.json says pnpm          package-lock.json exists
pnpm-lock.yaml and yarn.lock    workspace declares packages/a; packages/a has no package.json
packages/b/package.json exists  but no workspace declaration includes it
root manifest is malformed      workspace glob matches an unreadable directory
agent-ready.yaml claims npm     repository evidence indicates pnpm
nested package declares another package manager
```

ADR-0044's governing rule — _unknown beats wrong_ — survives all of these, but only
if the vocabulary can express them. Four questions had to be answered before any
code, because each one is a choice between defensible alternatives:

1. **Fact identity.** Issue #36's `FACT_IDS` is a fixed string union and
   `facts` is a `Record<string, Fact>`. Issue #37's domain has many entities — many
   packages, many patterns, many claims. A fact id per package is unbounded; one
   opaque blob per collection loses the per-item evidence that is the entire point
   of the substrate.
2. **Merge semantics.** `mergeContributions` groups by fact id and decides
   agreement by **JSON equality of the whole value**. A value-shaped fact fed by two
   probes that observe _different subsets_ of the same concept would be reported as
   a contradiction. Two packages each declaring a manager is not a contradiction;
   two probes each listing half the manifests is not agreement either.
3. **Corroboration independence.** `describeCorroboration` counts distinct
   _claim keys_, where a claim key is its kind plus its **first** evidence entry.
   Package-manager signals are naturally multi-file (a lockfile, and a declaration
   naming it), so a claim legitimately carries several evidence entries. Under the
   #36 rule those collapse to one key — which is right for a single claim, and
   wrong for the question this issue actually asks.
4. **The read budget.** #36 read a fixed set of root-level paths and did not walk
   the tree. Expansion of a declared pattern such as `packages/*` cannot happen
   without enumerating directories, and the shared `FileSystem` boundary has no
   directory-listing capability at all.

## Alternatives considered

### Fact identity

- **One fact id per package** — `repository.package["packages/a"]`. Rejected as
  unbounded: the static `FactId` type is a feature, because it is what makes the
  vocabulary reviewable, and an id that is generated from repository content cannot
  be reviewed. It also destroys the type-level guarantee that every id is a
  conceptual property.
- **One opaque blob per collection** — `repository.packages: [<everything>]`.
  Rejected for the reason the substrate exists: a claim that cannot cite its own
  source is a fabricated claim, and a blob makes per-item provenance impossible to
  enforce. The failure boundary would also be all-or-nothing, which is exactly the
  collapse the prompt and ADR-0044 both forbid.
- **A fixed id per conceptual property, with evidence arrays and typed value
  shapes carrying per-item provenance.** Chosen. The vocabulary stays finite and
  reviewable, per-item evidence stays addressable, and a failure boundary can be as
  small as the unreadable path.

### Merge semantics

- **Leave `buildAgreedFact` untouched and make every collection fact single-owner.**
  Simpler, and it does not produce _false_ conflicts — it produces **false
  agreement**: two probes each contributing half a collection to the same id would
  produce two `unknown`s where the truth is "one known collection". Chosen instead:
  keep one owner per collection fact, so the ambiguity never arises, _and_ tighten
  the merge so a disagreement is described as a disagreement rather than as a
  difference nobody can act on.
- **Give each fact a `comparator` or `strategy` describing how claims combine**
  (union, intersection, set-merge). Rejected for now: the only case that actually
  needs it is package-manager claims, and it can be given an explicit, named,
  tested rule without a general mechanism. Adding a pluggable combinator now is
  speculative generality for one caller.

### Corroboration independence

- **Leave the first-evidence rule alone.** Rejected: it makes a three-way lockfile
  conflict — the single most important scenario in this issue — report
  `corroborated: false` for every fact, because each claim's first evidence entry is
  the one file it cited. The field would carry no information at all in exactly the
  domain it was built for.
- **Count every evidence entry as an independent source.** Rejected as worse: it is
  the failure ADR-0044's note explicitly warns about — "a repeated citation is not
  additional support". A claim that looked in four lockfiles made one assertion.
- **One claim is one source; a fact is corroborated when two _claims_ exist,
  whatever they cite.** Chosen, and narrowed by an explicit budget rule below.

### The read budget

- **Enumerate the whole tree looking for manifests.** Rejected: unbounded work
  proportional to repository size, and it would make discovery's cost unpredictable
  on exactly the large repositories where an agent needs it most.
- **Follow declarations only, never enumerate.** Rejected: it cannot answer "which
  package manifests exist on disk", which is a required question, and it would let
  an undeclared package vanish silently.
- **Bounded enumeration.** Chosen. The rule is stated below and is a code constant
  rather than configuration, so it cannot be tuned per repository.

## Decision

### 1. Fact identity is a conceptual property; entities live in typed values

`FACT_IDS` grows to a fixed, reviewable union. No id is generated from repository
content, and no id names an individual package:

```text
repository.root
repository.contract.present
repository.contract.valid
repository.declarationSurface.present
repository.packageManager.root
repository.packageManager.<manifestPath>
repository.packages
repository.workspace.declarations
repository.workspace.candidates
repository.workspace.members
repository.workspace.root
```

`repository.packageManager.<manifestPath>` is a deliberate, bounded departure from
"one id per conceptual property": the identity of a package manager is genuinely
_per manifest_, and flattening nested declarations into one repository-wide answer is
the specific defect this issue exists to prevent (see §3). It is still safe because
it is a **template over paths that discovery itself derived from bounded reads**,
not an open-ended key space, and the suffix is a normalized repository-relative path
rather than a repository-supplied identifier.

Entity identity within a collection fact is carried by the value, not the id. Every
collection is an array of objects with a `path` field, sorted by code-unit order on
`path`, so a consumer addresses an entity by a value it can re-derive. This is the
smallest design that supports many packages, supports future graph relationships
(paths compose into edges in [#39](https://github.com/AdamEddahmouni/agent-ready/issues/39)),
keeps `FactId` finite, and does not lose per-entity evidence — because evidence is
addressed by path rather than being flattened into a single string.

### 2. A fact is known, contradicted, or incomplete — and all three are stated

A conflict is no longer modelled only as "two claims, no value". A value-shaped fact
may be **incomplete**: the evidence is sufficient to assert something, and also
insufficient to assert it fully. Package-manager evidence is the motivating case —
when `package.json` names pnpm and `package-lock.json` exists, the honest answer is
not "unknown" (a value _was_ observed) and not "npm" (nothing said that). It is:

> a pnpm-specific artifact exists, a declaration names pnpm, and another
> manager-specific artifact also exists. These cannot be reduced to one manager.

Three new diagnostic codes are required and one is retained:

| Code                              | Severity | Meaning                                                                                                                                             |
| --------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCOVERY_FACT_INCOMPLETE`       | warning  | Evidence is sufficient for a partial assertion and insufficient for a complete one. No winner is chosen.                                            |
| `DISCOVERY_WORKSPACE_UNSUPPORTED` | warning  | A workspace declaration exists in a form this implementation does not model. It is not guessed at.                                                  |
| `DISCOVERY_FACT_UNSUPPORTED`      | warning  | Now reachable. A package fact exists that this implementation does not support — a `packageManager` field in a form that is not `<name>@<version>`. |
| `DISCOVERY_LOCKFILE_UNREADABLE`   | warning  | A lockfile path could not be inspected, so its existence is not reported as evidence for that manager.                                              |

The severity column is `warning` for all four, and that is not a free choice.
[ADR-0008](0008-diagnostics-and-exit-codes.md) fixes the shared `Severity` type at
exactly `"error" | "warning"`, the set of codes emitted as warnings is declared once
in `WARNING_DIAGNOSTIC_CODES`, and `agent-ready explain` derives the severity it
prints from that same list. There is therefore no `info` to emit. An earlier
draft of this table called `DISCOVERY_FACT_UNSUPPORTED` informational; that was
carried over from ADR-0044's table, which does the same for two codes, and it
could not have been implemented. The registry — not this table — is the single
source of severity truth, and the table is corrected to match it. None of these
codes changes an exit code either way.

`DISCOVERY_PARTIAL` continues to mean what it meant in ADR-0044 — _a probe could not
complete_ — and is not stretched to cover incompleteness. `DISCOVERY_FACT_CONFLICT`
keeps its ADR-0044 meaning: two sources assert **different values for the same
identity**. The three-lockfile case is a conflict under that definition, because npm
and pnpm are different values; the "no value" representation is kept for maximum
fidelity.

`DISCOVERY_LOCKFILE_UNREADABLE` is about the **inspection**, not about the
file's contents, because discovery never reads a lockfile. Only a file's
existence is ever observed, so a path that cannot be `stat`-ed leaves existence
unestablished and the manager signal for it unreported. The alternative —
reading the file to make the code mean "unreadable" — would be creating I/O so
a diagnostic becomes reachable, which is not a trade this project makes. The
condition is real: a permission error on the repository root is a genuine
`EACCES` on a lockfile path, and reporting "no npm lockfile here" on the
strength of an I/O error is a false negative.

None of the four changes an exit code. All four are warnings or info, so a messy
repository is still a successfully discovered repository.

### 3. Package manager is scoped, evidence is atomic, absence is not a default

**Scoping.** A package manager is a property of a manifest, not of a repository. A
root manifest naming pnpm and a nested manifest naming npm is not a contradiction
about one thing; it is two true statements about two things. Each discovered manifest
therefore owns its own package-manager fact. A repository-level summary counts and
names the _root_ manager and reports repository-wide disagreement as incompleteness;
it never merges nested declarations into a single answer.

**Atomic evidence.** Each package-manager signal is its own **claim**, never a merged
list:

- `package.json` → `packageManager: "pnpm@10.0.0"` is one `declared` claim, cited to
  the root manifest and the `/packageManager` pointer. The claimed _value_ is the
  field verbatim. The manager _name_ is not a separate claim about the same
  identity — it is a documented deterministic projection of that one declaration,
  computed by taking the text before the first `@`, and it is recomputed identically
  for every claim about that identity. A field that is not of the form `<name>@<version>`
  is `DISCOVERY_FACT_UNSUPPORTED` with no name claim at all, rather than a best-effort
  split. Nothing is validated, upgraded, normalized, or repaired.- Each supported lockfile is its own `derived` claim, cited to that lockfile. Its
  value is the _repository-relative lockfile path_, not the manager name. This is
  the load-bearing choice: it means `pnpm-lock.yaml` asserts "a pnpm-specific repository
  artifact exists at this path", which is what was actually observed, and the manager
  name is a projection applied uniformly at render time rather than a second opinion
  hiding inside the value.
- A `packageManager` value that is not a `<name>@<version>` string yields **no** manager
  name at all, including when it looks close. `@scope/pkg@1.0.0` is npm
  package-name syntax, not package-manager syntax: no package manager is scoped,
  so accepting it would mint a name — `@scope/pkg` — that cannot exist, cannot
  match a lockfile, and cannot corroborate anything. It is `unknown` with reason
  `not-probed` plus `DISCOVERY_FACT_UNSUPPORTED`, which says what happened:
  this version does not model the shape. The separator is therefore the first
  `@`, with no exception for a leading one.
- `pnpm-workspace.yaml` is a workspace declaration, not a package-manager signal. It
  is never counted as evidence about a manager, because its presence in a repository
  that also ships `yarn.lock` says nothing about which tool is used.

**Merging.** At most one `declared` claim and any number of `derived` claims may
contribute to one identity.

- Exactly one claim, or several agreeing: an agreed fact.
- One `declared` claim plus at least one `derived` claim naming a different manager:
  the declaration is carried forward as the value and every artifact is retained
  alongside it, with `DISCOVERY_FACT_INCOMPLETE`. The declaration is not "chosen" over
  the lockfile — it is the only claim about the declared identity, and dropping it
  would report the repository as saying nothing, which is false. The disagreement is
  published as a list on the fact and is the thing a consumer must act on.
- Two or more `derived` claims naming different managers: a conflict with no value,
  exactly as ADR-0044 requires. `pnpm-lock.yaml` + `yarn.lock` + `package-lock.json`
  is a three-way conflict, never `pnpm` because pnpm is first in a list.
- No claims: `unknown` with reason `no-evidence`. There is **no** fallback to `npm`.
  Node's historical default is a fact about Node, not about this repository, and
  inferring it would be manufactured knowledge.

**Ordering.** Claims sort by kind, then value, then evidence key — all code-unit. The
order is stable and published, and it is never used to select a value.

### 4. Contract claims are `author-declared` and can never overwrite

A contract that declares `environment.packageManager` contributes one
`author-declared` claim per affected identity, cited to `agent-ready.yaml` and its
pointer. It is never promoted to `declared` or `derived`, and ADR-0044's rule stands
unchanged: it never overwrites repository evidence, and both are retained. It may
agree (the fact gains an `author-declared` claim and the value is unchanged), conflict
(an additional claim is retained and disagreement is published), or remain
uncorroborated. The contract cannot change which facts become _true_, only which
become _available_ — the required comparison of a repository with and without a
contract yields byte-identical repository-derived facts.

### 5. A package is a manifest, and membership is a separate question

A **package** is a directory containing a readable `package.json`. Nothing else
qualifies: not a directory matched by a glob, not a directory named `packages`, not
a directory containing source files. Workspace membership is a _separate_ fact with
a separate vocabulary, so "a manifest exists here" and "this is a workspace member"
are never the same statement.

`repository.packages` is a `derived` array of:

```text
{ path, name, nameStatus, private, version, manifestStatus }
```

`nameStatus` is one of `declared` (a non-empty string `name`), `absent` (the manifest
is readable and declares no `name`), `invalid` (present but not a string), or
`unreadable`. `manifestStatus` is one of `read`, `malformed`, or `unreadable`. A
`name` is recorded only when `nameStatus` is `declared` — absence of a package name is
a real and common state, and inventing one from the directory name is precisely the
directory-naming inference this issue rejects.

**Discovery scope is closed-world, deliberately.** Packages are discovered by
following declared workspace patterns plus the root manifest. Agent-Ready does **not**
walk the tree hunting for undeclared manifests, and says so in the snapshot rather
than implying full repository coverage. A package under `tools/internal/` with no
workspace declaration is therefore not listed, and that is documented behaviour, not
an oversight. The alternative — an unbounded scan — is a performance decision with no
epistemic benefit, since the answer would be "there are manifests here" without
saying anything the declarations did not already imply. Repository-wide manifest
coverage, if it is ever wanted, is its own issue with its own bounds.

### 6. Workspace: four distinct things, never collapsed

```text
declaration   what the repository asserts          declared
pattern       one declared glob string             declared
candidate     a directory a pattern matched         derived
member        a candidate with a readable manifest derived
root          the manifest that carries the declaration
```

A workspace **declaration** is a form Agent-Ready implements deliberately. Exactly
two forms are supported, both for the Node ecosystem:

- `package.json` → `workspaces` as an **array** of strings (npm and Yarn classic).
- `package.json` → `workspaces` as an **object** with a `packages` array of strings
  (the Yarn berry form).

`pnpm-workspace.yaml` is parsed as a third source, with the repository's existing
safe YAML infrastructure ([ADR-0003](0003-yaml-parsing-safety.md)) — no second YAML
parser. The `packages:` key only; `catalog:`, `onlyBuiltDependencies:`, and every
other pnpm field are ignored rather than interpreted. Configuration is read
statically; no package manager is ever executed.

Any other form — a string, a number, an array containing a non-string, a
`pnpm-workspace.yaml` whose `packages:` is not a list of strings — is **not
guessed**. The declaration is reported as `null` with a per-declaration `unsupported`
reason, and `DISCOVERY_WORKSPACE_UNSUPPORTED` is raised. This is the "unrecognized
layout is reported as unrecognized" requirement: an unreadable shape must not be
coerced into the nearest shape that happens to fit.

`repository.workspace.declarations` is `declared` and preserves the source file, the
declaration form, and the **patterns verbatim in declaration order** — order is
itself declared information, because `!` exclusions in pnpm and Yarn berry are
position-sensitive. It is distinct from `repository.workspace.candidates` and
`repository.workspace.members`, which are `derived` expansions.

**Candidates** are matched directories, whether or not they contain a manifest:
`packages/notes/` matched by `packages/*` is a candidate and **not** a package.
**Members** are candidates with a readable manifest. Both are kept, because collapsing
them would hide exactly the "glob matched a non-package directory" case that makes a
repository messy.

**Declared-but-absent patterns are retained.** A workspace declaring `packages/a` and
`packages/missing` reports the declaration, the candidate list, and the absence of
`packages/missing` — the declaration is never silently dropped, because a later drift
analysis needs the gap to still be there.

**Workspace present is not workspace correct.** A `workspaces` key, an
`unsupported` reason, and a pattern that matches nothing are three different states
and are reported as three. There is no fact anywhere that says a workspace is valid,
consistent, or complete, because no bounded set of reads can establish that.

### 7. Glob expansion is the ADR-0005 subset, over a bounded, fenced walk

Expansion reuses the matcher in `src/contract/globMatch.ts` and the normalizer in
`src/contract/paths.ts` — the same subset ADR-0005 already documents, validates, and
tests (`*`, `**`, `?`, `[...]`, `{a,b}`, leading `!`). **No new glob engine is
introduced**, and no `node_modules` glob dependency is added.

The walk is:

- **Bounded**: at most `MAX_WORKSPACE_DEPTH` (8) directory levels and at most
  `MAX_WORKSPACE_ENTRIES` (2000) enumerated entries. Both are code constants, not
  configuration, so the rule is the same for every repository. A limit that is
  reached yields a `truncated` status — the limit is reported, never silently
  applied.
- **Segment-driven, not a full-tree scan**: expansion descends only into literal
  prefix segments of a pattern and enumerates only the segment a `*` or `**` stands
  for. Work is proportional to the declared patterns, not to the repository.
- **Generated trees excluded**: `node_modules` and `.git` are never entered. This is
  a hard rule, not a preference — both are excluded from a repository's own source
  model by convention, and entering `node_modules` would make discovery cost scale
  with install state.
- **Fenced to the repository root**: a pattern that is absolute, or that escapes via
  `..`, is rejected at the normalizer with ADR-0005's own codes, and a pattern
  containing a `..` segment never reaches the file system. A matched entry that
  `realpath`s outside the repository root is **not** traversed. Traversal follows
  real directory entries only, so a symlink is never a path out.
- **No hidden cwd dependence**: every path in the snapshot is repository-relative,
  so identical content yields identical bytes at any absolute location.
- **Deterministically ordered**: candidates, members, patterns, claims, evidence, and
  diagnostics all sort by code-unit. Filesystem enumeration order is never observable.

`!` exclusions are honoured positionally, within a single declaration source, as
ADR-0005 already specifies. A negation never spans sources: an exclusion in
`package.json` does not remove a path matched by `pnpm-workspace.yaml`, and if the
same pattern appears in both, both declarations are reported and the overlap is
visible rather than resolved.

### 8. The read budget becomes a bounded recursive walk

ADR-0044's guarantee was a fixed set of root-level reads. It now becomes: a fixed
set of root-level reads, plus a bounded walk driven by workspace declarations, plus
a read per discovered manifest. The determinism argument survives because the walk is
fenced, sorted, depth-bounded, and entry-bounded, and because nothing outside the
repository root is reachable from an author-controlled pattern.

### 9. Failure boundaries are per-path

A malformed or unreadable manifest degrades only the facts that depend on it. The
repository snapshot remains usable, `summary.complete` becomes `false`, and a
`DISCOVERY_PARTIAL` diagnostic names the failing path. One unreadable manifest never
becomes "workspace discovery failed". A workspace declaration is malformed only when
the declaration itself cannot be read; a malformed _member_ is not a malformed
declaration.

### 10. Snapshot versioning and the public API

`snapshotVersion` **stays `0`**. The vocabulary grew additively, no field was removed
or changed meaning, and `0` already means _unstable and outside the ADR-0009
pre-1.0 promise_. A version bump is reserved for a change a consumer could not
survive, and reserving it for routine growth would make the number meaningless.

The discovery API **stays internal**. `src/index.ts` exports nothing from
`src/discover/`, and this issue does not change that, even though the API is now
substantially larger. Exposing it is a pre-1.0 compatibility commitment and needs its
own decision; [#40](https://github.com/AdamEddahmouni/agent-ready/issues/40) is where
snapshot-field stability is published.

## Amendments to ADR-0044

Three of ADR-0044's rules do not survive contact with a real package domain. They are
amended here rather than worked around in code.

1. **Corroboration is about claims, not about cited files.** ADR-0044 defined
   `corroborated` as "at least two claims whose evidence comes from different files".
   A package-manager fact is naturally multi-file, and that definition would report
   `corroborated: false` for a repository with three lockfiles — carrying no
   information in the one domain that needed it. `corroborated` now means **at least
   two claims support the value**. The property ADR-0044 was actually protecting is
   preserved by two narrower rules: one claim is one source, so a claim listing four
   lockfiles still makes one assertion; and **no probe may split one document into
   more than one claim**, so independence is never manufactured by re-reading the same
   field. `package.json`'s `packageManager` field and a lockfile are genuinely
   independent evidence and do corroborate; a second probe of the same field is not
   independent and cannot be written.

2. **Contradiction has two forms, and both are reported.** A conflict between two
   sources of the same kind is still ADR-0044's conflict: no value, all claims
   retained. A conflict between a `declared` claim and `derived` evidence is an
   _incomplete_ fact: the declared claim is carried forward, every contradicting
   artifact is retained, and no winner is chosen. The reason is that the two kinds
   are not peers — a declaration is an assertion about identity, while a lockfile is
   an observation of an artifact — and a conflict model built only on peer comparison
   cannot express that without either dropping a true claim or promoting an artifact
   to a declaration.

3. **`DISCOVERY_FACT_UNSUPPORTED` becomes reachable.** It was reserved for a fact
   kind outside the four defined kinds. It is used here for a fact whose _shape_ this
   implementation does not support — a `packageManager` field that is not
   `<name>@<version>`. The registry entry, severity, renderer behaviour, JSON
   behaviour, explain support, and documentation are all updated with it, so it is not
   an orphan code. The four epistemic kinds are unchanged; no fifth kind is
   introduced.

## Consequences

- The substrate survived its first real domain, and it did not survive unchanged.
  Three of ADR-0044's rules needed amendment, which is the honest outcome of
  stress-testing a model against contradictory evidence rather than a sign that the
  model was wrong. Each amendment is narrower than the rule it replaces.
- `pnpm-lock.yaml` + `yarn.lock` + `package-lock.json` produces a three-way conflict
  with no value, and `packageManager: pnpm` + `package-lock.json` produces an
  incomplete fact carrying the declaration. Neither produces a chosen answer, and
  both are distinguishable in JSON without parsing prose.
- A nested package naming a different manager is a second fact, not a contradiction
  about the first. Repository-wide disagreement is reported as incompleteness on the
  repository summary rather than merged into a single verdict.
- Discovery can now say "there is a pnpm-specific artifact at `pnpm-lock.yaml`"
  instead of "this repository uses pnpm", which is the difference between describing
  evidence and asserting a conclusion.
- Undeclared packages outside the discovered workspace are **not** reported. This is a
  documented boundary with a test pinning it, chosen over an unbounded scan. A
  consumer that needs full manifest coverage must ask for it explicitly.
- The `FileSystem` boundary gains a read-only `listDirectory`. It adds no write,
  process, Git, or network capability, so ADR-0044's read-only guarantee holds; but
  it is a shared interface used by the v1 commands, and it is recorded here because
  it is a capability change rather than a formatting choice.
- Package-manifest discovery reads repository-authored JSON, which is untrusted
  input. It is parsed with `JSON.parse` under a size cap and a nesting-depth guard,
  mirroring the YAML guards in [ADR-0003](0003-yaml-parsing-safety.md). No
  repository content is ever evaluated, and a size or depth violation fails that one
  manifest rather than the run.
- Human output is now the first place structured values appear. The renderer gained an
  explicit summariser and gained a guard against `String(value)`, so an object can
  never print as `[object Object]` and a conflict never prints as a yes/no.
- No readiness score, no certainty percentage, no recommendation, and no ranking was
  added. Discovery describes; it does not judge.

## Reconsideration trigger

Reconsider fact identity if package counts make the `packages` collection unreadable
to a human. The per-package scoped id template already exists for package managers and
would extend; a `repository.package.<path>` family should be added only if a real
consumer needs to address packages without reading the collection, and only with the
same bounded-path argument that justifies the package-manager template.

Reconsider the three new diagnostic codes if a fourth package-domain condition appears
that genuinely differs in remediation. A condition that `DISCOVERY_PARTIAL`,
`DISCOVERY_FACT_CONFLICT`, or the three codes here already explain belongs in
`metadata`, not in a new code.

Reconsider the walk bounds if real repositories are shown to routinely exceed them. The
bounds are constants, so raising them is a code change with a test, not a
configuration knob — which is the point.

Reconsider the closed-world package scope if a consumer needs repository-wide manifest
coverage. That is an unbounded-traversal decision with its own bounds, its own ignore
rules, and its own partial-failure story, and it does not belong as a silent extension
of this issue.

Reconsider the corroboration amendment if Phase 1 evaluation shows that claim-count
corroboration overstates agreement. The narrower reading is available: a claim could
carry a declared evidence _identity_ distinct from the paths it cites, which would
recover ADR-0044's meaning without reintroducing a score.
