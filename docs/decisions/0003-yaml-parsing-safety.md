# ADR-0003: YAML parser selection and safety configuration

## Status

Accepted

## Context

`agent-ready.yaml` is untrusted input (see `docs/security/threat-model.md`).
The parser choice and its configuration determine whether duplicate keys,
custom tags, and amplification attacks are handled safely.

## Alternatives considered

- **Parser**: `js-yaml` (widely used, but its "unsafe load" historically
  allowed custom JS-type tags; "safe load" is safer but the library's API
  makes it easy to misuse) vs. `yaml` (eemeli/yaml; never evaluates tags
  into executable types regardless of schema, and has first-class
  duplicate-key detection and source-location tracking).
- **Duplicate keys**: silently keep the last value (YAML 1.1/JS object
  default) vs. reject.
- **Source locations**: parse-only (no line/column tracking) vs. retain a
  `LineCounter` for diagnostics.

## Decision

- **Parser: `yaml` (eemeli/yaml), using `parseDocument` rather than
  `YAML.parse`.** This package never resolves tags to executable
  JavaScript types (there is no "unsafe schema" equivalent to `js-yaml`'s
  `!!js/function`); unrecognized tags are just treated as inert scalars.
  Using `parseDocument` (rather than the shortcut `parse`) preserves
  the AST needed for line/column lookups.
- **`uniqueKeys: true` and `strict: true`.** Duplicate mapping keys
  produce a parse error (`YAML_DUPLICATE_KEY`) rather than silently taking
  the last value. `strict` enables the library's full YAML 1.2 spec
  compliance checks (e.g. it also catches other structurally-dubious
  documents).
- **Alias/anchor expansion is capped via `maxAliasCount` (100, the
  library default) at `toJS()` time**, guarding against "billion laughs"
  style amplification through repeated anchor references.
- **A hard file-size limit (`MAX_CONTRACT_BYTES = 1_000_000`, 1 MB)
  is enforced before parsing at all.** This is a blunt but effective and
  easily-audited safety limit; a real Agent-Ready contract is expected to
  be a few kilobytes.
- **Source locations are preserved via `LineCounter` + `keepSourceTokens`,
  exposed through a `locate(jsonPointer)` closure** returned alongside the
  parsed value (see `src/contract/parseYaml.ts`), rather than exposing the
  `yaml` package's own `Document`/`Node` types to downstream code. This
  keeps parser-specific types out of the rest of the pipeline while still
  giving later stages (schema validation) a way to attach line/column
  information to diagnostics.
- **No environment-variable interpolation, no shell expansion, no remote
  or neighboring-file includes.** The parser is only ever given the exact
  bytes read from the one discovered contract file.

## Consequences

- Duplicate keys, which are easy to introduce accidentally (e.g. copy-paste
  of a command block), are caught immediately with a precise line/column
  instead of silently discarding data.
- Depth-based (non-aliased) pathological nesting is not specifically
  bounded beyond the overall file-size limit and normal V8/engine
  recursion limits; this is a documented, accepted limitation for Phase 1
  (see `docs/security/threat-model.md`).

## Reconsideration trigger

If a future phase needs to support multi-document YAML streams or
includes, revisit whether `parseDocument`'s single-document assumption
still holds, and whether an explicit recursion-depth guard becomes
necessary.
