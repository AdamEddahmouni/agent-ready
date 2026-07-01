# Architecture overview

## Module map

```text
src/
├── cli/
│   ├── index.ts               Thin composition layer: commander wiring, process.exitCode, stdout/stderr writes.
│   └── commands/
│       ├── validate.ts        runValidate(): pipeline -> rendered output. No CLI-framework dependency.
│       └── inspect.ts         runInspect(): pipeline -> rendered output. No CLI-framework dependency.
├── contract/
│   ├── discovery.ts           Repository-root + contract-file discovery.
│   ├── parseYaml.ts           Safe YAML parsing; returns a plain value + a locate() closure for source spans.
│   ├── schema.ts               Ajv-based JSON Schema validation; maps ajv errors to domain diagnostic codes.
│   ├── semantic.ts            Cross-field validation JSON Schema cannot express.
│   ├── normalize.ts           Pure transform: validated RawContract -> deterministic NormalizedContract.
│   ├── paths.ts                Pure path/glob string normalization and validation (no file-system access).
│   ├── types.ts                RawContract and NormalizedContract type definitions.
│   └── pipeline.ts             Orchestrates discovery -> read -> parse -> schema -> semantic -> normalize.
├── diagnostics/
│   ├── types.ts                Diagnostic, DiagnosticResult, severity.
│   ├── codes.ts                 The stable diagnostic-code registry.
│   ├── humanRender.ts           Diagnostic[] -> designed human text.
│   ├── jsonRender.ts            Diagnostic[] -> stable serializable shape.
│   └── exitCodes.ts             Diagnostic[] -> single process exit code.
├── filesystem/
│   ├── types.ts                 FileSystem interface (the only file-system boundary domain code depends on).
│   ├── nodeFileSystem.ts        Real implementation, backed by node:fs/promises.
│   ├── inMemoryFileSystem.ts    Deterministic test/embedding implementation.
│   └── pathJoin.ts              OS-tolerant join/dirname for real ancestor-directory walking (see below).
└── index.ts                     Public programmatic API (see docs/specification/api-stability.md).
```

## Dependency direction

```text
cli/  --------------------> contract/pipeline.ts --------------------> contract/{discovery,parseYaml,schema,semantic,normalize}
 |                                                                              |
 v                                                                              v
diagnostics/  <----------------------------------------------------  filesystem/ (via injected FileSystem)
```

- `cli/` depends on `contract/` and `diagnostics/`; nothing in
  `contract/` or `diagnostics/` depends on `cli/` or on `commander`.
- `contract/` depends on `filesystem/` only through the `FileSystem`
  interface — never on `node:fs` directly (`src/filesystem/nodeFileSystem.ts`
  is the only file that imports `node:fs/promises` for actual I/O).
- `diagnostics/` has no dependency on any other module in this project —
  it is pure data-shape and rendering logic.
- No module anywhere depends on an AI model, provider, or hosted service.

## Why `filesystem/pathJoin.ts` exists instead of `node:path`

`node:path`'s default export is platform-specific: on Windows it
normalizes output separators to `\`, on POSIX to `/`. That's correct for
typical Node programs, but it broke exactly the property this project
needs: the same discovery/semantic code must behave identically whether
it's walking real OS paths (which use the host's native separator) or, in
tests, a forward-slash `InMemoryFileSystem` regardless of host OS. Both
Windows and POSIX file APIs happily accept forward slashes, so
`pathJoin.ts` implements a tiny, fully-tested, separator-tolerant
join/dirname instead of relying on `node:path`'s platform-specific
normalization. This was discovered and fixed via an actual cross-platform
test failure during development — see the "Testing" section of the
completion report.

## Pipeline stages (see also docs/specification/overview.md)

```text
raw bytes
  |  (contract/discovery.ts, filesystem/nodeFileSystem.ts)
  v
YAML parse result            <- contract/parseYaml.ts (uniqueKeys, size limit, alias cap)
  v
schema-validated contract    <- contract/schema.ts (ajv, draft 2020-12, additionalProperties: false)
  v
semantic validation          <- contract/semantic.ts (references, semver, path safety, existence)
  v
normalized contract          <- contract/normalize.ts (defaults, deterministic ordering)
```

Each arrow is a `DiagnosticResult<T>` boundary: a stage either produces a
value plus (possibly empty) diagnostics, or fails with diagnostics and no
value. `contract/pipeline.ts` is the only place that sequences all five
stages and is also the single place that catches genuinely unexpected
exceptions, converting them to `INTERNAL_INVARIANT_VIOLATION` rather than
letting them propagate as raw stack traces to the CLI.

## File-system boundary

All disk access in domain code (`contract/`) goes through the narrow
`FileSystem` interface (`readTextFile`, `stat`, `realPath`, `cwd`) defined
in `filesystem/types.ts`. This means:

- Unit tests can validate discovery and semantic-validation logic against
  an `InMemoryFileSystem` with no real disk I/O, running in milliseconds
  and with no dependency on the host OS's actual directory layout.
- Integration tests exercise the same code against a real temporary
  directory and `NodeFileSystem`, verifying actual OS behavior.
- The public API (`src/index.ts`) exposes both implementations, so an
  embedder can validate a contract against files it holds only in memory
  (e.g. from a network fetch or an editor buffer) without writing them to
  disk first.

## CLI composition

`src/cli/index.ts` only: parses arguments via `commander`, constructs a
`NodeFileSystem`, calls `runValidate`/`runInspect`, writes their returned
`stdout`/`stderr` strings, and sets `process.exitCode`. It contains no
validation logic itself and never calls `process.exit()` from inside a
command's business logic — `commands/validate.ts` and
`commands/inspect.ts` are plain, directly-testable async functions that
return a `{ exitCode, stdout, stderr }` value rather than performing I/O
themselves, which is what the integration tests in
`tests/integration/cli.test.ts` call directly.

## Explicitly absent (by design, this phase)

- No dependency-injection container, generic plugin/adapter loader, event
  system, or "manager"/"service"/"engine" class with unclear
  responsibility.
- No AI model or provider dependency anywhere.
- No command-execution code path of any kind (see
  [ADR-0006](../decisions/0006-command-representation.md)).
- No hosted-service client code, even as a stub.

See [../../ROADMAP.md](../../ROADMAP.md) for the full non-goals list.
