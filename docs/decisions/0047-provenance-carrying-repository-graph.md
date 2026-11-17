# ADR-0047: Provenance-carrying repository graph semantics

## Status

Accepted

Amends [ADR-0044](0044-repository-discovery-model.md) only where named under
[Amendments to ADR-0044](#amendments-to-adar-0044). Builds on, and does not
replace, [ADR-0045](0045-package-and-workspace-discovery-semantics.md) and
[ADR-0046](0046-command-and-verification-discovery-semantics.md), which continue to
govern packages, workspaces, commands, and the fact vocabulary.

## Context

ADR-0044 answered "what does this repository _state_", and answered it well. ADR-0045
gave it packages and workspaces. ADR-0046 gave it commands and verification
entrypoints. What none of them can answer is the question a person actually has
about a codebase they did not write:

> **How is this repository put together?**

Every existing fact is a statement about a _declaration_: a manifest names a
script, a lockfile names a manager, a pattern names a candidate directory. None of
them says which module imports which, which package depends on which, or who is
declared responsible for a file. Those are the questions that make a repository
navigable, and they are questions about **structure** rather than about isolated
declarations.

The obvious implementation is an adjacency list: walk the tree, regex the imports,
read `package.json`, and emit `A → B`. It is a day of work, and it is exactly the
failure mode this project has spent three records refusing.

### The failure mode, concretely

```text
src/index.ts        imports  ./config.js      → did that file exist?
src/server.ts       imports  ../lib/db.js     → or was it lib/db.ts?
src/cli.ts          imports  @scope/api       → which workspace package, or a registry one?
src/util.ts         imports  ajv             → is that declared anywhere?
src/legacy.ts       imports  ./gone.js        → the file was deleted and nobody noticed
src/payments/x.ts   owned by                 → nobody can say. Or a guess is made.
```

A tool that answers those with confident wrong answers is worse than one that
answers `unknown`, for the reason ADR-0044 gave: **a consumer cannot tell a wrong
answer from a right one, and a wrong answer propagates into every downstream
decision while an honest gap is merely inconvenient.** A graph with a fabricated
`src/legacy.ts → src/gone.ts` edge is not a small error; it is a graph whose every
other edge is now suspect.

So this record's constraint is not "build a graph". It is:

> **Every node and edge carries the provenance of the fact it encodes. If a graph
> fact cannot be traced to a repository file and a line, it does not enter the
> graph.**

That is a stronger requirement than anything ADR-0044 imposed. Existing `Evidence`
is a `source` plus an optional `pointer`; a file with no line does not say _where_.
The graph requires a line, and a line has to be the line that made the fact true —
not `line: 1` sprayed across every entry to satisfy a type.

### And the hard case: a negative fact has no line

The constraint and one of the issue's requirements are in genuine tension:

> Every graph fact must trace to a file and a line.
>
> Missing ownership must be explicit and must never be a guess.

"No supported CODEOWNERS rule applies to `src/foo.ts`" is a fact. Which line of
which file supports it? None — the claim is about an _absence_ across a whole
policy file. Fabricating `.github/CODEOWNERS:1` would be exactly the decorative
provenance the constraint exists to forbid, and it is worse than no line, because
it looks precise.

§10 below resolves this by separating **subject provenance** (the thing the fact is
about, which always has a real line) from **policy-evaluation provenance** (the
document that was searched and whether a rule matched). It is the only resolution
of the tension that is honest, and it is why the ownership model here is a state on
the node rather than a node of its own.

### What this record must decide before any code

The questions below are the ones whose answers a future contributor could not
reconstruct from the code alone, and several of them have more than one defensible
answer. They are answered in the Decision section, in order, and each answer is
load-bearing for something else.

## Alternatives considered

### Building the graph as a fact, with an evidence array

The graph could be `repository.graph`, a fact like any other. Rejected, and the
reason is structural rather than aesthetic. ADR-0045 put a **budget** on how many
paths one claim may cite — two for `derived`, one otherwise — and a rule that one
document may not be split into several claims. Both exist to stop a probe
manufacturing corroboration. A graph is a projection over _every file in the
repository_: its honest evidence set is one entry per node and one per edge, which
is thousands of paths. Putting it in the fact model would require either
exempting it from the budget, which weakens a guard for every future probe, or
compressing its provenance into an opaque blob, which makes per-item provenance
unenforceable — the precise thing ADR-0045 rejected for `repository.packages`.

A graph is not a claim about one conceptual property. It is a projection _of_ the
claims already in the snapshot. So the graph is a **top-level snapshot field**,
sibling to `facts`, and the fact vocabulary is untouched.

### `module:UNKNOWN` as a shared unresolved target

Every unresolved import pointing at one sentinel node makes the graph look
connected when it is not, and lets a consumer "resolve" an import edge to a node
that says nothing. Rejected. §9 makes the target `null` on an unresolved edge and
requires a `specifier` and a `reason` instead, which is representable in the type
system and cannot be mistaken for a resolved relationship.

### Resolving imports with string concatenation

`"./x.js"` → replace `.js` with `.ts` → read it. This is the "NodeNext-ish"
resolver everyone writes, and it is wrong in at least four ways: a specifier with
no extension, a directory with an `index.ts`, a `paths` alias, and a specifier
that legitimately resolves to a `.d.ts`. TypeScript is already a project
dependency and already knows all four. Rejected in favour of `ts.resolveModuleName`
behind a repository-fenced read-only host (§11).

### Regex for imports

Rejected outright. `import`, `export … from`, `import(`, `require`, comments,
template literals, and a string containing the word "import" make a regex
untrustworthy, and an untrustworthy import extractor produces a graph that is
wrong without saying so. TypeScript's parser is already a dependency and gives
exact source positions as a by-product rather than as a thing to reconstruct.

### One node per file plus one per package, with ownership as edges to owner nodes

Ownership as an edge to an `owner:@org/team` node is right when there _is_ an
owner. It has nothing to say when there is not, and the obvious repair — an
`owner:UNOWNED` sentinel node — fabricates a person or team that does not exist.
The model below therefore keeps the owner _edge_ for the owned case and makes
ownership a **discriminated state on the subject node** for the unowned case, with
the winning rule's provenance on the edge. The validator pins the two against each
other so they cannot disagree.

### Aggregating duplicate import declarations into one edge with several provenances

`import { a } from "./x.js"` and `import { b } from "./x.js"` are one _relationship_
and two _declarations_. Aggregating them is defensible and produces a smaller
graph. Rejected, for one concrete reason: the two sites can differ in ways the
graph is required to preserve — one may be `import type`, one a re-export, one a
dynamic literal import. A single edge would then need a set-valued `typeOnly` and
a set-valued kind, and "is this module type-only-coupled to that one" stops being
answerable from the edge. One edge per declaration site is more bytes and strictly
more information, and the graph is a fact model, not a storage format.

### Reading a lockfile by searching for version strings

Rejected. The same rule as the import regex, one layer down: a version string
appears in a manifest, in a lockfile, in a transitive entry, and in a peer-suffixed
key like `1.0.0(eslint@10.7.0)`. A text search cannot tell which occurrence belongs
to which declaration, and the issue's central question is precisely _"why do you
believe this dependency resolved to 8.17.1?"_. `yaml`'s `LineCounter` and
TypeScript's JSON AST both answer it exactly.

### Inferring ownership from Git history

Rejected. `git blame` produces a commit author, and a commit author is not a
declaration of responsibility. ADR-0043's quarantine is about integrations;
this is simpler than that — Git is simply not a source of ownership, and no
`git` invocation is added to discovery.

## Decision

### 1. What is a graph node?

A **node** is a stable identity in the repository's structure that some repository
declaration made necessary, together with the declaration that made it
necessary. It is not a discovered fact about a property (that is what a `Fact` is);
it is an addressable thing the graph can hang edges off.

A node is **not** admitted on the strength of a path, a filename, or a
similarity. `src/utils/parse.ts` is not a node because it parses; it is a node
because `src/index.ts` line 4 says `import … from "./utils/parse.js"` and that
import resolves to a file inside the repository. Identity is a consequence of
evidence, and a node with no evidence has no identity.

Four node kinds exist, and no others are introduced in this issue:

| Kind                  | What it is                                                              |
| --------------------- | ----------------------------------------------------------------------- |
| `package`             | one discovered package, identified by ADR-0045's canonical package path |
| `module`              | one supported source file inside the repository                         |
| `external-dependency` | one package name declared by, or imported into, this repository         |
| `owner`               | one owner token written in a `CODEOWNERS` rule                          |

There is deliberately **no `unresolved-target` node kind**. §9 explains why, and
the short version is that a node has to be justified by a declaration, and
"several different imports could not be resolved" is not a declaration.

`external-dependency` nodes are _not_ the npm universe. Only a name this
repository itself mentions — by declaring it, or by importing it — becomes a node.
The transitive closure of a lockfile is explicitly out of scope (§14).

### 2. What is a graph edge?

An **edge** is a directed relationship between two nodes, or between one node and
an explicitly-absent target, that some repository declaration asserts. The
declaration is cited with a line. An edge with no cited declaration does not
exist.

Three edge kinds exist:

| Kind                 | Source                | Target                                                   |
| -------------------- | --------------------- | -------------------------------------------------------- |
| `imports`            | `module`              | `module` \| `package` \| `external-dependency` \| _none_ |
| `package-depends-on` | `package`             | `external-dependency` \| `package`                       |
| `owned-by`           | `module` \| `package` | `owner`                                                  |

Edge kind proliferation was considered and refused. `module-imports-module`,
`module-imports-package`, `module-imports-external`, and `package-depends-on-workspace`
would each be a _target-kind_ distinction, and all four are already carried by the
target node's `kind` plus a `resolution` field on the edge. A second vocabulary
that says the same thing in a different place is a place the two will disagree.

`imports` and `package-depends-on` are **never merged**. "Module A imports
package B" and "package A declares a dependency on B" are different claims with
different evidence, and the _difference_ between them — a module importing a
package the manifest never declared — is one of the most useful things this graph
can surface. Collapsing them would erase it.

### 3. Node kinds, and what each one must carry

```ts
type GraphNode = PackageNode | ModuleNode | ExternalDependencyNode | OwnerNode;

type PackageNode = {
  id: string;
  kind: "package";
  path: string; // canonical repository-relative package directory
  name: string | null; // the declared package name, or null
  provenance: SourceLocation;
  ownership: OwnershipState;
};

type ModuleNode = {
  id: string;
  kind: "module";
  path: string; // canonical repository-relative file path
  packagePath: string; // the deepest package root containing it
  provenance: SourceLocation;
  ownership: OwnershipState;
};

type ExternalDependencyNode = {
  id: string;
  kind: "external-dependency";
  name: string; // the package name exactly as written
  provenance: SourceLocation;
};

type OwnerNode = {
  id: string;
  kind: "owner";
  identity: string; // the owner token exactly as written, e.g. "@org/payments"
  provenance: SourceLocation;
};
```

Nothing is duplicated onto a node that the snapshot already publishes elsewhere.
A package node repeats only `path` and `name`, because an edge has to be able to
name its endpoint without a join, and two short strings are a cheaper join than a
re-derivation. Everything else — scripts, workspaces, package-manager evidence —
stays in the facts and is not copied.

### 4. Edge kinds, and what each one must carry

```ts
type ImportEdge = {
  id: string;
  kind: "imports";
  source: string; // module node id
  specifier: string; // the module specifier, verbatim
  syntax: ImportSyntax; // how it was written
  typeOnly: boolean; // written with `import type`
  resolution: ImportResolution;
  provenance: SourceLocation; // the specifier's line
};

type DependencyEdge = {
  id: string;
  kind: "package-depends-on";
  source: string; // package node id
  declarations: readonly DependencyDeclaration[]; // one or more, never zero
  resolution: DependencyResolution;
  provenance: SourceLocation; // the first declaration's line
};

type OwnershipEdge = {
  id: string;
  kind: "owned-by";
  source: string; // module or package node id
  target: string; // owner node id
  provenance: SourceLocation; // the CODEOWNERS rule line
  rule: string; // the pattern, verbatim
};
```

`ImportSyntax` is `import`, `type-import` is carried by `typeOnly` rather than
being a separate kind, `re-export`, `dynamic-import`, `import-equals`, or
`require`. `import-equals` and `require` are listed even though they never produce
a resolved edge, because a thing the graph looked at and declined to model is
still a thing a reader deserves to see (§10).

`provenance` on a multi-declaration dependency edge is the **first** declaration
in code-unit order — not a "best" one, just the deterministic first — and every
other declaration keeps its own `SourceLocation` inside `declarations[]`. The
edge-level `provenance` exists so a consumer that reads one field still gets a
real declaration line; it is never the only place the evidence lives.

### 5. Stable graph identities

Every id is `deterministic`, `checkout-independent`, and `human-inspectable`:

```text
package:.                      package:packages/api
module:src/index.ts            module:packages/api/src/server.ts
dependency:ajv                 dependency:@scope/foo
owner:@org/platform
```

Rules, each with a test:

- **No UUID, no random id, no counter, no absolute path, no hash over a checkout
  root.** An id that embeds where the repository happens to sit would make two
  checkouts of the same commit produce different bytes, which is the determinism
  guarantee ADR-0044 established.
- **No hash in a node id.** Node ids are readable strings built from repository
  identity, and there is no need to shorten them.
- **A node id is a function of exactly one repository fact** — a path, a name, a
  token — so a reader can re-derive it by hand.
- **Duplicate ids are an invariant failure**, not a merge. Two nodes claiming one
  id means a construction bug, and §13 says graph-invariant failure is an
  Agent-Ready defect, not a repository condition.

### 6. Entity identity versus fact identity

They are different things and are kept apart.

- **Entity identity** answers _"what is this thing?"_ — `package:packages/api`,
  `module:src/index.ts`, `owner:@org/platform`. It is a node id.
- **Fact identity** answers _"which repository claim is this?"_ — ADR-0044's
  `FactId` union. It names a conceptual property, is a fixed reviewable list, and
  is never generated from repository content (ADR-0045 §1).

Consequences, and they are the reason the two are separated rather than merged:

- A repository with 40 packages still has **one** `repository.packages` fact, and
  40 package **nodes**. Putting a fact id on each node would make `FactId`
  unbounded and unreadable.
- An **edge id is a fact identity in the narrow sense that it identifies one
  declaration** — `import:module:src/a.ts->module:src/b.ts@4:17` names one import
  statement. It is a node-adjacency identity, not a conceptual property, and it
  is **not** a member of the `FactId` union. One document can produce thousands of
  them, and that is fine, because edge ids are never merged or corroborated.
- Nothing in this issue adds a `FactId`. `FACT_IDS` is unchanged, and the fact
  merge, corroboration, and conflict machinery is untouched.

### 7. Mandatory provenance fields, and the line-number convention

```ts
type SourceLocation = {
  source: string; // REQUIRED — repository-relative, '/'-separated
  line: number; // REQUIRED — 1-based
  column?: number; // 1-based
  endLine?: number; // 1-based
  endColumn?: number; // 1-based
  pointer?: string; // JSON Pointer, when the fact came from a JSON document
};
```

**Line numbers are 1-based and so are columns.** Line 1 is the first line of the
file, because that is what every editor, every `sed`, every code review, and every
human reader expects. TypeScript's `getLineAndCharacterOfPosition` returns 0-based
values; converting is the reader's job and this code does it, once, in one
function, so that no call site can forget.

**`source` is always repository-relative.** `C:\Users\…`, `/home/runner/…`,
`/tmp/…` and any other absolute form are an invariant failure, checked by
`validateGraph`. A `SourceLocation` is the join between the graph and the
repository, and an absolute path in it would make the graph location-dependent in
exactly the way ADR-0044 forbids.

`column` and `endLine`/`endColumn` are **included whenever the parser produced
them**, and omitted otherwise. They are not a nice-to-have: the issue's
acceptance criterion is that the cited line is _inspectable_, and a column range
is what makes `"./x.js"` distinguishable from the `import` keyword three hundred
characters to its left. Omitting a column the parser already gave us would be
discarding evidence we had in hand.

`pointer` is **additive and coexisting** with the line, never a replacement. ADR-0044's
evidence addressed _what field_; the graph addresses _where_. A dependency
declaration carries both `/dependencies/ajv` and the line it is on, so a consumer
can answer "which field?" and "where?" and a tool can check one against the other.

### 8. Existing `Evidence` is not retrofitted

`Evidence` in `src/discover/types.ts` is `{ source, pointer?, detail? }` and every
ADR-0044 through ADR-0046 fact uses it. Adding a required `line` to it would mean
rewriting every producer and would imply a strength of citation the earlier issues
never claimed — a fact whose value is the whole `scripts` object has no single
line, and inventing one would be the decorative provenance this record refuses.

So `SourceLocation` is a **new, separate type** used by graph nodes and edges. The
invariant is scoped exactly as the issue requires it: **every graph node and every
graph edge has at least one valid repository file and line.** Non-graph facts keep
ADR-0044's weaker, already-honest `source`+`pointer` evidence, and the diff stays
additive.

### 9. Negative facts, and why there is no unresolved-target node

`import x from "./does-not-exist.js"` must not vanish. It is represented as an
**import edge whose `resolution` is `unresolved`**, with `target: null`, the
verbatim `specifier`, the declaration's `SourceLocation`, and a `reason`.

```ts
type ImportResolution =
  | { status: "module"; target: string; targetPath: string }
  | { status: "package"; target: string; subpath: string | null }
  | { status: "dependency"; target: string }
  | { status: "platform"; target?: never } // a Node built-in
  | { status: "unresolved"; target?: never; reason: UnresolvedReason };
```

`target?: never` is the type-level guarantee the issue asks for: a
`status: "resolved"` edge _cannot_ omit its target, and an `unresolved` edge
_cannot_ carry one. `status: "platform"` has no target by design — `node:path` is
provided by the runtime, not by any node in this repository, so minting a node for
it would put a thing in the graph that no repository file declares.

The reason vocabulary is small and structural, and a **diagnostic code is not
minted per reason**:

| Reason                        | Meaning                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `target-not-found`            | the resolver ran and no in-repository file matched                       |
| `unsupported-specifier`       | absolute path, URL, or another form this version does not model          |
| `unsupported-syntax`          | `require` / `import = require` / computed `import()`                     |
| `outside-repository`          | the only candidate resolved outside the repository root, and was refused |
| `unsupported-package-subpath` | a workspace package matched, but the subpath's module was not provable   |

A `module:UNKNOWN` sentinel is refused for a specific reason beyond taste: it
would make a graph with 4 failed imports _look connected_, and a consumer
traversing it would report four resolved edges. `resolution: "unresolved"` with a
`null` target cannot be misread, because the type does not permit a target.

### 10. Unsupported constructs are surfaced, never guessed

Every case where this version declines to model something gets a named
`status`/`reason` in the graph **and** a `DISCOVERY_FACT_UNSUPPORTED` warning
carrying `source`, `line`, and the pattern or syntax in `metadata`. One code, many
subjects — exactly as ADR-0046's amendment 2 established for `scripts`. A code
whose remediation is identical belongs in that code's `metadata`.

Supported per construct, and each has a test:

| Construct                   | Behaviour                                                      |
| --------------------------- | -------------------------------------------------------------- |
| static `import`             | resolved                                                       |
| `import type`               | resolved, `typeOnly: true`                                     |
| named / default / namespace | resolved                                                       |
| `export … from`             | resolved, `syntax: "re-export"`                                |
| `export * from`             | resolved, `syntax: "re-export"`                                |
| `import "…"` (side effect)  | resolved                                                       |
| `import("literal")`         | resolved, `syntax: "dynamic-import"`                           |
| `import(\`./${x}\`)`        | **unresolved**, `reason: "unsupported-syntax"` — never guessed |
| `require("literal")`        | **unresolved**, `reason: "unsupported-syntax"` — see §4        |
| `require(expr)`             | **unresolved**, `reason: "unsupported-syntax"`                 |
| `import x = require("…")`   | **unresolved**, `reason: "unsupported-syntax"`                 |
| `https://…`, `data:…`       | **unresolved**, `reason: "unsupported-specifier"`              |
| `/abs`, `C:\abs`            | **unresolved**, `reason: "unsupported-specifier"`              |

CommonJS `require` is **outside initial scope** rather than half-supported, and
the choice is deliberate. A `require` in a TypeScript file is rare enough that
supporting it buys little, and supporting it _wrongly_ — treating a `require` as an
ESM import, or reading the wrong argument — is the exact class of confident error
this project refuses. Surfacing it as unresolved keeps the declaration visible
(a reader can see there is a `require` here) without asserting a relationship
Agent-Ready cannot justify. A later issue can add it; adding it then is a
resolution change, not a schema change, because the edge already exists.

### 11. The supported module universe, and where source files come from

Source files are **selected, not discovered by walking everything**. A silent
whole-repository walk would put `dist/`, `coverage/`, vendored bundles, and test
fixtures into the graph as peers of real source, and there is no honest way to
distinguish them without an ignore list that grows by accretion. The issue asks for
a deliberate choice, so:

**Option A — TypeScript's own configuration, per package.** For each discovered
package directory, if `<packageDir>/tsconfig.json` exists, it is parsed with
`ts.parseJsonConfigFileContent` over a repository-fenced `ts.ParseConfigHost`, and
its `fileNames` are the package's source universe. `include`, `exclude`, `files`,
and `extends` are TypeScript's semantics because they _are_ TypeScript's — this
project does not re-implement them and does not approximate them.

**Option B — a bounded, precisely specified fallback**, used only for a package
with no `tsconfig.json`. Walk the package directory with the ADR-0045 limits:
depth `MAX_SOURCE_DEPTH` (12), entries `MAX_SOURCE_ENTRIES` (2000), code-unit
order, symbolic links never followed, real paths confined to the repository root,
and **exactly two** excluded directory names: `node_modules` and `.git`. Those two
are inherited from ADR-0045 rather than invented here.

The fallback excludes **nothing else**. `dist`, `build`, `out`, and `coverage` are
_not_ silently skipped: a build output directory is genuinely ambiguous, and
guessing that a directory named `dist` is generated output is a guess. The
alternative — using a `tsconfig.json` — is the precise answer, and a repository
that wants a precise universe can have one by writing four lines. When the
fallback is used, `graph.sourceUniverse.strategy` says so, so a consumer can see
that this repository did not state a universe.

Which packages are walked is the **union over discovered packages**, deduplicated
by path, code-unit sorted. Workspace packages are therefore included
automatically, and a module is assigned to a package by containment (§7 below).

Supported extensions, and the file-system **existence probe never
auto-includes `.d.ts`**:

| Extension | In the universe | Rationale                                                                                             |
| --------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `.ts`     | yes             | the project's own language                                                                            |
| `.mts`    | yes             | ESM TypeScript, same import semantics                                                                 |
| `.cts`    | yes             | CJS TypeScript, same import semantics                                                                 |
| `.tsx`    | yes             | same parser, same semantics                                                                           |
| `.js`     | yes             | ESM JavaScript                                                                                        |
| `.mjs`    | yes             | ESM JavaScript                                                                                        |
| `.cjs`    | yes             | CJS JavaScript                                                                                        |
| `.jsx`    | yes             | same parser                                                                                           |
| `.d.ts`   | **no**          | a declaration file describes another file; a graph edge to it would be an edge to a type, not to code |

`.d.ts` exclusion is a real narrowing and is recorded here rather than discovered
later: a repository that ships hand-written declarations loses those edges. The
alternative — modelling a declaration file as a module — produces `a.ts → a.d.ts`
edges that assert a runtime relationship that does not exist, which is the wrong
kind of correct.

`tsconfig.json` discovery is bounded and fenced like everything else: the file
must be inside the repository root, and an `extends` that resolves **outside the
repository** (or into `node_modules`) is **not read**. The configuration is read
as text and parsed statically; no `extends` target is ever executed, and no config
is loaded by TypeScript's own loader.

### 12. Import resolution: relative, workspace, external, built-in

Resolution uses **`ts.resolveModuleName`** over a `ts.ModuleResolutionHost` whose
every method is a repository-fenced repository read. This is what makes the
`.js` → `.ts` case work: TypeScript's NodeNext resolution already knows that
`./x.js` may denote `x.ts`, and a hand-rolled resolver that missed it would report
this repository's own imports as unresolved.

The host is fenced in four ways, and each is a test:

1. `fileExists`/`readFile` return false/absent for any path outside the repository
   root, so a resolution can never succeed by escaping.
2. `directoryExists` is likewise confined.
3. **`node_modules` is invisible to the host.** A resolution that would land inside
   a `node_modules` tree fails to resolve. This is what makes the graph
   installation-state independent (§13).
4. `realpath` is the identity function for repository-relative paths, and the
   resolved absolute path is re-checked for containment before it is used.

The host also carries **no clock, no environment, and no global state**, so two
runs of the same tree resolve identically.

Then, in order:

- **Relative specifiers** (`./`, `../`) are handed to the resolver. A resolved
  path inside the repository **and inside the module universe** becomes a `module`
  target. A resolved path inside the repository but _outside_ the universe is
  still a `module` target — a real in-repository file is a real target whether or
  not the universe chose to list it, and demoting it would be inventing a problem.
  No target, or a target outside the root, is `unresolved`.
- **Non-relative specifiers** are first tested against the **discovered workspace
  package names** from ADR-0045. A match gives a `package` target, with the
  subpath preserved. This works with `node_modules` entirely absent, which is the
  point — §11's fence means a workspace import is resolved from _repository
  declarations_, never from an installed symlink.
- **Package subpaths** (`@scope/pkg/subpath`) are matched on the **package name
  boundary**: `@scope/pkg` and `@scope/pkg/sub` are different packages, and
  `lodash/fp` is `lodash` with the subpath `/fp`. No subpath is ever mapped to a
  guessed file path; a package target with `subpath` set is exactly as much as is
  provable without interpreting `exports`.
- **Everything else bare** is an external package name, extracted by the same
  boundary rule, and becomes an `external-dependency` target. No `node_modules`
  file is opened.
- **Node built-ins** — `node:*` and the unprefixed legacy forms — are
  `status: "platform"` with no target. The built-in list is the one this runtime
  publishes through `module.builtinModules`, which is a fixed, enumerable property
  of the supported Node baseline, not a heuristic. A built-in is **never** compared
  against manifest dependencies (§16).

Path aliases (`compilerOptions.paths`) are **supported**, because TypeScript's own
resolver implements them and the host keeps every candidate inside the repository.
An alias whose targets all fall outside the repository resolves to nothing, and the
import is `unresolved` rather than approximated by string substitution.

`moduleResolution` is taken from the package's `tsconfig.json` when one exists.
With no config, the resolver runs in **`Bundler`** mode, which is recorded in
`graph.sourceUniverse.resolutionMode`. A fallback mode is a documented narrowing,
not a silent default: a repository whose runtime resolution differs will show
unresolved imports, which is the correct direction to fail.

### 13. Checkout independence, `node_modules` independence, and no network

Every path in the graph is repository-relative and `/`-separated. Three fixtures
pin the consequence:

- The same content at two different absolute roots produces **byte-identical** JSON.
- The same repository **with a `node_modules` tree present** produces
  byte-identical JSON to the same repository without one.
- The same content with directory entries registered in **reverse order** produces
  byte-identical JSON, because every collection is sorted by code-unit _before_ any
  budget is spent, so which files survive a bound cannot depend on enumeration
  order.

The `node_modules` independence is not an aspiration; it is the reason the
resolution host is fenced in §12 and the reason §2's fixture requires it. A graph
that changed when someone ran `pnpm install` would be describing the developer's
machine, not the repository.

No network call exists anywhere in graph construction. Not for a registry, not for
a team, not for a package's metadata. A `@org/team` token in a `CODEOWNERS` file is
preserved as written, and whether that team exists is not Agent-Ready's question —
it has no network, and the alternative would be a snapshot that changes when a
host is reachable.

### 14. Dependency edges, and declared versus resolved

A dependency edge is minted **only** from a manifest declaration. An import edge
never creates one, and no naming convention does either: a package named
`@repo/api` is not a dependency of the package that imports it unless some
manifest says so. The graph may then show both facts, and the disagreement between
them is valuable output, not something to normalise.

One edge per **(package, dependency name)**. The edge carries a
`declarations[]` array with one entry per manifest field that declares it, and an
array rather than one field because a name can genuinely appear in two of
`dependencies`, `devDependencies`, `peerDependencies`, and
`optionalDependencies`. Choosing one would let object order pick a winner, which
ADR-0045 §3 forbids; preserving both is the honest answer. `declarations[]` is
non-empty by type, so "a dependency edge with no declaration" is inexpressible.

```ts
type DependencyDeclaration = {
  dependencyClass: "runtime" | "dev" | "peer" | "optional";
  declaredSpecifier: string; // verbatim: "^8.17.1", "workspace:*", "file:../x"
  provenance: SourceLocation; // the manifest line this declaration is on
  pointer: string; // "/dependencies/ajv"
};
```

The class is the **manifest field**, verbatim, and a lockfile never changes it. A
`devDependency` does not become a `dependencies` entry because runtime code
imports it; that observation is a separate, later analysis and making it here
would destroy the distinction the manifest drew.

`declaredSpecifier` is **never rewritten**. `^8.17.1` stays `^8.17.1`,
`workspace:*` stays `workspace:*`, `file:../x` stays `file:../x`. Nothing is
normalised through `semver`, and a non-semver protocol is not coerced into one
(§134 of the issue calls this out; the answer is that no coercion happens at all).

Resolved versions come **only** from a lockfile, through a narrow adapter
interface:

```ts
interface LockfileAdapter {
  readonly manager: string;
  supports(repositoryRelativePath: string): boolean;
  resolve(context: DiscoveryProbeContext, importer: string): Promise<LockfileResolution>;
}
```

`LockfileResolution` is a discriminated union, so "no lockfile", "a lockfile we
cannot read", "a lockfile in a format we do not model", and "a lockfile that has
no entry for this dependency" are four different states and not one nullable field:

```ts
type DependencyResolution =
  | { status: "resolved"; version: string; provenance: SourceLocation }
  | { status: "no-evidence" } // no supported lockfile
  | { status: "unsupported"; source: string; detail: string } // format not modelled / unparseable
  | { status: "unresolved" }; // lockfile read, no entry
```

Two properties that follow, and both are required:

- **A declaration never disappears.** No lockfile, a broken lockfile, an
  unsupported format — the `declarations[]` array and its provenance are untouched
  and the edge survives with a non-`resolved` resolution. Lockfile absence is not
  declaration absence (the issue is explicit; it is also obviously right).
- **A resolved version never overwrites a declared one.** They are different
  fields with different provenances. `^8.17.1` on `package.json:69` and
  `8.20.0` on `pnpm-lock.yaml:13` are two claims about two different questions.

Semver satisfaction is **not** evaluated. The repository depends on `semver`, and
"the resolved version does not satisfy the declared range" would be a genuinely
useful derived fact — but it is not required here, it is not a structural
relationship, and adding it would mean a graph fact whose truth depends on a
semver implementation's edge cases. It belongs to a later analysis that consumes
both fields, which this graph publishes verbatim.

### 15. Lockfile support, and the adapters

Two formats are modelled, because two are modelable correctly today:

| Lockfile            | Manager | What is read                                                             |
| ------------------- | ------- | ------------------------------------------------------------------------ |
| `pnpm-lock.yaml`    | pnpm    | `importers.<importer>.<class>.<name>.version`                            |
| `package-lock.json` | npm     | `packages["node_modules/<name>"].version`, for `lockfileVersion` 2 and 3 |

Everything else — `yarn.lock`, `bun.lockb`, `npm-shrinkwrap.json` — is
**`status: "unsupported"` with a named reason and a `DISCOVERY_FACT_UNSUPPORTED`
warning**. Not a partial parse, not a heuristic, and specifically not "the first
`name@version:` line in the file". A repository's lockfile format is a real thing
this version does not model, and saying so is more useful than a number that might
be right.

`pnpm-lock.yaml` is supported first because this repository uses it, and dogfooding
against a format nobody has tested is how a support claim becomes fiction. npm's
`package-lock.json` is supported because it is the other overwhelmingly common
format and its `packages` map is structurally similar. Version 1 lockfiles (the
pre-`packages` layout) are explicitly `unsupported` rather than half-read.

The **transitive registry graph is not built**. A `pnpm-lock.yaml` with 1,400
packages would produce 1,400 nodes and tens of thousands of edges describing a
dependency graph Agent-Ready did not choose and cannot vouch for. This issue asks
for _direct declarations and their resolved versions_, and that is what is
produced.

Lockfile positions come from the `yaml` package's `LineCounter` and from the same
TypeScript JSON AST the manifest parser uses. A resolved version cites the line
the `version:` scalar is on, which is a real answer to the issue's question — "why
do you believe this resolved to 8.17.1?" — and it is the only kind of answer that
is checkable.

A workspace dependency (`"@repo/api": "workspace:*"`) whose target package is
**discovered** is an internal `package` target: the edge stays `package-depends-on`
and the target is a package node, not an `external-dependency` one. If the target
package is **not** discovered, the edge survives with a `package-depends-on`
target that is an `external-dependency` node named `@repo/api` and a
`targetMissing: true` field. The edge is not deleted and the target is not
invented: the declaration was observed, the target was not found, and both are
true.

### 16. Import-to-dependency consistency is _structure_, not judgement

Once both edge families exist, the snapshot can show that `src/x.ts` imports
`ajv` and `package.json` declares it, or that `src/x.ts` imports `left-pad` and
`package.json` does not. That comparison is **published as structure, not as a
verdict**:

- The import edge and the dependency edge are separate objects with separate
  provenance. Nothing merges them.
- No diagnostic says "undeclared dependency". An external package may legitimately
  arrive through a peer dependency, an optional dependency, a workspace parent's
  `node_modules`, a platform built-in, or a repository that expects a hoisted
  install. Calling it an error would be a false positive that teaches users to
  ignore the feature.
- Node built-ins are classified **before** any such comparison, so `node:path`
  never appears as an undeclared npm dependency.
- A declared dependency that nothing imports is **not** an error either. It is
  extremely common — a `bin`, a peer, a type-only consumer, a test helper — and
  flagging it would be the mirror-image mistake.

The graph is the evidence. Deciding what the evidence means is a later consumer's
job, and this project has decided three times already that a repository model
which judges is a repository model that is wrong by opinion.

### 17. Ownership: what CODEOWNERS is, and the supported subset

A **CODEOWNERS** file is the supported, deterministic statement of who is
responsible for which path. Git history, `git blame`, commit authors, and
"top contributor" are **not** ownership and are not consulted; there is no Git
invocation anywhere in graph construction.

**Locations**, and precedence, follow the upstream rule exactly:

```text
.github/CODEOWNERS   ← wins if more than one exists
docs/CODEOWNERS
CODEOWNERS           (repository root)
```

`.gitlab/CODEOWNERS` and every other location are not searched. Files are **never
merged**: upstream semantics say one location wins, so one location wins, and a
repository with both `.github/CODEOWNERS` and `docs/CODEOWNERS` is reported as
having one ownership surface (the winning file) rather than a synthetic union
nobody wrote.

Ownership is evaluated for **module** and **package** nodes. It is _not_
evaluated for `external-dependency` nodes, because "who owns `ajv`" has no
repository answer — its declaration is in this repository's manifest, not in a
code path anyone owns.

Packages are matched on their **`package.json` path**, not their directory and not
their name. A package's identity in this model is its manifest file; a
`CODEOWNERS` rule about `packages/api/**` and one about `packages/api/package.json`
are then evaluated against a real path with real semantics.

**The supported pattern subset** is deliberately small, and anything outside it is
surfaced rather than approximated:

| Pattern feature                               | Supported | Notes                                                     |
| --------------------------------------------- | --------- | --------------------------------------------------------- |
| literal path, no wildcard                     | yes       | matches that file, or that directory and everything in it |
| trailing `/` (directory-only)                 | yes       |                                                           |
| leading `/` (anchored to the repository root) | yes       |                                                           |
| `*` — any run of characters except `/`        | yes       |                                                           |
| `**` — any run of characters including `/`    | yes       |                                                           |
| `?` — exactly one character except `/`        | yes       |                                                           |
| pattern with no `/` — matches at any depth    | yes       | as upstream gitignore-derived semantics describe          |
| `[abc]`, `[a-z]` character classes            | **no**    | `DISCOVERY_FACT_UNSUPPORTED` with the pattern and line    |
| leading `!` negation                          | **no**    | a CODEOWNERS file is not a `.gitignore`                   |
| extglobs `+(…)`, `?(…)`, `*(…)`, `@(…)`       | **no**    |                                                           |
| backslash escaping                            | **no**    |                                                           |
| `**` as a whole path segment (`a/**/b`)       | yes       | matches zero or more intermediate segments                |

A pattern matching a **directory** applies to everything inside it, which is what
upstream semantics say and what makes `/src/payments/` work.

This is a documented subset and **not** a claim of full CODEOWNERS compatibility.
The rules are implemented in their own module, not by reusing `globMatch.ts`,
because a `.gitignore`-style matcher and ADR-0005's contract-path matcher have
different anchoring, different directory semantics, and different `!` behaviour.
Reusing one and calling it compatibility would be a claim this implementation
cannot make.

A rule whose pattern is unsupported is **skipped**, not guessed at, and raises one
`DISCOVERY_FACT_UNSUPPORTED` naming the file, the line, and the pattern. Supported
rules in the same file keep applying: one exotic line must not delete the
twenty ordinary ones beside it. That is ADR-0046 §7's failure boundary, applied to
a different document.

### 18. Last-match wins, and multiple owners are all kept

Rules are evaluated in **file order**, and the **last matching rule** determines
the owner set — the upstream rule, implemented exactly:

```text
/src/*           @org/default
/src/payments/*  @org/payments
```

`src/payments/service.ts` is owned by `@org/payments`, because both rules match
(both by the directory-prefix rule and by direct match) and the later one wins.
`src/api/service.ts` is owned by `@org/default`. Neither result is a merge and
neither is a union of matching lines; a consumer that wants to know that _two_
rules matched reads the file.

Every owner token on the winning rule produces its **own `owned-by` edge** with
that rule's line as provenance. `/src/payments/* @alice @org/payments` is two
edges, not one edge with a chosen owner, and not an "primary owner". Choosing
between two declared owners is precisely the ranking this project refuses.

Owner **tokens are preserved exactly as written**, including `@org/payments` as a
whole and a bare `alice`. Agent-Ready does not validate them against a registry,
does not normalise case, and does not know what a team is. `owner:@org/payments`
is a declaration, and `docs` is a declaration.

### 19. `unowned` is a state, and its provenance is stated honestly

This is the design tension named in the Context, resolved.

```ts
type OwnershipState =
  { status: "owned"; ownerIds: readonly string[] } | { status: "unowned"; policy: OwnershipPolicy };

type OwnershipPolicy =
  | { status: "evaluated"; source: string } // a CODEOWNERS file was searched; no rule matched
  | { status: "absent"; source: null }; // no supported CODEOWNERS file exists
```

There is **no `owner:UNOWNED` node and no sentinel owner**. `unowned` is a state,
not a person, and a node named `UNOWNED` would put a fabricated team in the graph
and make it traversable.

The provenance of an `unowned` module is the **module's own** `SourceLocation` —
the file's line 1, which genuinely supports the claim "this module exists and
therefore has an ownership state" — plus the policy branch saying **which document
was searched and whether it was there**. A consumer can answer "how do you know
this is unowned?" with: "I found `src/foo.ts` at line 1, I searched
`.github/CODEOWNERS`, and no rule matched it." Every one of those is a real,
inspectable thing. None of them is a fabricated line.

When **no** supported CODEOWNERS file exists, `policy.status` is `"absent"` and
every module and package is `unowned`. This is a **successful, complete** result,
not a failure: a repository without a CODEOWNERS file has an ownership surface of
zero rules, and reporting that honestly is more useful than inventing a default
owner. `graph.ownership.surface` carries `absent` / `present` / `unreadable` /
`unsupported` at the snapshot level so the distinction is readable without walking
every node.

### 20. Bounds, and truncation is always visible

Module graph construction introduces traversal and parsing, so it is bounded by
**code constants** — not configuration, not per-repository tuning, and not
quality knobs. A repository cannot make discovery expensive by being large.

| Constant                        | Value      | Protects                                            |
| ------------------------------- | ---------- | --------------------------------------------------- |
| `MAX_SOURCE_DEPTH`              | 12         | fallback directory walk depth                       |
| `MAX_SOURCE_ENTRIES`            | 2000       | fallback entries enumerated                         |
| `MAX_SOURCE_FILES`              | 2000       | files admitted to the module universe               |
| `MAX_SOURCE_FILE_BYTES`         | 1,000,000  | one source file, mirroring ADR-0045's manifest cap  |
| `MAX_TOTAL_SOURCE_BYTES`        | 32,000,000 | total parsed source, so many large files cannot win |
| `MAX_IMPORTS_PER_FILE`          | 500        | one file's import declarations                      |
| `MAX_GRAPH_NODES`               | 5000       | graph size                                          |
| `MAX_GRAPH_EDGES`               | 20000      | graph size                                          |
| `MAX_UNRESOLVED_IMPORT_DETAILS` | 20         | examples in the _human_ rendering only              |

When a bound is reached:

- collection stops **deterministically**, having already sorted the inputs by
  code-unit, so _which_ files survive never depends on directory enumeration order;
- `graph.complete` becomes `false` and `graph.truncated` names the bound;
- a `DISCOVERY_PARTIAL` warning names the bound, its value, and what was lost;
- the graph is still emitted. A truncated graph that says it is truncated is more
  useful than no graph.

An oversized source file is a **local** condition, not a global one: the file is
not parsed, its module node is absent, a `DISCOVERY_PARTIAL` names it, and every
other file in the repository is unaffected. ADR-0045 §9's failure boundary,
unchanged.

### 21. `validateGraph` is an internal defect detector, not a linter

The graph is validated by a **pure function** that takes a graph and returns a
list of violations. It is not a graph database, not a service, and not a
persistence layer; it runs once, in memory, and its result becomes one diagnostic.

The invariants, each with a test:

- node ids are unique; edge ids are unique;
- every edge `source` names an existing node;
- every **resolved** edge `target` names an existing node;
- every **unresolved** edge has no target, and has a `specifier` and a `reason`;
- every node and every edge has provenance whose `source` is repository-relative
  (no absolute path, no `..` escape, no leading `/`);
- every provenance `line >= 1` and within the file's line count;
- edge `kind` and `resolution` values are members of the declared unions;
- no `owned-by` edge exists for a node whose `ownership.status` is `unowned`, and
  every node whose status is `owned` has at least one `owned-by` edge;
- collections are in code-unit order.

A violation is `DISCOVERY_GRAPH_PROVENANCE_INVALID` at **error** severity, which
is the one place in discovery where an error is correct. Every other condition in
this record — an unresolved import, an unsupported pattern, a truncated walk — is
**repository or model information** and is a warning. A graph that cites a line
which is not in the file is not a messy repository; it is a bug in Agent-Ready,
and `resolveExitCode` keys on `error` severity alone, so the command fails
loudly rather than shipping an artifact it cannot stand behind. The two are never
conflated, and neither is ever reported as the other.

### 22. Nothing is persisted, and no new command exists

`discover` remains read-only. No `.agent-ready/` directory, no `graph.json`, no
cache file, no database, no MCP resource, no HTTP endpoint, no query language. The
graph exists in memory for one discovery run and is serialised into the snapshot;
a user who wants a file writes the JSON themselves. Issue #41 owns persistence
and query surfaces, and #40 owns stability; this issue owns neither.

No `agent-ready graph` command is added. Phase 1 is one repository-discovery
surface, and a second command returning a subset of the first would give a
consumer two interfaces to reconcile.

## Amendments to ADR-0044

1. **The graph is a top-level snapshot field, not a fact.** ADR-0044's model is a
   map of facts whose evidence is a bounded, corroboratable set of claims per
   conceptual property. A graph's evidence is one entry per node and per edge —
   thousands of paths from one inspection — which the ADR-0045 evidence budget
   exists to prevent and which cannot be compressed without losing per-item
   provenance. So the graph is `snapshot.graph`, a sibling of `snapshot.facts`, and
   `FACT_IDS` is **unchanged**. The fact vocabulary, the merge, the corroboration
   rules, and the conflict/incomplete trichotomy are all untouched, and every graph
   item carries its own epistemic label (below).

2. **A new provenance type, scoped to the graph.** `SourceLocation` is additive and
   is used by graph nodes and edges. `Evidence` keeps its ADR-0044 shape, so no
   ADR-0044/45/46 fact is retrofitted with a line it never claimed to have. The
   invariant is scoped exactly as Issue #39 requires: _every graph node and every
   graph edge_ has a repository file and a line.

3. **Two diagnostic codes are added, both `DISCOVERY_`-namespaced.**
   `DISCOVERY_IMPORT_UNRESOLVED` (warning) names an import declaration that
   resolved to no in-repository target — repository information, and the
   "surfaced rather than swallowed" requirement made visible. And
   `DISCOVERY_GRAPH_PROVENANCE_INVALID` (error) reports a graph that violates its
   own invariants, which is an Agent-Ready defect and the only non-warning this
   issue adds. Resolver _reasons_ are structured data on the edge, not codes: a
   code per reason would be a code per vocabulary synonym.

## Consequences

- The question "what imports what, who depends on whom, and who owns this file?" is
  answerable from a deterministic snapshot, and **every part of the answer cites a
  line**. `src/server.ts:14` is why the two are connected; `package.json:69` and
  `pnpm-lock.yaml:13` are why a dependency is `^8.17.1` and `8.20.0` respectively;
  `.github/CODEOWNERS:9` is why a file is owned.
- A repository with a deleted-but-still-imported file, an undeclared external
  import, a manifest/lockfile disagreement, an unowned module, and an unsupported
  resolver case all produce **visible, named, located** output instead of silence.
  That is what makes the graph a measurement rather than a decoration.
- `unknown` and "cannot be established" stay first-class. An unresolved import has
  a `specifier`, a line, and a reason; an unowned node has a policy branch; a
  dependency with no lockfile has `status: "no-evidence"`. The graph never replaces
  an absence with a plausible value.
- The snapshot grows substantially and stays `snapshotVersion: 0`. That is
  consistent: `0` means unstable, and the field-stability statement and conformance
  corpus are Issue #40's.
- A repository with a bundler-specific alias, a Yarn lockfile, `dist/` in its
  source universe, or a CommonJS `require` gets **unresolved** or **unsupported**,
  where an earlier tool would have emitted a plausible edge. That is a real cost and
  it is the accepted one: a smaller vocabulary that is never wrong beats a larger
  one that is usually right.
- Discovery's read cost rises from a bounded root-level probe set to a bounded
  source walk. The bounds in §20 are what keep that cost predictable, and
  `summary.complete` is what keeps a consumer from believing it got everything.
- `typescript` and `yaml` are now used by `discover` as well as by the build. Both
  were already runtime-relevant (`yaml`) or already a dependency (`typescript`); no
  new dependency is added, and no new capability reaches a probe — the graph runs
  through the same read-only `DiscoveryProbeContext` as every other probe.

## Dogfooding on Agent-Ready

The graph was built against this repository, which is the acceptance criterion
Issue #39 states directly: _a graph built from this repository demonstrably has a
defect, and the defect is either fixed or documented as a known limitation._

At the shipped commit the graph is 163 nodes and 977 edges — 815 import, 16
dependency, 146 ownership — over 145 source files selected by `tsconfig.json`
under `moduleResolution: NodeNext`, with 16 of 16 dependencies resolved from
`pnpm-lock.yaml`, 0 unresolved imports, and the ownership surface resolved to
`.github/CODEOWNERS` with 10 rules. No diagnostic is emitted. Two samples of real
provenance, both checkable by opening the file:

| Claim                                                                 | Citation                                    | What is on that line                                             |
| --------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `dependency:@eslint/js` was declared                                  | `package.json:76`                           | `"@eslint/js": "^10.0.1",`                                       |
| …and resolved to                                                      | `pnpm-lock.yaml:26`                         | `version: 10.0.1(eslint@10.7.0)`                                 |
| `scripts/regenerate-discover-fixture.ts` imports the discover command | `scripts/regenerate-discover-fixture.ts:15` | `import { runDiscover } from "../src/cli/commands/discover.js";` |
| …and that module is owned by                                          | `.github/CODEOWNERS:1`                      | `*  @AdamEddahmouni`                                             |

Four defects were found this way. Three were in the implementation and are fixed;
one is a property of the repository and is published rather than repaired.

### Defect 1 — the repository root was never listed (fixed)

`createProbeContext` built every absolute path as `joinPath(repoRoot, relative)`.
The repository root's own repository-relative path is `"."`, so listing the root
asked for `/repo/.`. A real `readdir` tolerates the trailing `/.`; a strict
boundary does not, and `safeList` cannot distinguish "threw" from "absent" without
a `stat` that also fails. The result was that the source walk returned **nothing**
for any repository with no usable `tsconfig.json` and no workspaces — silently,
producing a complete, empty, `complete: true` graph.

This is the same class as the relative-`startDir` defect this issue already fixed
in `resolveRepositoryRoot`: a root that is nominally correct and operationally
wrong. The fix routes every relative path through one `absoluteFor` helper, so
the special case exists in exactly one place.

### Defect 2 — a three-character declaration extension was sliced wrong (fixed)

`sourceExtensionOf` recognised `.d.ts`, `.d.mts` and `.d.cts` and then returned
`name.slice(name.length - 5)`. A fixed offset is only correct for a
two-character extension, so `.d.mts` reported `d.mts` and `.d.cts` reported
`d.cts` — extensions no exclusion list matches. The effect would have been to
put declaration files into the module universe as though they were code, which
is precisely what §11 of this record forbids. The compound extension is now
sliced by its own length from an explicit list.

### Defect 3 — a trailing newline counted as an extra line (fixed)

`LineIndex.lineCount` returned one more than a person would count for a file
ending in `\n`, contradicting its own documentation. The count is the validator's
**upper bound** for a citation, so the phantom line let a citation onto a line
that exists in the arithmetic and not on disk. `jsonSource` and
`packages/manifest` each had their own copy of the same rule; all three now
delegate to one `countLines`, because a per-caller count that disagreed by one
would be invisible.

### Defect 4 — ten declared devDependencies are imported by nothing (published)

`@eslint/js`, `@types/node`, `@types/semver`, `eslint`,
`eslint-config-prettier`, `globals`, `prettier`, `tsx`, `typescript-eslint` and
`vite` are declared in `devDependencies` and appear in no `import` declaration
anywhere in `src/` or `scripts/`. They are invoked through `pnpm` scripts and
through tooling configuration rather than through module imports.

This is a **true statement about the repository, not a defect in it**, and it is
the clearest demonstration of why the declared/resolved split matters: the graph
can now be asked "what does this repository say it depends on?" and "what does
it actually import?", and the two answers differ. No diagnostic is emitted,
because nothing here is wrong — a tool's devDependencies legitimately have no
imports. It is a visible, located, checkable difference, which is the outcome
this record exists to enable.

There are no undeclared external imports, and no import in the repository fails
to resolve.

## Amendments discovered while implementing

Four refinements to the decisions above, all forced by an implementation detail
that the decision did not anticipate. Each is narrower than the rule it
refines.

5. **A root lockfile is read, within a byte cap.** §14 requires a resolved
   version to cite a line, and a line requires contents — but ADR-0045
   deliberately _stat-ed_ lockfiles precisely so discovery's cost would not scale
   with install state, and a lockfile is the largest document discovery has
   agreed to read. The change is accepted because it is bounded three ways and
   published in each: only the repository root's own lockfiles (a member's is
   still only stat-ed, because it is evidence about that member), only the two
   filenames this version models, and only under `MAX_LOCKFILE_BYTES` (8 MB),
   checked before parsing. Declared dependencies are unaffected by a refusal, so
   a lost lockfile costs resolved versions and nothing else.

