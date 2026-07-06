# ADR-0022: `agent-ready schema` command (first Path A ship)

## Status

Accepted.

## Context

[ADR-0021](0021-cli-package-maturity-direction.md) selected Path A (CLI/package
maturity) and named `agent-ready schema` as the first shipable command on
that direction. This ADR scopes that single command — its flags, exit codes,
output shapes, error model, and the seam between the bundled schema and
package-internal path resolution — before any implementation lands.

`agent-ready.yaml` is validated against
[`schemas/v1/agent-ready.schema.json`](../schemas/v1/agent-ready.schema.json),
which the package already exposes in two equivalent ways:

- as the on-disk file `<pkgroot>/schemas/v1/agent-ready.schema.json`
  ([`package.json`](../../package.json) `files[]` ships `schemas/`);
- as the package subpath export `./schema` in [`package.json`](../../package.json).

The intent of this command is to make that schema reachable to a downstream
tooling author or a curious adopter without forcing them to fork the JSON
Schema, read it from source, or `find . -name '*.schema.json'`. It is
_introspective about the tool itself_, not about the user's repository —
unlike every other current command.

## Alternatives considered

- **Path-resolution strategies**:
  - _Hardcoded relative path resolved from `import.meta.url`_ — symmetric
    across source (`src/cli/commands/`) and built (`dist/cli/commands/`)
    layouts because they are both three directory levels from the repo
    root; matches the existing `src/cli/index.ts` pattern that already
    reads `package.json` via `new URL("../../package.json", import.meta.url)`.
  - _JSON subpath import_ — `import schemaJson from "agent-ready/schema" with { type: "json" }`.
    Cleaner at the call site (no path math), but it depends on Node's
    import attributes, requires an additional `package.json` `exports`
    entry per subpath, and changes the meaning of the existing `./schema`
    export from "path" to "importable JSON". Adds requirements for a
    piece of static data already on disk.
  - Selected: the `import.meta.url`-relative approach. Matches the
    existing CLI bootstrap pattern with no new Node-version feature
    required.

- **Default output: metadata, full content, or path-only**:
  - _Path only_: too sparse for a command literally called `schema` —
    "where is it" is half the question.
  - _Full schema content_: a multi-KB JSON dump is noisy as default;
    nobody wants `agent-ready schema | less` on every invocation.
  - _Metadata by default; `--content` adds the parsed schema body_ —
    selected. Both the "what is it" and the "show me all of it"
    questions are answered in a single command, matching the
    "summary by default, drilldown via flag" discipline `analyze`/`inspect`
    already use.

- **Should `agent-ready schema` load the user's contract?** No. This
  command is about _the tool_, not the user's repo. Skipping
  `loadContract` means:
  - It works in any directory, including the natural "I'm evaluating
    Agent-Ready" first-run invocation `pnpm dlx agent-ready schema`.
  - This is the _only_ Agent-Ready command that explicitly does NOT
    require a contract file or `agent-ready.yaml` upstream.
  - Therefore no `FileSystem`, no `repoRoot`, no `contractPath`
    only-one. Path resolution happens via `import.meta.url` directly
    against the package's own files.

- **Use the `FileSystem` abstraction?** No. `FileSystem` is the boundary
  domain code uses to walk the user's repository. The bundled schema is
  package-internal data with a single, build-time-fixed location.
  Reading it via `node:fs/promises` directly mirrors what
  `src/cli/index.ts` already does for `package.json`. This is the same
  posture `src/cli/index.ts` takes and is consistent with
  [`docs/architecture/overview.md`](../architecture/overview.md)'s
  inverse principle that no domain code should touch `node:fs`
  directly — `cli/commands/*` is not domain code.

- **Error model for a missing/invalid bundled schema**:
  - _New diagnostic code (e.g. `SCHEMA_BUNDLE_MISSING`)_ — more
    specific; would be additive-only under
    [ADR-0009](0009-pre-1.0-stability-policy.md) and provide a clearer
    error category.
  - _Reuse `INTERNAL_INVARIANT_VIOLATION`_ — this _is_ an internal
    invariant; the bundled schema should always exist alongside the
    installed CLI, and should always parse as a JSON object. The
    existing code's documented meaning is "the Agent-Ready
    installation itself is broken," which is exactly this failure
    class.
  - Selected: `INTERNAL_INVARIANT_VIOLATION` → `ExitCode.INTERNAL_ERROR`
    (10). The existing code means the right thing; adding a new
    diagnostic code would split one failure class (a broken install)
    into two that mean the same thing operationally.

- **Should `agent-ready schema` update `action.yml`?** No, in this PR.
  The precedent is `agent-ready analyze` (Phase 10, ADR-0020): it was
  shipped without updating the composite action's `command` input
  (`action.yml` still enumerates `validate|inspect|generate|check|verify`).
  The action is updated later in a follow-up PR when its `command`
  enum needs to grow. Keeping `action.yml` out of this PR also keeps
  this PR focused on the CLI surface only.

- **`CliOutcome` shape**: reuse
  [`src/cli/commands/validate.ts`](../../src/cli/commands/validate.ts)'s
  `CliOutcome` interface — `{ exitCode, stdout, stderr }`. Schema has
  no `contractPath` or `repoRoot`, but the interface is already what
  every other command uses including `inspect`/`analyze`.

## Decision

- **New `src/cli/commands/schema.ts`** exporting
  `runSchema(args, options?)` returning `Promise<CliOutcome>`.
