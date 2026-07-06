# ADR-0026: `instructions.content` — hand-authored Markdown in the contract

## Status

Accepted. Implemented per this ADR in the same landing: schema addition
(`schemas/v1/agent-ready.schema.json`), type extension
(`src/contract/types.ts`), normalization pass-through
(`src/contract/normalize.ts`), and renderer integration
(`src/generate/adapters/shared.ts`), with unit tests.

## Context

[ADR-0004](0004-repository-and-contract-discovery.md) introduced
`instructions.sources` — an array of repository-relative file paths that
the contract declares as authoritative documentation. The
[adapter rendering design (ADR-0011)](0011-adapter-rendering-design.md)
renders those sources as links in each generated instruction file
(`AGENTS.md`, `CLAUDE.md`, etc.).

Richer adapter output work (grouped commands, numbered verification
pipelines, path-rule explanations, and a before-submitting checklist)
surfaced a gap: generated files now carry substantial structure from the contract,
but the only way to add narrative context (architecture overviews,
coding conventions, design rationale) is through external files
referenced in `instructions.sources`. Those files may not exist for
every project, may drift from the contract, and require the agent to
open additional files to absorb the guidance.

Auto-documentation tools (LLM-based, probabilistic, per-run cost)
fill this gap by scanning the repository and generating narrative
documentation. But they cannot produce the _exact, maintainer-authored_
guidance that the maintainer wants to assert as the single source of
truth. A deterministic, zero-cost path from the contract to the
instruction files was missing.

## Alternatives considered

- **No `content` field — rely entirely on `instructions.sources`**:
  - _Argument_: sources already point to documentation files; duplicating
    content in the contract creates a maintenance burden (two places to
    keep in sync).
  - _Counter_: sources are an opt-in convention; many adopters have no
    dedicated docs files beyond `README.md`. Requiring a separate file
    for narrative guidance adds friction to the adoption funnel.
    Moreover, in-repo docs files can drift from the contract's
    assertions — there is no automated link between them.
  - **Rejected.** The contract is the single source of truth; narrative
    guidance that belongs with the contract should live in the contract.

- **Separate top-level key (`conventions:`, `architecture:`, etc.)**:
  - _Argument_: structured fields (not free-form Markdown) would let
    the CLI validate and restructure the content per adapter.
  - _Counter_: imposes a schema the maintainer must learn; resists the
    natural shape of narrative documentation (headings, lists, code
    blocks). Every project's conventions look different.
  - **Rejected.** Free-form Markdown respects existing documentation
    idioms and requires zero new syntax to learn.

- **`instructions.content` as an array of named sections**:
  - _Argument_: `[{ heading: "Conventions", body: "..." }]` gives the
    renderer hooks to format sections differently per adapter.
  - _Counter_: the shared renderer already outputs Markdown — a single
    Markdown string with its own headings is identical in practice.
    Adding structure the renderer doesn't use is premature abstraction.
  - **Rejected.** A single Markdown string is the simplest thing that
    works. Named sections can be added later if adapter-specific
    formatting becomes necessary.

- **Max-length ceiling: 1,000 vs 5,000 vs 10,000 characters**:
  - _1,000_: too short for meaningful multi-section guidance (a
    typical conventions section is 500–2,000 characters).
  - _5,000_: adequate for most projects, but leaves no room for
    comprehensive architecture documentation.
  - _10,000_: generous without being unbounded; covers the vast
    majority of hand-authored narrative sections. If a project needs
    more, the content should live in a separate file referenced by
    `instructions.sources` — the contract is for _essential_ guidance,
    not an encyclopedia.
  - **Selected: 10,000 characters**, enforced by JSON Schema
    `maxLength`.

- **Render position: own section vs inline within Further Context**:
  - _Own section_ (`## Maintainer Notes` or `## Project Conventions`):
    more prominent, clearly separated from source links.
  - _Inline within Further Context_: keeps the generated file flatter;
    the distinction between "content the maintainer wrote" and "files
    to consult" is self-evident from the prose.
  - **Selected: inline within Further Context**, rendered before
    source links. The section already carries the heading "Further
    Context" — content and sources are two kinds of context, and
    rendering them together in a single section keeps the output
    scannable. If usage evidence shows maintainers want a visually
    distinct section, adding a `## Maintainer Notes` heading around
    the content is a one-line renderer change.