6. **The repository root's own relative path is `""`-free.** `REPOSITORY_ROOT`
   is `"."` throughout, and `"."` must resolve to the root itself rather than to
   a `.` appended to it. See Defect 1. This is a property of the path boundary
   rather than of the graph, but the graph is what made it visible.

7. **The built-in module list is supplemented.** §12 classifies a Node built-in
   as a `platform` resolution with no target node, because the runtime provides
   it and no repository file declares it. Sourcing the names from
   `module.builtinModules` alone is not sufficient: that list omits documented
   and available modules, `node:test` most importantly, and the consequence
   would be an `external-dependency` node for something no manifest declares. A
   short explicit supplement is used rather than a rule, because "anything
   unresolvable is a built-in" is a guess dressed as a classification.

8. **One unresolved-import warning per run.** §21 makes an unresolved import a
   warning. Emitting one per occurrence is right for a condition that names a
   specific path and line, and wrong for one that is a property of the whole
   repository: a monorepo whose dependencies are simply not installed would
   produce thousands of warnings and train every consumer to ignore the code. The
   warning is therefore aggregated — the total in `metadata.unresolved`, a
   bounded sample in `detail` with the sample stated as a sample, and the edges
   themselves remaining the complete per-item record. A truncated list is never
   presented as a complete one.

