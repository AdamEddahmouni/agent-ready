# Public API stability

Full policy: [ADR-0009](../decisions/0009-pre-1.0-stability-policy.md).
Quick reference:

| Surface                                       | Status                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `schemas/v1/agent-ready.schema.json`          | Additive changes only within contract `version: 1`.                                              |
| Diagnostic codes (`src/diagnostics/codes.ts`) | Stable identifiers; new codes may be added. Message _text_ is not covered.                       |
| `NormalizedContract` shape                    | Additive changes only, mirroring the schema (including v0.5 `architecture` and `agents`).        |
| CLI `--json` output                           | Additive changes only.                                                                           |
| CLI human-readable (non-JSON) output          | **Not** covered by any compatibility guarantee — do not script against it.                       |
| Everything exported from `src/index.ts`       | Public but **experimental** pre-1.0; may change between minor versions, noted in `CHANGELOG.md`. |
| Anything not exported from `src/index.ts`     | Internal; no compatibility guarantee at any version.                                             |
| Exit codes (`src/diagnostics/exitCodes.ts`)   | Stable pre-1.0.                                                                                  |

## Public programmatic API surface

Everything importable from the package's main entry point
(`import { ... } from "agent-ready"`, i.e. `src/index.ts`) is the
intentional public surface: the contract pipeline (`loadContract`,
`parseYaml`, `validateSchema`, `validateSemantics`, `normalizeContract`),
discovery (`discoverRepositoryContext`), types (`RawContract`,
`NormalizedContract`, and related types), diagnostics (`Diagnostic`,
rendering functions, `resolveExitCode`), and the file-system boundary
(`FileSystem`, `NodeFileSystem`, `InMemoryFileSystem`) — enabling
embedding Agent-Ready's validation pipeline in another tool without
shelling out to the CLI.

Ajv internals, the YAML AST, and CLI argument-parsing internals are
deliberately not exported and carry no guarantee at all.
