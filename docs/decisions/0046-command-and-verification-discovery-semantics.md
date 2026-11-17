# ADR-0046: Command and verification discovery semantics

## Status

Accepted

Amends [ADR-0045](0045-package-and-workspace-discovery-semantics.md) only where
named under [Amendments to ADR-0045](#amendments-to-adr-0045). Everything else in
[ADR-0044](0044-repository-discovery-model.md) and ADR-0045 stands.

## Context

[ADR-0044](0044-repository-discovery-model.md) built the discovery substrate.
[ADR-0045](0045-package-and-workspace-discovery-semantics.md) gave it the package
and workspace domain. What neither could answer is the question a contributor
actually arrives with first:

> **How do I verify this package?**

Today the answer lives in a maintainer's head, in a `CONTRIBUTING.md` paragraph
that drifted, or in a CI log line. This record decides what Agent-Ready is
allowed to say about it, and — at least as importantly — what it is forbidden to
say.

The domain is hostile to honesty in a specific way. These are all real
`package.json` scripts:

```json
{
  "scripts": {
    "abc": "vitest run",
    "deploy": "vitest run",
    "test": "echo not-a-test-runner",
    "posttest": "node scripts/notify.js",
    "linting": "eslint .",
    "check:types": "tsc --noEmit",
    "test:update": "vitest run -u"
  }
}
```

A reader — or a plausible-looking heuristic — will confidently conclude that
`abc` is the test suite, that `test` is not, that `check:types` is the
typechecker, and that `linting` is a lint command. Four of those conclusions are
manufactured. The script bodies are a shell payload; they are untrusted input
that can contain `&&`, `||`, subshells, here-docs, wrapper scripts, and aliases.

The tempting fix is to read the body and look for tool names. This record
rejects that, and the reasoning is the bulk of what follows.

The evidence already exists and is clean. A manifest _declares_ that a script
named `test` exists and _declares_ its exact body. ADR-0045 already established
that a package is a manifest, that a package manager is scoped to a manifest,
and that a repository's evidence is a set of facts with kinds, citations, and
explicit uncertainty. This issue consumes that machinery rather than extending
it with a parallel confidence system.

## Alternatives considered

### Classifying a command by parsing its body

The obvious approach, and the one every existing tool takes: run the body
through a shell-aware parser, or regex it for tool names, and map
`vitest`/`jest` → test, `tsc` → typecheck, `eslint` → lint, `vite`/`rollup` →
build. Rejected, and not because the technique is hard.

It is rejected because the technique **cannot be made trustworthy**, and the
issue's own acceptance criteria say heuristics that cannot be made accurate
enough to be trustworthy must be removed rather than shipped with a confidence
disclaimer. The reasons are structural, not presentational:

- **A command can wrap other scripts.** `"test": "npm run check && vitest run"`
  and `"test": "vitest run"` both mention tools; `"test": "node scripts/x.js"`
  may invoke anything and mention nothing. Tool presence is neither necessary
  nor sufficient.
- **Tools perform multiple roles.** `vite build`, `vite test`, and `tsc` are
  three uses of three programs that overlap. `node -e` is a test runner, a
  build step, and a linter depending on the string after it.
- **A string mentioning a tool need not be a command.** `"test": "npm test &&
deploy-production"` contains the token `npm test` and must not become a test
  entrypoint. A regex cannot see the operator.
- **The space is unbounded.** A wrapper script, an alias, a locally vendored
  runner, or a four-stage pipeline means the evidence lives in a file this issue
  is not reading. A heuristic that is right 90% of the time and _silently wrong_
  the other 10% is worse than a smaller vocabulary that is never wrong.

A confidence score does not repair this. It converts a false statement into a
false statement with a number attached, and it makes the number the part
consumers read. ADR-0044 forbids confidence fields; nothing in this record
introduces one.

### Inferring commands from dependencies and config files

`vitest` in `devDependencies` is very strong evidence that _something_ runs
vitest. It is no evidence that the repository exposes a `test` script, that
vitest is wired up, or that it is the contributor entry point — packages are
installed for CI, for a transitive tool, or for a one-off script. Likewise
`vitest.config.ts` proves a file exists, not that `pnpm test` is how anyone runs
it. Rejected as a classification input on both counts: a dependency is a
dependency declaration, and a config file is a config file. Neither is an
interface. (Both may become useful facts in a later issue; neither may become a
_role_ here.)

### Parsing CI workflows

`.github/workflows/*.yml` genuinely contains `run: pnpm lint && pnpm test`, which
is real evidence about what CI executes. Modelling it means modelling a shell
and a CI expression language, and the derived answer would be about _CI_, not
about the contributor-facing interface. Rejected for this issue. #38 discovers
**declared package commands**; CI execution semantics are a different problem
with different failure modes and deserve their own decision.

### One fact id per script, or per package-and-role

`repository.command.test`, `repository.commands.packages.api.test`, and so on.
Rejected for the reason ADR-0045 §1 rejected a fact id per package: the `FactId`
union is a reviewable, finite vocabulary, and an id generated from repository
content cannot be reviewed. It would also make the vocabulary grow without
bound on exactly the repositories discovery exists to serve. Entity identity
lives in the value, addressed by `packagePath` and `name`.

### A separate `agent-ready commands` CLI subcommand

Rejected. Phase 1 is building one repository model; a command per fact
fragmentation would give a consumer two CLIs to join back together, and the
snapshot is the interface. #94 of the issue asks for `discover` and
`discover --json` only, and that is what this record ships.

### A confidence-ranked "recommended command"

Rejected outright. `test:unit` and `test:integration` are two test entrypoints;
choosing one is a guess dressed as a default. Where the repository declares an
exact base name, that identity is used — not because it scored better, but
because the maintainer wrote it.

## Decision

### 1. A command is a declared package script, and only that

A **command** is one key/value pair in a package manifest's `scripts` object,
scoped to the package that declares it. Nothing else is a command: not a CI
step, not a dependency, not a config file, not a Makefile target, not a script in
a shell profile, not a composer/`pyproject`/`Cargo` entry.

**The source of record is the manifest.** The establishing evidence is the
manifest path plus a precise JSON Pointer:

```text
source:  packages/api/package.json
pointer: /scripts/test
```

A bare `package.json` citation is not sufficient where a pointer exists,
because "which field of which file" is the difference between a re-derivable
claim and an unfalsifiable one.

**Commands are package-scoped.** A root `test` and a `packages/api` `test` are
two declarations by two packages. They are not competing values for one
repository-wide fact, they are never deduplicated across a package boundary, and
neither contradicts the other. Repository-wide agreement is never computed,
because "the repository's test command" is not a question with one answer.

**Command scope is closed-world, inherited from ADR-0045 §5.** Commands are
discovered for the root manifest and for manifests established through supported
workspace discovery. A `package.json` under `tools/internal/` that no
declaration reaches has no commands in the snapshot, for the same reason it has
no package: an unbounded search for manifests is a performance decision with no
epistemic benefit. This is a deliberate inherited boundary, documented, and not
an oversight. Command discovery is **downstream of** package discovery and never
re-walks the repository.

### 2. A command body is an opaque declared payload

The body is stored **exactly** as the repository declared it. No normalization,
no trimming of internal whitespace, no splitting on shell operators, no
canonicalization of executables, no quoting, no reordering. `"pnpm lint && pnpm
test"` is one string and stays one string.

This is not merely a formatting preference. Normalizing a shell body requires
knowing the shell, and knowing the shell means modeling it — which is the
excluded alternative above. An exact string is verifiable against the file; a
"normalized" one is a claim about what it meant.

Escape sequences introduced by JSON serialization are serialization. The
semantic value is the declared string.

Bodies are never passed to a shell, `eval`, `spawn`, `execFile`, or `Function`.
Not in production, and not in tests. A manifest is untrusted input, and a
declaration is a fact about a string, never an instruction to run it.

### 3. The role grammar is a name grammar, and it is the whole grammar

A **role** is assigned from the script's **name** and nothing else. The grammar
is:

```text
name  := ROOT | ROOT ":" SUFFIX
SUFFIX := one or more further ":"-separated segments
ROOT  := "test" | "build" | "lint" | "typecheck"
```

Matching is anchored, exact, and mechanical. There is **no substring matching**,
no case folding, and no synonym table. A name that does not fit the grammar has
no role; that is a known fact about the declaration, not a diagnostic.

The grammar is deliberately tiny, because the issue's criterion is that a role
must never be _wrong_ and the cheapest way to guarantee that is to have almost
no room to be wrong. Consequences, each pinned by a test:

| Name                                 | Role            | Why                                                |
| ------------------------------------ | --------------- | -------------------------------------------------- |
| `test`                               | `test`          | exact root                                         |
| `test:unit`                          | `test`          | namespaced into the `test` family                  |
| `test:snapshots:update`              | `test`          | any depth of suffix stays in the family            |
| `build`, `build:prod`                | `build`         | namespaced                                         |
| `lint`, `lint:ci`, `lint:fix`        | `lint`          | namespaced                                         |
| `typecheck`, `typecheck:strict`      | `typecheck`     | namespaced                                         |
| `pretest`, `posttest`                | _(none)_        | a lifecycle hook is not itself the entrypoint      |
| `contest`, `testdata`, `testing`     | _(none)_        | a different word that contains `test`              |
| `rebuild`, `builder`                 | _(none)_        | a different word that contains `build`             |
| `eslint`, `linting`                  | _(none)_        | a different word that contains `lint`              |
| `types`, `check:types`, `type-check` | _(none)_        | not in the root set; see below                     |
| `test:`                              | _(none)_        | the suffix is empty, so the grammar does not apply |
| `test:build`                         | `test` **only** | one role, chosen by the grammar; never two         |

**Aliases are not supported.** `type-check`, `check-types`, `typecheck:ci`'s
cousins, and `tsc` are unrecognised. An alias table is a synonym dictionary that
grows by accretion — someone adds `type-check` for one repository, then
`types:` for another, and the "narrow deterministic grammar" becomes a lookup
table whose entries are each a small guess. The cost of refusing is real and is
accepted: a repository using `check:types` is reported as declaring a command
with no recognised verification role, which is **true**, and a consumer can see
the name. If alias support is ever justified it needs its own decision with its
own adversarial matrix, not a line added during implementation.

**`verify` is not a role.** A `verify` script's meaning is entirely in its body,
which §2 makes opaque, so a `verify` role would be the one role in the grammar
that asserts something about meaning rather than about a name. It is refused for
the same reason body-parsing is refused.

**One name, at most one role.** A prefix grammar cannot produce two roles from
one name, and nothing tries to: `test:build` is `test`, because that is what the
grammar says. Splitting a name across two families would be interpretation.

Roles are a **projection**. The declaration stays authoritative: a `test:unit`
entry keeps `name: "test:unit"` and its exact body. The role is a label
computed over the name, never a replacement for it.

### 4. Role and suitability are different concepts, and only role is claimed

`lint:fix` is unambiguously in the `lint` namespace and unambiguously likely to
modify files. Both of those follow from the **name** — one from the grammar, one
from the ordinary meaning of the word "fix" — and Agent-Ready claims the first
and does not claim the second.

So a single boolean, `primary`, is published per entry, and it means exactly one
thing: **the script's name is exactly equal to the role root.** Not "safest",
not "recommended", not "first".

```text
test                → role test,    primary: true
test:unit           → role test,    primary: false
test:integration    → role test,    primary: false
```

When both exist, the base name is distinguishable from the namespaced ones by
**exact declared identity**, which is a deterministic rule rather than a
ranking. When only namespaced ones exist, none is primary and all are reported;
picking one would be the guess this issue exists to prevent. Within a role,
ordering is code-unit and carries no meaning. "Is it safe to run" is not answered
here and is not answered by anything in this record.

### 5. "Verification surface" is defined, and it has exactly two parts

A **verification surface** is a set of entrypoints through which a package's work
might be checked. It is defined as the disjoint union of:

- the **package verification surface** — declared package scripts that the role
  grammar recognised (`test`, `build`, `lint`, `typecheck`), with a structured
  invocation where one could be derived; and
- the **Agent-Ready verification surface** — the `verification.required` list of
  a valid `agent-ready.yaml`, which is _author-declared_ and kept strictly apart.

"Surface" is the load-bearing word. It names **what exists to be run**, never
whether anything passed, whether the tests are any good, or whether the package
is healthy. `build`, `test`, `lint`, and `typecheck` remain four distinct roles
and are never collapsed into a single "verifies" status: a build can succeed
while every test fails, and a snapshot that implied otherwise would be
asserting a runtime result it cannot have.

**A package with no recognised role scripts has a known-empty verification
surface.** That is emphatically _not_ a claim that the package has no tests — it
has no script this version recognises as one. The distinction is published, not
implied, and the human rendering never uses language that would collapse it.

"Package verification surface" is also the reason the two facts below are not one.
`repository.commands` answers _what does this package declare_;
`repository.verificationEntrypoints` answers _which of those declarations carry a
recognised role, and how could they be invoked_. A command with no role belongs
to the first and not the second, and that asymmetry is the point — an unknown
semantic role is not an unknown command.

### 6. The Agent-Ready contract contributes an author-declared surface, and nothing else

`verification.required` is an **ordered list of command names the maintainer
declared**. It is published on its own fact, with `kind: "author-declared"`,
cited to `agent-ready.yaml` and `/verification/required`.

**Order is preserved exactly.** Verification sequence ordering is source
semantics — a maintainer who lists `lint` before `test` has said something — and
sorting it alphabetically would destroy a declaration in the act of reporting
it. This is a real difference from the derived collections, which are sorted
because their order is not meaningful.

Three rules make the separation hold:

1. **It never overwrites, and never becomes repository truth.** A contract
   naming `test` does not make a `test` script exist. If no package declares a
   `test` entrypoint, both facts stand unchanged and the disagreement is
   visible — that is information for a later drift check, and **not** an error in
   this issue. Discovery is not a linter.
2. **Repository-derived command facts are byte-identical with and without a
   contract.** This is the equivalence test that keeps the later benchmark
   honest: a maintainer's description of the repository must not change the
   model's account of the repository. A repository plus a contract that makes no
   verification claims adds nothing.
3. **A contract never selects an executable.** A maintainer claiming `pnpm` in
   `agent-ready.yaml` does not mint `pnpm run test` when the repository's own
   manager evidence is unknown. Author claims are not evidence about the
   repository; §8 requires repository evidence. This is what ADR-0045 §4 already
   requires of every other `author-declared` claim, and command discovery
   inherits it rather than carving out an exception.

An **invalid or absent contract contributes nothing.** It is never a reason for
command discovery to fail or degrade, and it never removes a fact.

### 7. `scripts` degrades per entry, and per package — never silently

Four states, all of them real, none of them collapsed into another:

| `scriptsStatus` | Meaning                                                             | Commands reported                        |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `declared`      | the manifest parsed and `scripts` is a JSON object                  | every string-valued entry, possibly none |
| `absent`        | the manifest parsed and has no `scripts` key                        | none — **known empty**                   |
| `unsupported`   | the manifest parsed and `scripts` is present in a form not modelled | none, and not claimed empty              |
| `unobservable`  | the manifest is malformed or unreadable, so it was never inspected  | none, and not claimed empty              |

`{"scripts": {}}` and a manifest with no `scripts` key are **known empty**, not
unknown. "This package declares no scripts" is a fact, and reporting it as
ignorance would be a false negative.

A non-object `scripts` (`"test"`, `42`, `null`, `["a"]`) is **never coerced**. It
is `unsupported`, with the reason recorded, plus
`DISCOVERY_FACT_UNSUPPORTED`. The nearest shape that happens to fit is exactly
what this model refuses.

Within a `scripts` object, an entry whose value is not a string is reported in
`unmodelledScripts` with its raw JSON value, while **every string-valued entry
survives**. This is the narrowest defensible failure boundary: one entry with an
unusable value must not delete the twenty valid commands beside it in the same
object, and dropping valid entries while claiming a complete observation is the
thing that would be dishonest. The value is never coerced with `String(value)` —
that would publish `42`, `null`, and `[object Object]` as if the repository had
declared them as commands.

**An empty-string body is a valid declared command.** `{"scripts": {"noop": ""}}`
is a real, runnable, meaningless declaration, and it is reported with its empty
body. Truthiness testing would delete it.

One document yields **one** claim per fact, so `{"test": …, "build": …}` is not
two independent confirmations of anything; they are two fields of one manifest,
each cited by its own pointer. JSON duplicate-key handling remains the parser's
concern.

### 8. A structured invocation requires an agreed package manager, and there is no fallback

An **invocation** is a structured, shell-independent description of how a
contributor could run a command:

```json
{ "cwd": "packages/api", "executable": "pnpm", "args": ["run", "test"] }
```

Not `cd packages/api && pnpm run test`. The structured form is chosen because it
is cross-platform, has no quoting or path-escaping ambiguity, states `cwd` and
`argv` separately, and is directly consumable by the later Change Transaction
runtime. It is a **derived description** of an interface, not a transcript of
anything, and it is never executed.

`args` is always `["run", name]` for every manager. Per-manager shorthands
(`npm test`, `yarn test`, `pnpm test` without `run`) are not synthesised: the
shorthand set differs per tool and across versions, and `run <name>` is the one
form that means the same thing everywhere. Uniformity is preferred over
prettiness.

**Derivation rule, stated here rather than buried in a helper:**

1. Look up the **package's own** scoped package-manager fact — the same
   `repository.packageManager.<scope>` identity ADR-0045 established, for the
   directory that declares the command.
2. If it is an **agreed** fact, derive the executable from its manager name.
3. If it is `unknown` with reason `no-evidence` — nothing was declared and no
   artifact was found beside this manifest — **inherit** the root package's
   manager, under the same condition: agreed, else unresolved.
4. Anything else is **unresolved**, and each cause is named rather than merged:

| `invocationStatus`           | Cause                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `resolved`                   | an agreed manager was found; `invocation` is present                     |
| `package-manager-unknown`    | no manager evidence at this scope or the root, and no root declaration   |
| `package-manager-conflict`   | the applicable manager fact is a `ConflictedFact` — sources disagree     |
| `package-manager-incomplete` | the applicable manager fact is an `IncompleteFact` — retained, contested |

These four states are not a new partial-state system. They are ADR-0045's
existing trichotomy, spelled out at the point of use: `resolved` ↔
`AgreedFact`, `package-manager-conflict` ↔ `ConflictedFact`,
`package-manager-incomplete` ↔ `IncompleteFact`, `package-manager-unknown` ↔
`UnknownFact`.

Three properties of this rule are load-bearing:

- **No default.** There is no `npm` fallback, ever. Node's historical default is
  a fact about Node, not about this repository, and inferring it is exactly the
  manufactured knowledge this boundary exists to prevent (§23 of the issue, and
  ADR-0045 §3).
- **Package-local evidence wins, including when it is bad news.** A nested
  package with its own agreed `npm` is invoked with `npm` even when the root
  says `pnpm`; that is ADR-0045 §3's scoping rule applied to invocation. A
  nested package whose own manager is _contested_ does not fall back to the root
  — silence about the contested part is not absence.
- **Contested never becomes canonical.** An `IncompleteFact` carries a declared
  value precisely because other evidence contradicts it, so promoting that value
  to "the canonical executable" would resolve a disagreement by fiat. The
  declaration remains in its own fact, published with `contradictedBy`; the
  command body, name, and role remain known. Nothing is lost by refusing to mint
  an invocation, and the four-field result — _script known, role known,
  invocation unresolved, reason named_ — is a **successful** discovery outcome,
  not a failure.

`cwd` is the repository-relative package path (`.` for the root), so the same
repository at two checkouts produces byte-identical output and an absolute path
can never appear in the snapshot.

### 9. Malformed manifests propagate, and siblings survive

A manifest that is malformed or unreadable yields `scriptsStatus: "unobservable"`
for its package. Its commands are **not** reported as empty: absence of evidence
is not evidence of absence, and ADR-0045 §9's per-path failure boundary applies
unchanged. Every other package in the repository is unaffected — one broken
`package.json` never removes a sibling's commands, and never removes a
contested manager's _declarations_.

Symmetrically, a package whose manager cannot be resolved keeps its full command
inventory and roles, and only the invocation is absent. Blast radius is
minimised at every level: bad manifest, bad scripts shape, bad script value, bad
manager — each degrades exactly the thing it touches.

### 10. Fact identity, ordering, and version

Three conceptual facts are added. No id names an individual script or an
individual package, and no id is generated from repository content.

| Fact id                              | Kind              | What it is                                                                                 |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------ |
| `repository.commands`                | `declared`        | every declared package script, package-scoped, body verbatim, per-entry source and pointer |
| `repository.verificationEntrypoints` | `derived`         | the role-classified subset, with role, `primary`, and invocation status                    |
| `repository.contract.verification`   | `author-declared` | the contract's `verification.required`, in declared order                                  |

`repository.commands` is `declared` because script names and bodies are asserted
by a repository file and reproduced verbatim. `repository.verificationEntrypoints`
is `derived` because the role, the `primary` flag, and the invocation are all
computed by fixed rules in this codebase. `repository.contract.verification` is
`author-declared` because it is a human's description.

**These are projections of one source, not corroboration.** `repository.commands`
and `repository.verificationEntrypoints` both ultimately reference
`package.json#/scripts/test`. They are two views of one declaration, and a
consumer must not read them as one source confirming the other. They are
different facts with different kinds, so the merge cannot treat them as claims
about the same identity, and ADR-0045's one-document-one-source rule is untouched:
the _only_ multi-manifest fact is `repository.commands`, which contributes a
single claim whose evidence names each contributing manifest.

The value shape of `repository.commands` nests by package, because commands are
genuinely scoped to a package and flattening them into composite keys would
invent an identity the repository never wrote — while still making
"package C's inventory is unknown" inexpressible:

```json
[{ "packagePath": ".", "scriptsStatus": "declared", "commands": [ … ], "unmodelledScripts": [] }]
```

Ordering is code-unit throughout, using ADR-0045's single shared comparator, for
`packagePath`, then `script` name, then `unmodelledScripts` by name, and within
`repository.verificationEntrypoints` for `packagePath`, then role, then script.
A hand-maintained "role order" was considered and rejected: a snapshot is
deterministic because _one_ ordering rule governs it, and a second, bespoke rule
for one collection is a place where they will disagree. The human renderer
groups for readability; the canonical value does not.

`snapshotVersion` **stays `0`**, per ADR-0045 §10 and ADR-0040. This issue adds
fields, removes none, and changes no meaning; `0` already means unstable and
outside ADR-0009's promise. The bump is reserved for a change a consumer could
not survive.

The discovery API **stays internal**. `src/index.ts` exports nothing from
`src/discover/` and this issue does not change that.

### 11. New capabilities: none

`#38` adds **no** file-system capability. Command discovery consumes the
run-scoped layout memo ADR-0045 established, extended to carry each manifest's
script declaration; it never re-reads a manifest, never re-walks the tree, and
never creates a second package parser that could disagree with the first about
size limits, nesting, or failure semantics. The layout is the single place a
manifest is read and the single place a shape this version does not model is
observed and reported.

There is still exactly one bounded manifest parser, still under ADR-0045's byte
and depth caps, and still failing per manifest. Script volume is bounded by the
manifest size cap; no `MAX_SCRIPTS` constant is introduced, and no command is
ever silently dropped. A repository with a large dependency block and three
hundred scripts reports all three hundred.

**No probe receives a process runner, a shell, or a network client.** There is
nothing to add: the interface in `probe.ts` has no such member, and it does not
gain one. If a command could only be validated by running it, Agent-Ready does
not claim it was validated.

### 12. What this issue explicitly does not know

Published as a limitation rather than discovered later by a consumer:

- whether any command **succeeds**;
- whether the command named `test` **runs tests**, or the one named `build`
  produces correct output;
- whether a `lint:*` command **modifies files**;
- whether a script **calls other scripts** internally;
- whether **CI** invokes any of them;
- whether **dependencies are installed**, or installable;
- whether a namespaced script is a **variant, a superset, or unrelated** to its
  base name;
- what a **shell body does** — that is §2's whole point.

Agent-Ready knows the **declared interface**, not runtime results. The human
rendering uses "declared", "available", "entrypoint", and "invocation"; it never
says "passed", "verified", or "working", and never prints an executable it could
not derive.

## Amendments to ADR-0045

1. **The layout grows a script declaration.** ADR-0045's `DiscoveryLayout`
   carries package identity, workspace structure, and `packageManager` fields,
   and discards the rest of each manifest. #38 needs `scripts`, so the run-scoped
   representation gains a per-manifest script declaration. This is an extension
   of the one authoritative parse, made deliberately, rather than a second
   parser that might disagree about the first.

2. **An unmodelled-shape diagnostic gains a second subject.** ADR-0045 §3 made
   `DISCOVERY_FACT_UNSUPPORTED` reachable for a `packageManager` field that is
   not `<name>@<version>`, raised from the layout because that is where manifests
   are read. A `scripts` field in an unmodelled shape, and a `scripts` entry
   whose value is not a string, are the same condition at a different field, with
   the same remediation semantics — _this version does not model this shape_ — and
   are raised from the same place, by the same existing code, for the same reason.
   **No new diagnostic code is introduced.** A code whose remediation is
   identical to `DISCOVERY_FACT_UNSUPPORTED`'s belongs in that code's metadata,
   and four role-specific codes for four script values would be absurd.

3. **Corroboration is untouched, and a new caution is recorded.** No probe
   splits one document into more than one claim. The caution is that two
   _different_ facts projected from one declaration (`repository.commands` and
   `repository.verificationEntrypoints`) must not be read as mutual
   confirmation. They are different conceptual properties, so the merge never
   treats them as claims about one identity, but a consumer could still
   misread them, which is why §10 says so in the vocabulary's own record.

## Consequences

- The question "how do I verify this package?" is now answerable from a
  deterministic snapshot, per package, with a citation for every part of the
  answer: which script, why that role, which manager, which directory.
- The vocabulary gained three facts and lost none. `FACT_IDS` stays a reviewable
  list of conceptual properties.
- A repository whose test script is named `abc` is reported as declaring `abc`,
  with no test role, and the snapshot says nothing false about it. That is the
  single most important behaviour in this record: the previous failure mode was
  producing a confident wrong answer, and the fix is having fewer answers.
- Four honest outcomes replace one guessed one: resolved invocation,
  unknown manager, conflicted manager, contested manager. Three of the four are
  new reportable states, and all three are successes.
- An empty `scripts` object is now distinguishable from a manifest that could
  not be read — a distinction that was not expressible before, because the
  distinction did not exist until commands were in the model.
- Human output grew two sections. `discover` remains read-only, vendor-neutral,
  offline, and free of scores.
- No new dependency, no new capability, no new diagnostic code, no new CLI
  command, and no change to the v1 contract, the eleven shipped commands, the
  adapter corpus, or `verify --execute`.

## Reconsideration trigger

Reconsider the role grammar if real repositories are shown to name their
verification entrypoints so differently that the four roots classify almost
nothing. The correct response to that evidence is a new decision with an
adversarial matrix, **not** a synonym table added to this one — the value of the
grammar is that it is almost never wrong, and a synonym dictionary trades that
away for coverage.

Reconsider the invocation model if the later Change Transaction runtime needs a
shell string. It should be rendered _from_ the structured form by that runtime,
per platform, at execution time — not baked into the snapshot, which would put
POSIX quoting rules into a format that has to be byte-identical on Windows.

Reconsider `package-manager-incomplete` if it proves to be a common state that
consumers mishandle. A contested manager is a genuinely useful signal, and the
honest handling is what is published here; if consumers want a _candidate_
executable alongside it, that is a separate, explicitly non-authoritative field
with its own name, and it needs its own decision.

Reconsider the closed-world command scope on the same terms as ADR-0045's
package scope: repository-wide manifest coverage is an unbounded-traversal
decision with its own bounds and its own partial-failure story.

Reconsider per-entry script degradation if a real corpus shows manifests where
one invalid entry genuinely invalidates the whole `scripts` object. The current
rule keeps the valid entries, because dropping twenty good commands to report
one bad one honestly is a worse trade than reporting the bad one alongside them.
