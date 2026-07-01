# ADR-0002: JSON Schema draft, identity, and compatibility policy

## Status

Accepted

## Context

The public contract needs a formal, independently consumable JSON
Schema (see `schemas/v1/agent-ready.schema.json`), distinct from the
TypeScript types used internally. Several sub-decisions are bundled
here because they are made together and reference each other: schema
draft, `$id`, unknown-field policy, and where defaults live.

## Alternatives considered

- **Draft**: JSON Schema draft-07 (widest tool support) vs. 2020-12
  (current, supports `$defs`/`prefixItems` and clearer vocabulary
  semantics).
- **Unknown fields**: allow (forward-compatible, but silently swallows
  typos) vs. reject (`additionalProperties: false` everywhere).
- **Defaults**: encode defaults in the schema (e.g. `default: []`) vs.
  resolve them only during normalization.

## Decision

- **Draft 2020-12** (`$schema: "https://json-schema.org/draft/2020-12/schema"`).
  Ajv has first-class support via the `ajv/dist/2020` entry point, and the
  clearer `$defs` semantics suit a schema we expect to grow additively.
- **`$id`: `https://schemas.agent-ready.dev/v1/agent-ready.schema.json`.**
  This is a stable identifier only. Per the security requirements (see
  `docs/security/threat-model.md`), the schema is never fetched from this
  URL at runtime; it is always loaded from the local file bundled with the
  package (`schemas/v1/agent-ready.schema.json`, referenced via
  `readFileSync` relative to the compiled module, and also exposed via the
  package's `./schema` export map entry). The `$id` exists for
  external tooling (IDEs, other validators) that may want to associate a
  URL with the schema; Agent-Ready itself does not depend on that URL
  resolving.
- **Unknown fields are rejected everywhere** (`additionalProperties: false`
  at every object level, including nested objects like `project`,
  `environment`, and each command). This matches the "explicit authority"
  and "deterministic" principles: a typo'd or forward-looking field should
  fail loudly during this phase rather than being silently ignored.
- **Defaults are resolved at normalization time, not schema time.** The
  schema declares required vs. optional fields and leaves optional
  collections (e.g. `commands`, `paths.protected`) simply absent when not
  provided. `normalizeContract` (see `src/contract/normalize.ts`) is the
  single place that turns "absent" into `[]` or an empty object. This
  keeps the schema focused on shape/validity and keeps default resolution
  in one auditable, testable place.
- **Version field is a plain `integer, minimum: 1`, not a `const 1`.**
  This lets the schema stay stable as new contract versions are
  introduced later; the semantic-validation stage (not the schema)
  decides which versions this build of the CLI actually supports
  (`CONTRACT_VERSION_UNSUPPORTED`). This is deliberate: bumping supported
  versions should not require a schema change.

## Consequences

- A contract with any misspelled or forward-looking field fails validation
  immediately with `CONTRACT_SCHEMA_INVALID` (or a friendlier field-specific
  code — see ADR-0009), which is the intended, strict Phase 1 behavior.
- Adding new optional fields in a later minor version is additive and
  backward compatible; removing or renaming a field, or tightening a
  constraint, is a breaking schema change and follows the compatibility
  policy in ADR-0010.

## Reconsideration trigger

If Agent-Ready introduces contract version 2 with materially different
shape, decide then whether it is a new schema file
(`schemas/v2/agent-ready.schema.json`) or a discriminated union within one
file. Given the "one field, one meaning" principle so far, a new file per
major contract version is the likely path.
