# ADR-0006: Command representation and safety boundary

## Status

Accepted

## Context

`commands` needs a representation for named repository commands that (a)
is safe to parse and validate without any risk of execution, (b) can
evolve later (e.g. adding a working directory, environment variables, or
a timeout) without a breaking schema change, and (c) has an unambiguous
identifier format for `verification.required` to reference.

## Alternatives considered

- **Bare string form**: `commands: { lint: "pnpm lint" }`.
- **Structured object form**: `commands: { lint: { run: "pnpm lint" } }`.
- **Array-of-entries form**: `commands: [{ name: "lint", run: "pnpm lint" }]`.

## Decision

- **Structured object form, keyed by identifier**:
  ```yaml
  commands:
    lint:
      run: pnpm lint
      description: Optional human-readable description.
  ```
  This is chosen over the bare-string form because it can grow (working
  directory, environment declarations, timeouts, per-command adapter
  hints) in later phases by adding optional sibling fields to the command
  object, without changing the type of the value from string to object —
  a breaking change the bare-string form could not avoid. It is chosen
  over an array-of-entries form because object keys give "one command, one
  name, structurally enforced" for free (see ADR-0009's note on
  `COMMAND_DUPLICATE`), and match how `paths` and `adapters` are already
  keyed.
- **Identifier format: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`** — lowercase,
  kebab-case, starting with a letter (e.g. `lint`, `test`, `test-e2e`).
  This is deliberately restrictive and ASCII-only: it avoids Unicode
  confusable/normalization ambiguity, matches common command-naming
  convention across the npm/pnpm ecosystem, and is simple to document and
  validate via a single regular expression (enforced in the JSON Schema
  via `propertyNames`).
- **`run` is a required, non-empty string; nothing about it is parsed,
  tokenized, or interpreted in this phase.** It is opaque data, stored and
  validated (non-empty, no leading/trailing whitespace) but never split
  into arguments, never checked for shell metacharacters, and never
  resolved against `PATH`. See "Command safety" below.
- **`verification.required` is an ordered array of identifier strings**,
  referencing keys in `commands`. Order is preserved through
  normalization because it is semantically meaningful (the sequence in
  which a future verification phase would run these commands), unlike
  `commands` itself (an unordered map, sorted alphabetically during
  normalization for determinism — see ADR-0009).

## Command safety

Parsing a command, validating its declaration, and executing it are three
distinct, clearly separated concerns:

1. **Parsing**: YAML → a `{ run, description? }` object. No
   interpretation of the string's contents.
2. **Validating**: shape and identifier-format checks (this phase), plus
   cross-referential checks (`verification.required` entries resolve to
   declared commands).
3. **Executing**: invoking `run` in a shell. **This phase implements none
   of this** — there is no code path anywhere in the CLI or library that
   spawns a process, invokes a shell, or otherwise interprets `run` as
   anything other than an opaque string. This is a deliberate,
   load-bearing security boundary (see `docs/security/threat-model.md`),
   not an oversight to be filled in incrementally within this phase.

## Consequences

- Because JS object keys are structurally unique, true "duplicate command
  declaration" (two different `commands` entries claiming the same name)
  cannot occur once YAML parsing succeeds — YAML-level duplicate keys are
  caught earlier, at parse time, as `YAML_DUPLICATE_KEY`. `COMMAND_DUPLICATE`
  is retained in the diagnostic-code registry for forward compatibility
  (e.g. a future multi-source contract merge feature, or a representation
  change) but is not reachable through the current single-file YAML
  pipeline; this is documented explicitly in
  `docs/specification/diagnostics.md` rather than left as an unexplained
  dead code path.
- Adding fields like `workingDirectory` or `env` to a command in a future
  phase is additive to the command object and does not require touching
  `verification.required` or the identifier format.

## Reconsideration trigger

When a future phase implements actual command execution (explicitly out
of scope here), revisit whether `run` needs to become a structured
(argv-array) form to avoid shell interpretation entirely, versus staying
a shell-invoked string with documented shell-quoting rules.
