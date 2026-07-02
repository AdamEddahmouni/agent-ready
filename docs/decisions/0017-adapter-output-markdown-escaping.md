# ADR-0017: Adapter output Markdown escaping

## Status

Accepted

## Context

`src/generate/adapters/shared.ts`'s `renderContractSections()` — plus
every one of the five adapters' own title lines
(`agentsMd.ts`/`claude.ts`/`cursor.ts`/`copilot.ts`/`gemini.ts`) —
interpolates contract-supplied free text directly into Markdown with no
escaping. Several of those fields have no JSON Schema `pattern` at all:
`project.description` and `command.description` only carry a length
limit, and can legally contain embedded newlines and any
Markdown-significant character; `project.name` and `command.run` disallow
leading/trailing whitespace and newlines but are otherwise unrestricted.
Concretely, today:

- `project.name` starting with `#` renders as its own ATX heading
  (interpolated as a bare line under `## Project`, and again inside each
  adapter's `` `# <Title> — ${contract.project.name}` `` title line).
- A `command.run` containing a backtick (very plausible — shell command
  substitution looks like `` echo `date` ``) breaks out of the
  `` `${command.run}` `` inline code span early.
- An `instructions.sources` path containing a space or parenthesis (legal
  and common on real file systems) breaks the `[${source}](${source})`
  link syntax.
- A `project.description` or `command.description` containing the literal
  managed-file marker string, or an embedded newline, can corrupt the
  rendered structure or spoof `hasManagedMarker`'s substring check.

This is a content-integrity/correctness risk, not a code-execution or
file-escape risk — generated Markdown is never executed, and output paths
remain adapter-hardcoded per [ADR-0010](0010-generate-write-boundary.md)
and [ADR-0012](0012-cursor-copilot-gemini-output-format.md) regardless of
contract content. But it undermines the project's core premise that
generated instruction files are a deterministic, authoritative source an
agent can rely on. It is completely untested today:
`tests/unit/generateAdapters.test.ts` only exercises well-behaved input,
and the byte-exact golden fixtures in `tests/integration/generateCli.test.ts`
only cover the one well-behaved `examples/complete-phase-1/` contract.
This phase closes that gap, extending the adversarial-input testing
discipline `ROADMAP.md`'s Phase 0/1 already established for contract
_parsing_ to contract _rendering_ for the first time.

## Alternatives considered

- **Restrict these fields at the JSON Schema level** (add a `pattern` to
  `project.description`/`command.description` forbidding Markdown-special
  characters, mirroring `project.name`/`command.run`'s existing
  no-newline pattern). Rejected: this is a specification change under
  `GOVERNANCE.md` (alters the public schema shape, requiring a
  schema-example update and explicit maintainer sign-off), would break
  already-valid contracts using ordinary punctuation today, and wrongly
  couples the contract-authoring layer to one specific downstream
  (Markdown) renderer's needs — a future non-Markdown adapter would need
  none of these restrictions. This phase is a pure rendering-side fix.
- **A Markdown/templating library.** Rejected for the same reason
  [ADR-0011](0011-adapter-rendering-design.md) already rejected one:
  the actual need is three narrow, fully-specified escaping positions,
  disproportionate to a new dependency's supply-chain and maintenance
  cost, and inconsistent with this project's "pure function, no
  templating engine" adapter style.
- **A single generic `sanitize(value, mode)` function.** Rejected in
  favor of three separately named, independently testable functions —
  more self-documenting at each call site, and closer to
  `CONTRIBUTING.md`'s "do not add unused abstractions" guidance than one
  generic, mode-switched helper.

## Decision

- **New module `src/generate/adapters/escape.ts`**, pure functions, no
  `FileSystem` dependency — matching the existing flat-module style
  (`shared.ts`, `marker.ts`):
  - `escapeMarkdownText(value)`: for plain-text positions
    (`project.name`, `project.description`, `command.description`).
    Collapses embedded newlines to a single space, then backslash-escapes
    CommonMark inline-significant characters (``\ ` * _ [ ] < > ~``)
    everywhere, and block-starting markers (ATX heading, `-`/`+` list,
    ordered-list, blockquote, fenced-code-block opener) at the start of
    the string. Deliberately escapes only this targeted set, not
    CommonMark's full ASCII-punctuation escape set, so ordinary prose
    isn't visibly mangled for no added safety.
  - `wrapCodeSpan(value)`: for inline-code positions (`command.run`,
    `runtime.range`, the combined `packageManager` `name@version` string,
    and every `paths.protected`/`generated`/`ignored` glob pattern).
    Chooses a backtick fence strictly longer than the longest run of
    consecutive backticks already in the content (per CommonMark: a code
    span opened by a backtick string of length N is closed only by the
    next backtick string of exactly length N), padding with a space only
    when the content starts or ends with a backtick. Backslash-escaping
    does not work inside a CommonMark code span, so this is a different
    technique from `escapeMarkdownText`, not a reuse of it.
  - `renderMarkdownLink(path)`: for `instructions.sources`. Uses
    CommonMark's angle-bracket destination form (`[text](<dest>)`) only
    when the path contains a space, parenthesis, or control character;
    plain paths render exactly as before. Backslash-escapes `[`/`]` in
    the link text unconditionally.
- **Call sites updated**: `shared.ts`'s `renderContractSections` and
  `formatPathList`, plus the `project.name` interpolation in each of the
  five adapters' own title lines. `verification.required` command-name
  references are deliberately left unescaped — they are validated
  identifiers (schema pattern plus dangling-reference rejection in
  `contract/semantic.ts`), so no special character is reachable there.
- **`packageManager.name`/`.version` render as one combined code span**
  (``wrapCodeSpan(`${name}@${version}`)``), not two separately-wrapped
  segments — `name` is schema-`enum`-restricted (`npm`/`pnpm`/`yarn`,
  provably backtick-free), so computing the fence over the concatenated
  string is exactly as safe and keeps every existing golden fixture
  byte-identical.
- **No schema change, no new diagnostic code.** Escaping is silent,
  deterministic, and always succeeds — there is no new failure mode to
  surface.
- **New adversarial-content coverage**: `tests/unit/adaptersEscaping.test.ts`
  (direct unit tests of the three functions, plus integration-level tests
  through all five real adapters), and a new example,
  `examples/adversarial-content/`, with five new golden fixtures
  (`tests/fixtures/generate/expected-adversarial-*.txt`) exercised by a
  new test block in `tests/integration/generateCli.test.ts`, mirroring
  the existing `complete-phase-1` golden-fixture test.

## Consequences

- Generated output for a contract using Markdown-significant characters
  now differs from naive concatenation, by design — round-tripping isn't
  byte-identical to what was typed (documented in
  `docs/specification/contract-reference.md`).
- Every existing example (`minimal`, `complete-phase-1`) contains no
  Markdown-significant character in any free-text field, so all five
  pre-existing golden fixtures are byte-identical before and after this
  change — verified by the full existing test suite passing unchanged.
- A `project.description` (or `command.description`) that happens to
  contain the literal managed-file marker string can no longer cause
  `hasManagedMarker`'s substring check to see two occurrences of it in
  generated output.
- `src/generate/adapters/*.ts` gain one new import each
  (`escapeMarkdownText` from `./escape.js`); no other module's public
  surface changes.

## Reconsideration trigger

Revisit this decision if a future adapter needs a genuinely non-Markdown
output format — at that point `escape.ts`'s functions stop being a
correct fit for that adapter, and either adapter-specific escaping or a
renamed, format-specific module should replace this one.