## Reconsideration trigger

Reconsider the **source universe** if a real corpus shows that most TypeScript
repositories in scope have no usable `tsconfig.json` and carry a build output
directory the fallback walk would then enumerate. The honest response is a
narrow, explicitly documented exclusion rule with its own decision — not a
`"dist"`-looking heuristic and not a growing ignore list.

Reconsider **CommonJS `require`** if a corpus shows enough `require` in `.ts`
files to matter. The edge shape already exists; only the `syntax` member and the
resolution rule would change, and that is why the refusal here is cheap.

Reconsider **`exports`/subpath resolution** when a consumer needs module-level
edges into workspace packages rather than package-level ones. The `package`
resolution variant is the honest intermediate, and it was chosen to be upgradable
to a `module` variant without changing the edge's identity.

Reconsider **semver satisfaction** when a consumer needs to know a resolved version
violates a declared range. Both values are published verbatim, so the check is a
pure function over data this graph already emits, and it belongs in a consumer
rather than in the structural fact.

Reconsider the **two new diagnostic codes** if a third genuinely distinct
condition appears that none of `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_UNSUPPORTED`,
or the two here explains. Everything in this issue that does not fit those four is
structured data on an edge or node, and adding a fifth code for it would be a
code per vocabulary synonym.

Reconsider **persistence and query** on the terms of Issue #41 only. Nothing in
this record is a promise about them, and nothing here should be read as
constraining them.
