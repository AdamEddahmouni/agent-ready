# ADR-0037: Architecture-dependency drift analysis

## Status

Accepted. Targeted at v0.7.0; not yet implemented.

## Context

[ADR-0032](0032-architecture-contract-block.md) shipped `architecture.boundaries`
in v0.5.0 as an optional array of 1–500-character strings, explicitly as
declarative guidance rather than executable policy. Its reconsideration trigger
anticipated this decision: revisit the syntax when v0.7.0 introduces
import-graph analysis, and prefer "a separately structured, machine-readable
boundary form rather than overloading human guidance strings."

That trigger is now load-bearing, because the shipped field cannot be parsed.
Real declarations in this repository's own contract read:

- `src/contract/ must not depend on CLI presentation modules.`
- `Generated adapters must not depend on a concrete filesystem implementation.`

"CLI presentation modules" and "a concrete filesystem implementation" are
concepts, not import specifiers. [ROADMAP-TO-1.0.md](../../ROADMAP-TO-1.0.md)'s
v0.7.0 sketch proposed that boundary entries "use a simple `from → to` or
`must not import` syntax validated at contract-load time." Applying that to the
existing field would retype a shipped field inside contract `version: 1`,
contradicting [ADR-0009](0009-pre-1.0-stability-policy.md) and the roadmap's own
additive-only guiding principle, and would fail every contract that validates
today — including this one. It would also make the v0.7.0 exit criterion
("zero false positives on the project's own `architecture.boundaries`
declarations") unmeetable by construction, since those declarations cannot be
expressed in the proposed syntax.

Prose guidance and executable policy are different artifacts.
[ADR-0033](0033-agents-contract-block.md) already established this separation
for the `agents` block: declarations an agent reads are not declarations
Agent-Ready enforces. A machine-checked boundary is enforcement, and therefore
warrants its own field rather than a reinterpretation of an existing one.

## Decision

Add an optional, additive `architecture.boundary_rules` field within contract
`version: 1`, and an opt-in `agent-ready analyze --architecture` flag that
checks it against the repository's actual import graph.

```yaml
architecture:
  boundaries:
    - "src/contract/ must not depend on CLI presentation modules."
  boundary_rules:
    - from: "src/contract/"
      must_not_import:
        - "src/cli/"
```

### Contract surface

- `boundaries` is unchanged. It remains free-form prose, is never parsed, and
  is never a source of findings. Existing contracts are unaffected.
- `boundary_rules` is an optional array of `{ from, must_not_import }` objects.
- `from` is a required, literal, repository-relative path prefix (1–200
  characters), validated with the existing path rules from
  [ADR-0005](0005-path-and-glob-semantics.md): no absolute paths, no traversal
  outside the repository, no glob syntax.
- `must_not_import` is a required array of at least one entry, each a literal
  repository-relative path prefix under the same validation, unique within the
  rule.
- `from` is unique across rules. Two rules declaring the same origin are a
  contract error rather than a silent merge, so the declared policy for a
  directory is readable in one place.
- Semantic validation rejects malformed or duplicated rules with
  `ARCHITECTURE_BOUNDARY_RULE_INVALID`, mirroring `ARCHITECTURE_DECISION_INVALID`
  from ADR-0032. The normalizer preserves declared order and normalizes only the
  path forms.

### Analysis surface

- `agent-ready analyze --architecture` is opt-in and read-only. Without the
  flag, `analyze` behaves exactly as it does today. The command never modifies
  source files.
- Scanned files are `.ts`, `.js`, `.mjs`, and `.cjs` files under each rule's
  `from` prefix, excluding `paths.ignored` and `paths.generated`.
- Extraction uses a bounded, dependency-free, line-oriented scanner with
  comments and string literals masked first, following the same discipline as
  the Markdown link scanner in [ADR-0020](0020-instruction-source-link-analysis.md).
  It recognizes static `import`/`export ... from`, `import()` with a literal
  argument, and `require()` with a literal argument. Non-literal dynamic
  specifiers are ignored, documented as ignored, and never guessed at.
- Each per-file read reuses the source size cap established by
  [ADR-0031](0031-instruction-source-size-cap.md). A read or scan failure is
  reported as `ARCHITECTURE_ANALYSIS_SCAN_FAILED` rather than silently skipped.
- Relative specifiers are resolved against the importing file into a
  repository-relative path and prefix-matched against `must_not_import`. A match
  is reported as `ARCHITECTURE_BOUNDARY_VIOLATED` with the importing file, the
  resolved target, and the source position.
- Bare module specifiers (`commander`, `node:fs/promises`) are **not** matched in
  v0.7.0. Only repository-relative imports participate. This bounds the first
  ship to the case the project can dogfood; see the reconsideration trigger.
- False-positive policy, per the roadmap: a boundary rule is an assertion, and a
  violation is always reported. There is no heuristic suppression and no
  inline-ignore mechanism. The user changes either the code or the declaration.

### Adapter output

All five adapters render `boundary_rules` inside the existing `## Architecture`
section as "Must not" bullets, alongside the prose `boundaries` bullets, with
paths rendered through `wrapCodeSpan` after path validation. A repository that
declares both a prose boundary and its structured equivalent will see both
rendered; that redundancy is the author's choice and is documented rather than
de-duplicated.

## Alternatives considered

- **Validate `boundaries` syntax at contract-load time (the roadmap's original
  sketch):** rejected. It retypes a field shipped in v0.5.0, breaks ADR-0009's
  additive-only policy within `version: 1`, invalidates existing contracts, and
  makes the dogfooding exit criterion unmeetable.
- **Widen `boundaries` to accept `string | object`:** rejected. Existing strings
  would keep validating, so it is technically additive, but it mixes human
  guidance and executable policy in one array, forces the shared
  `architectureGuidanceList` definition to split anyway, and makes both adapter
  rendering and every consumer branch per entry.
- **Parse the existing prose opportunistically and skip what does not match:**
  rejected. It silently no-ops on most real declarations, which is
  indistinguishable from passing, and it contradicts the no-suppression policy
  this ADR otherwise adopts.
- **Use a real TypeScript/JavaScript AST parser:** rejected. It adds a
  substantial dependency to a project whose scanners are deliberately bounded and
  dependency-free (ADR-0020, ADR-0031), for coverage this rule shape does not
  need.
- **Enforce boundaries at `validate` time rather than behind an `analyze` flag:**
  rejected. Reading the source tree is materially more work than contract
  validation, and `validate` is the fast, universally-run command. Import-graph
  analysis follows `analyze`'s established opt-in, read-only posture.

## Consequences

- This ADR formally reopens the "architecture-dependency analysis beyond
  declared documentation links" non-goal in
  [ROADMAP.md](../../ROADMAP.md#strict-non-goals-for-the-current-phase). Per the
  roadmap's own rule, that non-goals list must be updated in the same pull
  request. The reopening is bounded to repository-relative JS/TS import checking
  against declared `boundary_rules`; open-ended architecture analysis remains out
  of scope.
- ROADMAP-TO-1.0.md's v0.7.0 section and exit criteria must be rewritten to
  describe `boundary_rules` rather than parsed `boundaries`.
- Implementation touches the JSON Schema, raw and normalized types,
  normalization, semantic validation, a new `analyze/importGraph.ts` scanner, the
  `analyze` command, shared adapter rendering, all five adapters, golden
  fixtures, the compatibility corpus, `contract-reference.md`,
  `cli-reference.md`, and `diagnostics.md`.
- Three diagnostics are added: `ARCHITECTURE_BOUNDARY_RULE_INVALID`,
  `ARCHITECTURE_BOUNDARY_VIOLATED`, `ARCHITECTURE_ANALYSIS_SCAN_FAILED`. The
  roadmap named only the latter two; rule validation needs its own code because
  it fires from semantic validation, not from analysis.
- A contract without `boundary_rules` must produce byte-identical adapter output
  to v0.6.1, proving the change is additive.
- Analysis remains local, read-only, deterministic, and free of network, LLM, and
  telemetry calls.

## Reconsideration trigger

Revisit when any of the following holds:

- Repositories need boundaries against bare module specifiers or packages
  (`must not import commander`), which v0.7.0 deliberately excludes.
- Repositories need inverse rules ("only `src/filesystem/nodeFileSystem.ts` may
  import `node:fs/promises`"), which this rule shape cannot express and which
  this repository's own architecture already describes in prose.
- Multi-language import analysis becomes necessary; v0.8.0's multi-language
  `doctor` probing ([ADR-0038](../../ROADMAP-TO-1.0.md)) may establish the
  precedent for a `--language` surface.
- The no-suppression policy produces enough unactionable findings in a real
  repository that an explicit, declared exception mechanism is warranted.
