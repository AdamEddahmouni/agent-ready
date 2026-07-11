# Schema versioning policy

See [ADR-0002](../decisions/0002-json-schema-design.md) and
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md) for full
rationale; this document is the quick reference.

## Contract `version` vs. package version

These are two different numbers:

- **Contract `version`** (the `version: 1` field inside
  `agent-ready.yaml`) identifies the _shape_ of the contract itself. Only
  `1` is supported today.
- **Agent-Ready package version** (in `package.json`, currently `0.4.0-rc.1`)
  identifies the CLI/library release. Multiple package versions can, and
  will, support contract `version: 1` — adding an optional field to the
  schema is a minor package release, not a new contract version.

## What's additive (safe within contract `version: 1`)

- New optional top-level or nested fields.
- New optional adapter names.
- New diagnostic codes.

## What requires a new contract version

- Removing or renaming an existing field.
- Changing a field's required/optional status in a breaking direction
  (optional → required).
- Changing a field's type or fundamental structure (e.g. `commands.<name>`
  changing from an object to a bare string).

A new contract version would live alongside the old one as
`schemas/v2/agent-ready.schema.json` (exact structure to be decided when
it's actually needed — see the reconsideration trigger in
[ADR-0002](../decisions/0002-json-schema-design.md)); existing `version: 1`
contracts continue to validate against `schemas/v1/` unchanged.

## Where the schema lives

The schema is bundled locally with the npm package
(`schemas/v1/agent-ready.schema.json`) and is never fetched from its
`$id` URL at runtime. It is also independently consumable — via the
package's `./schema` export map entry, or by referencing the file
directly — without requiring the CLI or any TypeScript tooling.