- **Should `escapeMarkdownText` be applied to content?**
  - _Yes_: protects against Markdown-significant characters in the
    user's input.
  - _No_: the content is _authored_ as Markdown — applying escaping
    would corrupt intentional formatting (headings, bold, code spans).
  - **Selected: no escaping.** The content is treated as raw Markdown
    and rendered as-is. The maintainer is responsible for well-formed
    Markdown, same as any `.md` file in the repository. The schema's
    `minLength: 1` and `maxLength: 10000` provide the only guardrails.

## Decision

- **New optional `content` field** under `instructions` in the JSON
  Schema:

  ```json
  "content": {
    "description": "Hand-authored Markdown content rendered inline in every generated agent instruction file.",
    "type": "string",
    "minLength": 1,
    "maxLength": 10000
  }
  ```

  The field is optional and independent of `sources`. Valid
  combinations are: neither, content-only, sources-only, or both.

- **Type extension**: `RawInstructions.content?: string` and
  `NormalizedContract.instructions.content?: string`. Content is passed
  through normalization unchanged — it is already a string, and no
  semantic transformation applies (no path normalization, no escaping,
  no Markdown parsing).

- **Renderer integration** (`src/generate/adapters/shared.ts`): the
  Further Context section renders content first (as raw Markdown), then
  source links, then falls back to `(none declared)` if neither is
  present:

  ```
  ## Further Context

  [content lines here if present]

  See these files for detailed project documentation...
  - [README.md](README.md)
  - [docs/architecture.md](docs/architecture.md)
  ```

  If only content is present (no sources), the "See these files..."
  line is omitted. If only sources are present (no content), the
  output is unchanged from the pre-ADR-0026 behavior.

- **YAML authoring**: content uses a literal block scalar (`|`) for
  multi-line Markdown, keeping the `agent-ready.yaml` readable:

  ```yaml
  instructions:
    content: |
      ## Conventions

      - Use `const` over `let`.
      - Prefer explicit return types.
  ```

  Single-line content can use a plain string without the `|` indicator.

- **No new diagnostic codes.** The content field has no semantic
  validation beyond the JSON Schema constraints (`minLength`,
  `maxLength`). Malformed Markdown is the maintainer's responsibility
  — same posture as `project.description`.

- **Tests**: three new test contracts and three new test cases (×5
  adapters = 15 tests) in `tests/unit/generateAdapters.test.ts`:
  - Content-only contract: content renders, source-link line is absent.
  - Content + sources contract: both render in the expected order.
  - Sources-only contract: unchanged behavior (regression guard).

  The complete-phase-1 example (`examples/complete-phase-1/`) and its
  compatibility-corpus counterpart both include an `instructions.content`
  block exercising the feature end-to-end through golden fixtures.

## Consequences

- Maintainers can embed hand-authored narrative guidance directly in
  the contract. The generated instruction files carry not just
  machine-enforceable structure (commands, paths, verification) but
  human-authored conventions and rationale — all from one file.

- Zero-cost and deterministic: unlike LLM-based auto-documentation,
  the content is what the maintainer wrote, rendered identically on
  every `generate` run, with no API calls and no variance.

- The `instructions` object now has two independent optional fields
  (`sources` and `content`). Both can be present, one, or neither.
  The renderer handles all four combinations.

- No schema migration needed: the field is additive (optional, no new
  required properties). Existing contracts that omit `content` produce
  identical output to before this ADR.

- The complete-phase-1 example and its compatibility corpus become the
  first end-to-end demonstration of the feature, with 10 golden
  fixtures (5 regular + 5 compatibility) updated to validate content
  rendering.

## Reconsideration trigger

- If usage evidence shows that a significant fraction of adopters
  exceed the 10,000-character ceiling, increase `maxLength` to 20,000
  or remove the limit entirely (relying on YAML parsing constraints as
  the practical ceiling).

- If adapter-specific formatting becomes necessary (e.g. wrapping
  content in adapter-specific admonitions or translating Markdown to
  XML for Copilot), replace the single `content` string with a
  structured array of named sections so the renderer can apply
  per-adapter transformations.

- If `escapeMarkdownText` is needed for a subset of content (e.g. a
  `contentIsHtml` flag for adapters that don't accept Markdown), add
  an `instructions.contentFormat` enum field (`markdown` | `plain`)
  rather than changing the default behavior — the current Markdown
  default is the right call for today's five adapters.

- If a `content` field at the adapter level becomes warranted (some
  guidance is specific to one agent), add an `instructions.content`
  field to the `adapterDeclaration` schema alongside `enabled`. This
  ADR's field-level content is project-wide and doesn't preclude
  per-adapter content later.
