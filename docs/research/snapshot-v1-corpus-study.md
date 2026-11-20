# Snapshot Format 1: external corpus study

**Issue**: [#40](https://github.com/AdamEddahmouni/agent-ready/issues/40) — stable JSON
snapshot and schema with conformance corpus.
**Date inspected**: 2026-09-27.
**Agent-Ready under test**: `0.6.1` at `4a4e2d7` (this branch,
`feat/vnext-snapshot-conformance`, which contains #36–#39 plus the three
corrections this study produced).
**Command**: `agent-ready discover --json --root <repo>`, against an unmodified
checkout. No install, no format, no fix, no write, no generated file, and no
`agent-ready.yaml` was added to any target repository.

This is a **research note, not policy**. The consumer-facing guarantees live in
[SNAPSHOT-STABILITY.md](../vnext/SNAPSHOT-STABILITY.md) and the decision itself
lives in [ADR-0048](../decisions/0048-discovery-snapshot-stability-and-conformance.md).
Nothing here is a compatibility promise. The purpose of this file is to let a
future maintainer check _why_ a field was classified stable or provisional, and
to make the conclusions reproducible rather than folkloric.

## Why this study existed

Issues #36–#39 were each developed and tested against fixtures their author
designed, and each shipped with its ADR. The corpus in `conformance/discovery/v1`
is derived from those fixtures. That is the right way to test a decision you have
already made and the wrong way to find out whether the decision survives contact
with repositories you did not choose.

So the sequence for #40 was inverted on purpose:

```text
real repositories → observed failures → classified → then decide what is stable
```

Freezing fields first and validating them afterwards would have produced a
schema that described the implementation, which is the outcome the issue
explicitly rejects.

## Method

Fifteen public, permissively-licensed, TypeScript-or-JavaScript-centred
repositories were cloned with `--depth 1 --single-branch` and inspected once
each, at the pinned revision below. Selection was by **semantic diversity, not
popularity**: the goal was to break assumptions, so the set deliberately includes
shapes Agent-Ready was not designed around — CommonJS, Yarn, no lockfile, no
`tsconfig.json`, committed build output, Rust/TypeScript hybrids, generated
`lib/` trees, and workspace roots nobody would guess.

Each repository was checked out to a scratch directory outside this project. No
third-party source is vendored here; the committed corpus contains only small
synthetic fixtures, some of which record what the real repository did.

Two runs of the three largest repositories produced **byte-identical** output,
which is the determinism guarantee the study also takes as evidence (§121 of the
issue).

## Evidence table

`snapshot` is whether a graph was published at all. `resolved` is resolved
dependency versions, out of declared dependency edges. Figures are **after** the
three corrections in `4a4e2d7`.

| Repository                                                                                    | SHA            | Why chosen                                                                  | Packages | Modules | Imports (unresolved) | resolved                 | snapshot  | Diagnostics | Finding class                                                                 | Implication for stability                                                                     |
| --------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- | -------- | ------- | -------------------- | ------------------------ | --------- | ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [sindresorhus/type-fest](https://github.com/sindresorhus/type-fest)                           | `e9f614f191aa` | single package, ESM, declaration files _are_ the source                     | 1        | 303     | 537 (0)              | 0/14 (no lockfile)       | published | 1           | **A — implementation defect** (64 provenance violations suppressed the graph) | `graph.provenance` cannot be stable until a citation means a line that exists                 |
| [nodejs/undici](https://github.com/nodejs/undici)                                             | `7bc9dd63523f` | no `tsconfig.json`, mixed JS/TS, `lib/` + `build/`                          | 1        | 682     | 3071 (2874)          | 22/22                    | published | 2           | **A** (15 violations) + **C** (`require` in `.js`)                            | as above; import resolution is near-useless for CommonJS                                      |
| [axios/axios](https://github.com/axios/axios)                                                 | `2426e03ba902` | single package, CJS+ESM dual, `package-lock.json`, CODEOWNERS               | 1        | 265     | 809 (113)            | 43/43                    | published | 1           | **A** (1 violation)                                                           | as above                                                                                      |
| [facebook/jest](https://github.com/facebook/jest)                                             | `202dd8a14777` | Yarn 4 workspaces, 40+ packages, no CODEOWNERS                              | 71       | 1108    | 3125 (534)           | 0/749 (Yarn unsupported) | published | 64          | **A** (5 violations) + **C** + **E**                                          | Yarn refusal is honest; diagnostic _volume_ is a real cost                                    |
| [vitejs/vite](https://github.com/vitejs/vite)                                                 | `9944fa603387` | pnpm workspaces, playground tree, 236 packages                              | 236      | 817     | 1282 (198)           | 43/382                   | published | 7           | **A** (5 violations) + **D** (`playground/` in the universe)                  | as above                                                                                      |
| [TanStack/query](https://github.com/TanStack/query)                                           | `1165a67a1434` | pnpm, 101 example apps, generated tsconfigs, CODEOWNERS                     | 102      | 224     | 623 (11)             | 285/938                  | published | 12          | **A** + **A (path leak)** + **C** (SvelteKit `$types`)                        | diagnostics must not carry checkout paths                                                     |
| [withastro/astro](https://github.com/withastro/astro)                                         | `d047b5c23c27` | nested workspace globs, 343 packages, `workspace:*` protocol                | 343      | 1106    | 2993 (313)           | 62/1247                  | published | 36          | **D** (33 workspace deps name a package no declaration reached)               | `targetMissing` earns its place; the boundary is published                                    |
| [typescript-eslint/typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | `0bbe5e74e234` | `workspaces` **object** form, multi-tsconfig, 1 CODEOWNERS rule             | 20       | 557     | 1423 (3)             | 203/319                  | published | 22          | **A** (multi-document lockfile)                                               | both workspace declaration forms work                                                         |
| [pnpm/pnpm](https://github.com/pnpm/pnpm)                                                     | `bb13fb9f5d39` | 232 packages, `pkg/`-style layout, Rust+TS, catch-all CODEOWNERS            | 232      | 735     | 3832 (102)           | 54/3090                  | published | 216         | **A** (lockfile) + **E**                                                      | the project's own package manager is a first-party case; per-package diagnostics do not scale |
| [biomejs/biome](https://github.com/biomejs/biome)                                             | `6ed93b00ee07` | Rust/TS hybrid, no root `tsconfig.json`, fixture packages                   | 20       | 23      | 52 (8)               | 9/52                     | published | 3           | **A** (lockfile) + **E**                                                      | bounds behave as documented                                                                   |
| [nestjs/nest](https://github.com/nestjs/nest)                                                 | `b58554ea5857` | npm workspaces **plus 20+ `sample/*` manifests outside every declaration**  | 10       | 1193    | 4202 (88)            | 154/177                  | published | 2           | **D** — the closed-world package scope is visibly surprising                  | package scope must stay an explicit, documented boundary                                      |
| [webpack/webpack](https://github.com/webpack/webpack)                                         | `e95be18b4651` | 640 of 765 modules are **generated** `lib/`, committed, Yarn, all `require` | 1        | 765     | 3258 (3249)          | 0/120                    | published | 1           | **D** + **C**                                                                 | the source-universe problem is _not_ only a fallback-walk problem                             |
| [less/less.js](https://github.com/less/less.js)                                               | `713331655e43` | **two lockfiles at once**, pnpm workspace                                   | 4        | 254     | 507 (72)             | 14/70                    | published | 4           | **D** — the `incomplete` fact shape fires on a real repository                | the epistemic trichotomy survives real data                                                   |
| [lodash/lodash](https://github.com/lodash/lodash)                                             | `2b5e6f7399a7` | no `tsconfig.json`, **committed `dist/`**, npm lockfile v1                  | 1        | 55      | 85 (85)              | 0/27 (v1 unsupported)    | published | 2           | **C** + **D** — 7 of 55 modules are in `dist/`                                | the #39 reconsideration trigger is real                                                       |
| [expressjs/express](https://github.com/expressjs/express)                                     | `9a34acf03cb8` | CommonJS, no `tsconfig.json`, no lockfile, no CODEOWNERS                    | 1        | 141     | 402 (402)            | 0/44                     | published | 1           | **C**                                                                         | `no-evidence` is the right answer and is reported as such                                     |

`Diagnostics` is the count of entries in `snapshot.diagnostics` for the whole
repository, which is why pnpm's 216 and jest's 64 matter: pnpm emits roughly one
`DISCOVERY_PARTIAL` per package, and jest emits one per package whose
`tsconfig.json` extends something the fence refuses to follow. Across the
corpus: 374 diagnostics, 2 927 declared scripts, 26 201 import edges.

Repository count: 15. Pinned: 15. Findings raised: 3 implementation defects,
0 model defects requiring a model change, 4 unsupported-but-honest classes,
5 repository conditions, 2 bound conditions.

## Findings

### A. Implementation defects — found, fixed, and the reason v1 waited

Three defects, all of the same family: output that looked authoritative and was
not. None was reachable from a synthetic fixture, because each needs a real
repository's shape to appear. All three are fixed in `4a4e2d7` with regression
tests in `tests/unit/discoverCorpusRegression.test.ts`.

**A1 — a resolved target outside the module universe cited a file nobody read.**
`build.ts` minted a `module` node for any resolved import target the source
universe did not list, with `provenance: { source, line: 1 }`. A `.d.ts` or a
`.json` is never _parsed_, so that line 1 was a decoration — precisely what
ADR-0047's context section calls the failure the record exists to prevent. The
validator caught it (`provenance-file-was-read`), which is **error** severity,
which suppressed the entire graph. Seven of fifteen repositories published no
graph at all: type-fest (64 violations), undici (15), jest (5), vite (5),
TanStack (1), axios (1), astro (1).

The fix reads the target before citing it, under a byte budget separate from the
source-parsing budget, and reports `unresolved` / `target-not-readable` when it
still cannot be cited. After it, all fifteen publish a graph and zero produce a
`DISCOVERY_GRAPH_PROVENANCE_INVALID`.

This is the single most consequential finding of the study. A graph that is
_absent_ is at least honest; a graph that is absent because a citation pointed
at line 1 of a file that was never opened is a bug wearing the costume of a
guarantee, and it would have been frozen into a version 1 contract.

**A2 — a current `pnpm-lock.yaml` was refused with a false diagnosis.** pnpm
writes a **two-document** YAML stream: the published pnpm binary's own platform
`optionalDependencies`, then `---`, then the lockfile. `parseDocument` refuses
multi-document sources, and the refusal was reported as _"The document is not
parseable YAML (1 error(s))"_. The file is valid YAML. Five of the fifteen
repositories — pnpm itself, typescript-eslint, biome, vite, TanStack — lost every
resolved version to it: 3 090 + 319 + 52 + 382 + 938 dependency edges reduced to
zero citable versions, in the format this project itself uses. After the fix those
become 54 + 203 + 9 + 43 + 285.

**A3 — the machine-readable snapshot published the operator's home directory.**
TypeScript's own config diagnostics quote the absolute path they tried to read,
and that text was carried into `discover --json` verbatim. TanStack emitted seven
such diagnostics. Two checkouts of the same commit therefore produced _different
bytes_, and the snapshot published `C:/Users/<name>/…` to whoever consumed it.
Absolute paths inside the repository are now rewritten to the repository-relative
form the rest of the snapshot already uses; a path outside it becomes a
statement about the fence rather than about the machine.

### B. Model defects

**None.** Three candidates were examined and rejected as model changes:

- A resolved `.d.ts` / `.json` target has no home in `ImportResolution`, which
  is arguably a missing state. Adding one would mean minting a new snapshot enum
  member in the same issue that freezes the format — the least-validated thing
  conceivable. The citation was wrong, not the model, so the citation was fixed.
- `workspaceDependencies` was `0` in fourteen of fifteen repositories, which
  looked like a dead counter. It is not: only pnpm/pnpm declares `workspace:`
  specifiers (3 manifests) and astro does (33). npm workspaces express workspace
  links as exact versions, which is a different declaration this version does not
  claim to interpret.
- `graph.counts` duplicates what the arrays already say. §113 of the issue asks
  whether they should be frozen. **Kept**, and marked provisional: a consumer can
  derive them, so promising them buys nothing and costs a change to every count.

### C. Unsupported, and honestly so

These are the outcomes the project wants. Each is a true statement about a
limitation, published rather than papered over, and each is why a neighbouring
field cannot be frozen.

**C1 — CommonJS `require()` is not modelled.** express 402/402 unresolved, lodash
85/85, webpack 3 249/3 258, undici 2 839/2 871, jest 435. For a CommonJS
repository the import graph is a wall of `unsupported-syntax` and carries almost
no information. ADR-0047's reconsideration trigger says to reconsider if a corpus
shows "enough `require` in `.ts` files to matter". The answer is that the `require`
is in `.js` files, which is the larger case and the less explicable one.
**Import resolution stays provisional.**

**C2 — Yarn lockfiles are not modelled.** jest and webpack both name
`packageManager: yarn@…`, and both get an _agreed, corroborated_ package-manager
fact, which is correct: the manager is known. Their 749 and 120 dependency edges
are `no-evidence`, which is also correct: the version is unknown. The refusal
works exactly as designed, and the fact and the graph disagree in a way that is
honest rather than convenient.

**C3 — npm lockfile v1 is not modelled.** lodash: _"Lockfile format 1 is not
modelled… left uninterpreted rather than approximated."_ A named refusal, with
no guessed version.

**C4 — `tsconfig` `extends` into `node_modules` is refused.** jest has 40+
packages whose tsconfig extends `@tsconfig/node18`, TanStack ten SvelteKit
configs extending generated files. Every one produces a `DISCOVERY_PARTIAL`
naming the file and saying the package fell back to traversal. This is honest
and loud — arguably _too_ loud: pnpm emits 216 diagnostics and jest 64, which
is a real cost and a real argument for not promising diagnostic-array size.
Note also what is **not** emitted: an unresolved import is a repository
condition, not an incompleteness, so it is aggregated into a single
`DISCOVERY_IMPORT_UNRESOLVED` per repository (ADR-0047 amendment 8) rather than
one per occurrence. That decision survived contact with a repository having
2 874 unresolved imports.

**C5 — framework-generated specifiers do not resolve.** `./$types` (SvelteKit),
`./app.css` (Vite/Solid), `.vue` files. All `target-not-found`, all with the
line and the verbatim specifier. Exactly the ADR-0047 §9 behaviour.

### D. Repository conditions — published, not repaired

**D1 — committed build output enters the source universe, and ADR-0047's
reconsideration trigger is answered: it is common enough to matter.** Two
independent routes, which is the part the trigger did not anticipate:

- _The fallback walk._ lodash has no `tsconfig.json`, so the deliberately blind
  bounded traversal runs, and **7 of its 55 modules are in `dist/`**. This is the
  exact scenario ADR-0047 named.
- ~~_A `tsconfig.json` with the default include._~~ **Correction (2026-11-20):**
  webpack's pinned `tsconfig.json` explicitly lists `lib/**/*.js` in `include`
  (with `allowJs`/`checkJs`), so `lib/` was declared as part of its TypeScript
  program, not admitted by TypeScript's default `**/*`. Its **640 of 765**
  modules in `lib/` are therefore a **declared** universe. The corpus now pins
  that inclusion as correct behaviour (`declared-include-admits-generated-tree`)
  rather than as a second route to the same inaccuracy. The fallback walk is the
  one real route, and remains pinned as known-inaccurate.

The honest answer is not a `"dist"`-shaped heuristic. It is that
`sourceUniverse.files` is a _lower bound_ on what a consumer should treat as
source, and the whole source universe is **provisional**. The second route also
means the trigger's own framing needs amending: this is not a fallback-walk edge
case, it is a property of committed generated output that a repository may reach
either way.

**D2 — the closed-world package scope is visibly surprising.** nestjs/nest
declares `workspaces: ["packages/*"]` and has 20+ `sample/*/package.json`
manifests that are therefore invisible. The snapshot reports 10 packages and says
nothing about the other 20. ADR-0047 flagged this as a deliberate boundary and it
is honoured, but a consumer that reads "10 packages" as "this repository has 10
packages" is wrong. The boundary is kept and the scope is **provisional**, with
the limitation stated rather than left for a consumer to discover.

**D3 — a `workspace:` dependency can name a package no declaration reached.**
astro: 33 edges with `targetMissing: true`. The edge survives, the target is the
name the manifest wrote, and the gap is published. This is the model working.

**D4 — pnpm's leading lockfile document is not the lockfile.** The first document
of `pnpm-lock.yaml` is the published pnpm binary's platform dependencies. A
consumer reading the file top to bottom would stop in the wrong place.

**D5 — two lockfiles at once.** less/less.js ships `package-lock.json` _and_
`pnpm-lock.yaml` while declaring `packageManager: pnpm@9.15.9`. The result is an
`incomplete` fact: value `"pnpm@9.15.9"`, `contradictedBy: ["npm"]`, every claim
retained, no winner named. This is the strongest single piece of evidence that
the epistemic trichotomy from ADR-0044/ADR-0045 works on a repository nobody
designed for it. **The trichotomy earns its stable classification here.**

### E. Bound conditions

`MAX_SOURCE_ENTRIES (2000)` stopped biome, pnpm and typescript-eslint;
`MAX_WORKSPACE_ENTRIES (2000)` stopped TanStack, biome and jest. In every case
selection stopped **after** sorting, so which files survive does not depend on
directory enumeration order, and `sourceUniverse.truncated`, `truncatedBy` and a
`DISCOVERY_PARTIAL` all say so. Deterministic truncation is verified; the bound
itself is kept.

## What the study changed about the stability decision

| Decision                                                                               | Direction              | Because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fact `id`, epistemic discriminators, `value`/`claims`/`corroboration`/`contradictedBy` | **stable**             | Present and correct on all 15, including the conflict and incompleteness shapes (D5).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `evidence.source` / `pointer`, `repository.root`                                       | **stable**             | Correct on all 15; the path leak (A3) was the only violation and is fixed.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Canonical paths, code-unit ordering, byte determinism                                  | **stable**             | Verified by re-running three repositories and comparing bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Graph provenance shape (`source` + 1-based `line`)                                     | **stable**             | This is the invariant, and A1 was a violation of it rather than of the shape.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `repository.commands` inventory                                                        | **stable**             | Complete and verbatim on all 15 (2 927 declared scripts in total).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `repository.verificationEntrypoints` **role projection**                               | **provisional**        | Between 20 % and 73 % of declared scripts get no role. Most misses are correct (`dev`, `start`, `prepare`, `postinstall`). But `check` (biome), `format` (astro, typescript-eslint ×19), `validate` (lodash), and `test-ci` / `test-cov` / `test-tap` (express) are real verification surfaces the four-role grammar misses. The grammar is **not** broadened here: §109 measures, it does not mandate, and #38's decision stands. The consequence is that the _inventory_ is stable and the _role projection_ is not. |
| `graph.nodes[].kind`, `graph.edges[].kind`                                             | **provisional / open** | Stable enough to traverse, and the four kinds all appeared; but future phases will add `calls` or `exports`, so the enums are documented as **open**: consumers must not exhaustively switch.                                                                                                                                                                                                                                                                                                                          |
| Import `resolution.status` and `UnresolvedReason`                                      | **provisional**        | Five of six reasons occurred, one (`target-not-readable`) was added by this issue, and C1 shows the dominant real-world answer for CommonJS is currently `unsupported-syntax` — a vocabulary that will change.                                                                                                                                                                                                                                                                                                         |
| `graph.sourceUniverse`                                                                 | **provisional**        | D1: two independent routes put generated output in the universe, in 2 of 15 repositories. Not "rare theoretical".                                                                                                                                                                                                                                                                                                                                                                                                      |
| CODEOWNERS **state model**                                                             | **stable**             | 5 repositories with CODEOWNERS; the two with a narrow rule correctly reported zero owned subjects, pnpm's catch-all correctly owned 967. No false owner and no false `unowned` anywhere.                                                                                                                                                                                                                                                                                                                               |
| CODEOWNERS **pattern breadth** / `unsupportedPatterns`                                 | **provisional**        | The subset is documented, but no advanced-pattern repository was inspected, so there is no evidence to promise more than "surfaces what it declines".                                                                                                                                                                                                                                                                                                                                                                  |
| Dependency **declaration** shape                                                       | **stable**             | Correct on all 15; the declared/resolved split did its job.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `resolution.status` for dependencies                                                   | **provisional**        | Varies by adapter: pnpm 54/3 090 and npm 154/177 in practice, `no-evidence` for Yarn, `unsupported` for v1. Conditional, per-adapter, and not a single promise.                                                                                                                                                                                                                                                                                                                                                        |
| `graph.counts`, `summary`                                                              | **provisional**        | Derivable from the arrays; freezing redundancy buys nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `diagnostics[].code`, `severity`                                                       | **stable**             | Existing compatibility surface; no code was renamed or renumbered.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `diagnostics[].detail`, `metadata`, ordering, count                                    | **provisional**        | C4: 216 diagnostics on one repository and 64 on another. Detail text is prose and changes with wording.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `snapshotVersion`, top-level field presence                                            | **stable**             | With `snapshotVersion` a required constant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Reproducing this

```bash
git clone --depth 1 --single-branch https://github.com/sindresorhus/type-fest.git
pnpm exec tsx src/cli/index.ts discover --json --root ../type-fest
```

No script in this repository performs reconnaissance, and none should: the
committed corpus is fully local and CI never touches the network (§78 of the
issue). A maintainer wanting to repeat the study pins a SHA, records it here,
and compares the tables above.

The three defects this study found are now covered by
`tests/unit/discoverCorpusRegression.test.ts`, and the shapes they came from —
declaration-file targets, multi-document lockfiles, unresolvable generated
tsconfigs — are in the committed conformance corpus. A future regression surfaces
in CI, not in another sweep.
