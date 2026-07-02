# Minimal contract reference (v1)

This is the authoritative field-by-field reference for contract
`version: 1`, matching [schemas/v1/agent-ready.schema.json](../../schemas/v1/agent-ready.schema.json)
exactly. **Unknown fields anywhere in this document are rejected.**

## `version` (required, integer)

Must be `1` in this release. Any other integer is syntactically valid
per the schema but rejected during semantic validation with
`CONTRACT_VERSION_UNSUPPORTED` — see [ADR-0002](../decisions/0002-json-schema-design.md).

## `project` (required, object)

| Field         | Required | Type                | Notes                           |
| ------------- | -------- | ------------------- | ------------------------------- |
| `name`        | yes      | string, 1–100 chars | No leading/trailing whitespace. |
| `description` | no       | string, 1–500 chars |                                 |

## `environment` (optional, object)

| Field                    | Required                          | Type                        | Notes                                                                                                                                                                                        |
| ------------------------ | --------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtimes`               | no                                | object                      | Map of runtime name → semver range. Keys must match `^[a-z][a-z0-9]*$` (e.g. `node`, `python`). Values must be a syntactically valid semver range (`RUNTIME_DECLARATION_INVALID` otherwise). |
| `packageManager`         | no                                | object                      | `{ name, version }`.                                                                                                                                                                         |
| `packageManager.name`    | yes (if `packageManager` present) | `"npm" \| "pnpm" \| "yarn"` |                                                                                                                                                                                              |
| `packageManager.version` | yes (if `packageManager` present) | string                      | Must be a valid semver version or range (`PACKAGE_MANAGER_INVALID` otherwise).                                                                                                               |

## `commands` (optional, object)

A map of command identifier → command declaration. Commands are **inert
data**: nothing in this phase executes them (see
[ADR-0006](../decisions/0006-command-representation.md)).

- **Identifier format**: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (lowercase
  kebab-case, e.g. `lint`, `test-e2e`). Violations produce
  `COMMAND_IDENTIFIER_INVALID`.
- **Command declaration**:

  | Field         | Required | Type                | Notes                                                           |
  | ------------- | -------- | ------------------- | --------------------------------------------------------------- |
  | `run`         | yes      | non-empty string    | The literal command line. Never parsed, tokenized, or executed. |
  | `description` | no       | string, 1–300 chars |                                                                 |

Example:

```yaml
commands:
  lint:
    run: pnpm lint
  test:
    run: pnpm test
    description: Runs the unit test suite.
```

## `verification` (optional, object)

| Field      | Required                        | Type                    | Notes                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required` | yes (if `verification` present) | array of strings, min 1 | Ordered list of command identifiers required for verification. Order is preserved through normalization — it is meaningful (see [ADR-0007](../decisions/0007-normalization-ordering.md)). Every entry must reference a key in `commands` (`COMMAND_REFERENCE_INVALID` otherwise); duplicate entries are also `COMMAND_REFERENCE_INVALID`. |

## `paths` (optional, object)

| Field       | Required | Type                          |
| ----------- | -------- | ----------------------------- |
| `protected` | no       | array of glob patterns, min 1 |
| `generated` | no       | array of glob patterns, min 1 |
| `ignored`   | no       | array of glob patterns, min 1 |

See [paths-and-globs.md](paths-and-globs.md) for the supported pattern
subset, normalization rules, and the category-conflict policy (a given
normalized pattern may appear in exactly one category, once, across all
three lists combined).

```yaml
paths:
  protected:
    - ".env*"
  generated:
    - "src/generated/**"
  ignored:
    - "node_modules/**"
    - "dist/**"
```

## `instructions` (optional, object)

| Field     | Required                        | Type                                        | Notes                                                                                                                                                                                                                                        |
| --------- | ------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources` | yes (if `instructions` present) | array of literal repo-relative paths, min 1 | Each must reference a file that actually exists under the repository root (`INSTRUCTION_SOURCE_INVALID` otherwise). Glob metacharacters are not allowed here (these are literal file references, not patterns). Declared order is preserved. |

```yaml
instructions:
  sources:
    - README.md
    - docs/architecture.md
```

## `adapters` (optional, object)

Recognized keys: `agentsMd`, `claude`, `cursor`, `copilot`, `gemini`.
Each maps to `{ enabled: boolean }`; unrecognized adapter keys are
rejected (`ADAPTER_DECLARATION_INVALID`).

Enabling `agentsMd` or `claude` and running `agent-ready generate` (or
`generate --write`) produces `AGENTS.md`/`CLAUDE.md` respectively — see
[cli-reference.md](cli-reference.md#agent-ready-generate). `cursor`,
`copilot`, and `gemini` remain configuration-only: they validate
successfully, but enabling them produces an `ADAPTER_NOT_YET_IMPLEMENTED`
warning at generation time, since no renderer exists for them yet.

```yaml
adapters:
  agentsMd:
    enabled: true
  claude:
    enabled: true
```

## Full example

See [examples/complete-phase-1/agent-ready.yaml](../../examples/complete-phase-1/agent-ready.yaml)
for a contract using every field above, and
[examples/minimal/agent-ready.yaml](../../examples/minimal/agent-ready.yaml)
for the smallest valid contract. [examples/invalid/](../../examples/invalid/)
contains contracts that intentionally fail, one per common mistake.