- **Wired into `src/cli/index.ts`** via commander following the existing
  per-command pattern.
- **Flags** (only two — minimal for the smallest mechanism that solves
  the need, per [`docs/architecture/overview.md`](../architecture/overview.md)):
  - `--json` — structured JSON output (matches every other command's
    `--json` semantics).
  - `--content` — include the parsed schema body. Off by default.
- **No `--config`**: the schema command does not load the user's
  contract. It runs in any directory and does not need a
  `SchemaArgs.config` field.
- **Path resolution** (single source of truth, used in production):
  ```ts
  const RELATIVE_BUNDLED_PATH = "../../../schemas/v1/agent-ready.schema.json";
  const defaultSchemaPath = () =>
    resolve(dirname(fileURLToPath(import.meta.url)), RELATIVE_BUNDLED_PATH);
  ```
  This relative path matches both `src/cli/commands/schema.ts` (3 levels
  up to repo root) and the built `dist/cli/commands/schema.js` (same
  depth post-build).
- **Default human output**:
  ```
  Agent-Ready contract JSON Schema (bundled with this CLI).
    contract version: 1
    path: <absolute-path-to-schemas/v1/agent-ready.schema.json>
    bytes: <byteCount>
    JSON Schema $schema: https://json-schema.org/draft/2020-12/schema
    JSON Schema $id: https://schemas.agent-ready.dev/v1/agent-ready.schema.json
    title: Agent-Ready Repository Contract (v1, Phase 1 minimal core)
  ```
  - With `--content`, the parsed schema body is pretty-printed and
    appended after a blank line.
- **Default `--json` output**:
  ```json
  {
    "ok": true,
    "schemaPath": "...",
    "contractVersion": 1,
    "draft": "https://json-schema.org/draft/2020-12/schema",
    "id": "https://schemas.agent-ready.dev/v1/agent-ready.schema.json",
    "title": "Agent-Ready Repository Contract (v1, Phase 1 minimal core)",
    "byteCount": 5402,
    "diagnostics": []
  }
  ```
  - With `--content`, an additional `schema` field containing the
    parsed body is added (the full nested JSON Schema object).
- **Exit codes** — within the existing 5-value scheme per
  [ADR-0009](0009-pre-1.0-stability-policy.md):
  - `0` (`ExitCode.SUCCESS`) — bundled schema located, parsed, reported.
  - `10` (`ExitCode.INTERNAL_ERROR`) — bundled schema missing, not
    valid JSON, or top-level value is not an object. Surfaced as
    `INTERNAL_INVARIANT_VIOLATION`. This is the only new failure mode
    and it fits the existing bucket.
- **No new diagnostic codes.** See "Error model" above.
- **Public API**: `runSchema` is **not** exported from
  [`src/index.ts`](../../src/index.ts). Same discipline as every
  other per-command run function.
- **Tests**:
  - **Unit** — `tests/unit/schema.test.ts`. Exercises every flag
    combination and every error path against fixture schemas written
    to a `mkdtemp` directory; injects `schemaPath` via the
    `options.schemaPath` parameter so tests stay hermetic.
  - **Integration** — `tests/integration/schemaCli.test.ts`. Calls
    `runSchema()` with no `options.schemaPath` override so the
    production path-resolution runs from inside vitest, verifying
    `import.meta.url` works correctly for both source (`tsx`) and
    the eventual built `dist/` layout the test fixture would otherwise
    cover.

## Consequences

- The first Path A command is shipped. `agent-ready schema` works in
  any directory (no contract, no repoRoot, no Git), exposes the
  bundled schema by path, by summary, or by full content in a single
  command, and exits 0 on every well-formed installation.
- The bundled schema is reachable without a source checkout — the
  canonical answer to "where is it?" becomes
  `agent-ready schema --json | jq .schemaPath`.
- Zero contract-schema change. Zero new diagnostic code. Zero new exit
  code. Zero new public API surface. Zero new `FileSystem` boundary
  — package-internal reads use `node:fs/promises` directly, mirroring
  the existing `src/cli/index.ts` pattern.
- The `analyze` precedent holds: `action.yml`'s `command` input does
  not gain `schema` in this PR. The composite-action extension that
  would let downstream CI adopters invoke `agent-ready schema` from
  CI is a separate, future PR.
- `docs/specification/cli-reference.md`'s "six commands" framing and
  the "is proposed" wording both become stale; both are updated in
  the same landing per the per-command spec convention.
- `README.md`'s "Planned CLI/package direction (in progress — ADR-0021)"
  section header flips to reflect the first command actually shipped;
  `ROADMAP.md`'s "first command to ship" wording flips to "shipped".

## Reconsideration trigger

- If a future phase introduces user-supplied or remote schemas, this
  command needs a way to know _which_ schema to print. A `--schema <path>`
  or similar flag would be necessary; the current "always the bundled
  one" assumption breaks.
- If multiple bundled schemas become normal (e.g.
  `schemas/v2/agent-ready.schema.json` for contract `version: 2`), an
  explicit `--version` flag — or a default inferred from path —
  diverges from "always `v1`." Today's path-inferred fallback to `1`
  is defensive enough for now.
- If `import.meta.url` does not resolve correctly in a future
  bundler/chunking scheme (e.g. single-file bundles, `bun build --compile`,
  `pkgx`), path resolution must be revisited. Until then, mirroring
  `src/cli/index.ts`'s existing `readFileSync(new URL(...))` approach
  is the lowest-risk choice.
