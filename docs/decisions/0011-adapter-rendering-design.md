# ADR-0011: Adapter rendering and generated-content design

## Status

Accepted

## Context

`agent-ready.yaml` already declares `adapters.agentsMd`/`adapters.claude`
as `{ enabled: boolean }`, and `AdapterName` already includes `cursor`,
`copilot`, and `gemini` for forward compatibility. Phase 2 needs to turn
`enabled: true` into actual generated content for the two adapters that
have a concrete, well-known target format (`AGENTS.md`, `CLAUDE.md`),
while keeping the door open for the other three without building
speculative infrastructure for adapters that don't render anything yet —
consistent with `docs/architecture/overview.md`'s existing "Explicitly
absent" stance against generic plugin/adapter loaders and unused
abstractions (see also `CONTRIBUTING.md`).

## Alternatives considered

- **Templating engine** (Handlebars/EJS/similar) with adapter-specific
  template files.
- **Plugin/dynamic-loader architecture**: adapters register themselves
  via a discovery mechanism (file-system scan, `package.json` field,
  etc.).
- **Pure TypeScript functions per adapter**, registered in a plain
  object-literal map.
- **Duplicate `instructions.sources` content inline** into generated
  files vs. **linking to those files**.

## Decision

- **Each adapter is a pure function**: `(contract: NormalizedContract) =>
GeneratedFile`, with `GeneratedFile = { relativePath, content }`. No
  `FileSystem` dependency, no shared templating engine — `renderAgentsMd`
  and `renderClaude` (`src/generate/adapters/agentsMd.ts`,
  `claude.ts`) both call a small shared `renderContractSections` helper
  (`src/generate/adapters/shared.ts`) for the section body they have in
  common, then wrap it with their own marker banner and title. This is a
  plain shared function, not a generic templating abstraction — there was
  no need to introduce one for two adapters that currently want
  identical information under a different heading.
- **A plain object-literal registry, not a plugin loader.**
  `src/generate/generate.ts` defines `RendererRegistry = { agentsMd:
renderAgentsMd, claude: renderClaude }`. Adding a renderer for
  `cursor`/`copilot`/`gemini` later is a one-file (`adapters/cursor.ts`),
  one-line-registry-entry change — not a redesign, and not a dynamic
  discovery mechanism that would need its own validation and error
  handling.
- **Enabled-but-unregistered adapters produce a warning, not an
  error.** `planGeneration` emits `ADAPTER_NOT_YET_IMPLEMENTED`
  (`severity: "warning"`) and skips the adapter, rather than failing
  generation outright. This is the first real use of `Severity:
"warning"` in the codebase (previously declared in the `Diagnostic`
  type but unused). A contract author enabling `cursor` today is
  expressing intent for the future, not making an error.
- **Shared section set**: Project, Environment, Commands, Verification,
  Paths, and a pointer list to `instructions.sources` — the same
  sections `agent-ready inspect`'s human output already groups the
  contract into (see `src/cli/commands/inspect.ts`), so the mental model
  is consistent across commands.
- **Link `instructions.sources`, don't duplicate their content.**
  Generated files render a Markdown link list to each declared
  instruction source rather than inlining that file's content. Inlining
  would go stale the moment the source file changes without a
  regeneration, and would silently duplicate content the user already
  maintains elsewhere; a link stays correct by construction.
- **Output filenames are adapter-hardcoded** (`AGENTS.md`, `CLAUDE.md`),
  never derived from contract content — see ADR-0010 for the security
  rationale.

## Consequences

- Adding a genuinely new adapter is additive: a new file under
  `generate/adapters/`, a new registry entry, and (if its output format
  differs meaningfully) its own rendering logic — no changes to
  `planGeneration`'s control flow, the CLI command, or the diagnostic
  codes.
- Renderers are trivially unit-testable in isolation (pure functions,
  `NormalizedContract` in, `GeneratedFile` out) without any `FileSystem`
  or CLI scaffolding — see `tests/unit/generateAdapters.test.ts`.
- Generated content is deterministic: the same contract always renders
  byte-identical output, which is what makes `--check`'s drift detection
  and the golden-fixture regression test
  (`tests/fixtures/generate/expected-*.txt`) meaningful.

## Reconsideration trigger

Revisit the "one shared section-renderer, one plain registry" approach
if a second adapter needs genuinely different content (not just a
different Markdown flavor of the same sections) or needs to produce more
than one output file — at that point, a shared `renderContractSections`
helper stops being an accurate abstraction and adapters should render
fully independently.
