# ADR-0024: `agent-ready explain` command — diagnostic-code narration and contract-field guidance

## Status

Accepted and implemented.

## Context

[ADR-0021](0021-cli-package-maturity-direction.md) named `agent-ready explain`
as the third Path A command to ship, sequenced `doctor` → `explain` → `init`
after `agent-ready schema` (ADR-0022 — shipped) and `agent-ready doctor`
(ADR-0023 — shipped). ADR-0021's prompt-text sketched the role:

> reuses the existing diagnostic-code registry; primarily a
> documentation/rendering exercise, not new validation logic.

This ADR scopes that into a concrete command: its input model, output
shapes, contract-loading behavior, exit-code policy, and the per-code
explanation registry it depends on.

The motivation is the second user story from
[docs/implementation-scope-cli-package.md](../implementation-scope-cli-package.md):

> As a maintainer, I can ask the CLI to explain, in plain language,
> what a specific diagnostic code means and what part of my contract
> triggered it, beyond the one-line remediation text already shown.

Every existing diagnostic already carries a `summary` and a
`remediation` string. Those are short and actionable — the right thing
for a CI annotation or a one-line terminal message. They are not a
tutorial. A contributor who sees `PACKAGE_MANAGER_UNAVAILABLE` for the
first time wants to know: what does this code mean conceptually, why
does Agent-Ready check for it, what fields of `agent-ready.yaml`
control it, and what concrete steps (with examples) fix it. Today they
read the source or search the diagnostics reference table. `agent-ready
explain` makes that a single command.

The diagnostic-code registry (`src/diagnostics/codes.ts`) already lists
every code the CLI can emit. That registry — plus the existing
`summary`/`remediation`/`field` shape from
[ADR-0008](0008-diagnostics-and-exit-codes.md) — is the only data
source `explain` needs. It needs no new validation, no new environment
probes, and no new abstraction boundary.

## Alternatives considered

- **Input model: `--code <CODE>` vs stdin vs previous-run JSON**:
  - _`--code <CODE>`_: simplest mechanism — one flag, one value,
    one output. Matches the "I just saw this code and want to understand
    it" flow.
  - _Read from stdin (piped previous `--json` output)_: could
    extract the diagnostic code and contract path automatically, adding
    contract-field context without a separate `--config`. But it
    requires parsing unknown upstream JSON, handling multiple
    diagnostics in one input, and deciding which one to target.
  - _Read a previous-run evidence file_: couples `explain` to
    `verify --record`'s output shape, which is a different command's
    concern.
  - **Selected: `--code <CODE>`**, with an optional `--config <path>`
    for contract-field context. The simplest mechanism that solves the
    user story. Piping or JSON-parsing can be added later via a
    reconsideration trigger if usage evidence justifies it.

- **Should `explain` load a contract?**
  - _Never_: explain is a generic code → explanation lookup. Always
    works, no contract required.
  - _Always_: adds field-specific guidance (which lines of your
    `agent-ready.yaml` triggered this), but makes the command unusable
    in the "I just installed Agent-Ready and saw an error" flow where
    no contract exists.
  - **Selected: optional, via `--config <path>`.** Without `--config`,
    `explain` prints a generic extended explanation for the diagnostic
    code — useful for learning and debugging without a repository.
    With `--config`, `explain` loads and validates the contract (same
    `loadContract` pipeline as `doctor`/`check`/`analyze`/`verify`),
    and the output includes a "Your contract" section showing the
    relevant field values and their relationship to the diagnostic.
    This mirrors `doctor`'s approach: contract context makes the
    output load-bearing, but the command degrades gracefully without it.

- **Explanation registry: inline object vs external data file**:
  - _Inline TypeScript object_: straightforward, typed, no file I/O,
    no schema. The diagnostic-code registry is itself a TypeScript
    array (`DIAGNOSTIC_CODES` in `src/diagnostics/codes.ts`) — a
    parallel map of code → explanation text is the smallest delta.
  - _External Markdown/YAML/JSON file_: easier to contribute to, but
    adds a file-format dependency and a parse step for something that
    is essentially static documentation.
  - **Selected: inline TypeScript object** (`ExplanationRegistry`).
    The diagnostic-code list is already TypeScript; a companion map
    keeps the two in lockstep and lets a future
    `ExplanationRegistry` type-check that every registered code has an
    entry. The registry is not exported from `src/index.ts` — same
    discipline as every other per-command module.

- **Output shape: one section or multiple?**
  - _One prose paragraph_: too dense; the user who needs `explain`
    needs structured information, not a wall of text.
  - _Multiple labeled sections_: "What it means," "Why it happens,"
    "How to fix it," "Related codes" — recognizable, scannable, and
    maps cleanly to both human and `--json` output.
  - **Selected: structured multi-section output.** Human output uses
    labeled sections; `--json` output uses named fields so tools can
    extract individual sections.

- **New diagnostic codes?** No. `explain` is read-only documentation
  rendering. It produces no diagnostics of its own — only user-facing
  explanation text. The only failure mode is an unknown code (`--code
  bogus`), which is a usage error (exit 1), not an internal invariant.

- **Should `explain` update `action.yml`?** No, following the
  `schema`/`doctor` precedent: the composite-action extension is a
  separate, future PR.

- **`CliOutcome` shape**: reuse
  [`src/cli/commands/validate.ts`](../../src/cli/commands/validate.ts)'s
  `CliOutcome` interface — `{ exitCode, stdout, stderr }`. Same as
  every other command.

## Decision

- **New `src/cli/commands/explain.ts`** exporting
  `runExplain(fs, args, startDir?)` returning `Promise<CliOutcome>`.
  The `(fs, args, startDir)` shape matches `runValidate` / `runAnalyze` —
  `FileSystem` is needed only when `--config` is given (for contract
  loading); when `--config` is absent the fs parameter is unused but
  the signature stays uniform with the rest of `cli/commands/*`.

- **New `src/cli/commands/explainRegistry.ts`** exporting an
  `ExplanationRegistry` — a `Map<DiagnosticCode, Explanation>` where:

  ```ts
  interface Explanation {
    /** One- to two-sentence plain-language definition of what this code means. */
    readonly what: string;
    /** Why Agent-Ready checks for this condition and what the user should understand about it. */
    readonly why: string;
    /** Step-by-step remediation, with concrete YAML or shell examples where helpful. */
    readonly fix: string;
    /**
     * JSON Pointer paths to contract fields this diagnostic commonly
     * relates to (e.g. ["/environment/packageManager"]). When
     * `--config` is given, explain reads these fields from the loaded
     * contract and surfaces their values in the "Your contract"
     * section. Empty or absent when the diagnostic has no contract-
     * field relationship (e.g. YAML_PARSE_FAILED relates to the file
     * itself, not a field within it).
     */
    readonly fields?: readonly string[];
    /** Stable diagnostic codes commonly related to this one (e.g. PACKAGE_MANAGER_UNAVAILABLE relates to PACKAGE_MANAGER_VERSION_MISMATCH). */
    readonly related?: readonly DiagnosticCode[];
  }
  ```

  The registry is a static module-level constant keyed by the exact
  `DiagnosticCode` string union. Every code in `DIAGNOSTIC_CODES` has
  an entry; a unit test asserts this so the registry cannot drift from
  the code list.

- **Wired into `src/cli/index.ts`** via commander following the
  existing per-command pattern.

- **Flags**:
  - `--code <CODE>` — (required) the diagnostic code to explain.
    Validated against `isDiagnosticCode()`; unrecognized codes produce
    a usage error (exit 1, plain text, no `Diagnostic`).
  - `--json` — structured JSON output (uniform with every other
    command).
  - `--config <path>` — optional contract path. When given, loads and
    validates through the same pipeline as
    `doctor`/`check`/`analyze`/`verify`, and the output includes a
    "Your contract" section showing relevant field values.

- **Default human output** (no `--config`):

  ```text
  agent-ready explain PACKAGE_MANAGER_UNAVAILABLE

  What it means:
    The contract declares a package manager (pnpm, npm, or yarn) that is
    not installed or not on your PATH. Agent-Ready tried to probe the
    declared manager by running its --version command and could not
    find it.

  Why it happens:
    Agent-Ready checks for the declared package manager so that commands
    like agent-ready verify --execute (which shell out to pnpm lint,
    pnpm test, etc.) have a known, configured executable available.
    Without it, verification commands would fail with "command not
    found" instead of a clear diagnostic.

  How to fix it:
    1. Install the declared package manager. For pnpm:
         npm install -g pnpm
    2. Verify it is on your PATH:
         pnpm --version
    3. Or, update agent-ready.yaml to declare the package manager you
       already use:
         environment:
           packageManager:
             name: npm
             version: "10"
    4. Re-run agent-ready doctor to confirm the environment is fit.

  Related codes:
    PACKAGE_MANAGER_VERSION_MISMATCH, PACKAGE_MANAGER_INVALID
  ```

- **Default `--json` output** (no `--config`):

  ```json
  {
    "ok": true,
    "code": "PACKAGE_MANAGER_UNAVAILABLE",
    "severity": "error",
    "what": "The contract declares a package manager that is not installed or not on your PATH.",
    "why": "Agent-Ready checks so verification commands have a known executable available.",
    "fix": "1. Install the declared package manager.\n2. Verify it is on your PATH.\n3. Or update agent-ready.yaml.\n4. Re-run agent-ready doctor.",
    "related": ["PACKAGE_MANAGER_VERSION_MISMATCH", "PACKAGE_MANAGER_INVALID"],
    "diagnostics": []
  }
  ```

- **Human output with `--config`**: appends a "Your contract" section
  after "How to fix it":

  ```text
  Your contract (/path/to/agent-ready.yaml):
    environment.packageManager = { name: "pnpm", version: "10" }

    → If agent-ready doctor reports package-manager: fail, run:
      npm install -g pnpm  (or switch environment.packageManager.name)
      Then re-run agent-ready doctor to confirm the fix.
  ```

  The "Your contract" section is contract-field-aware: it reads the
  relevant field(s) from the loaded contract (derived from the
  diagnostic code's `Explanation.fields` array). The section is
  omitted when the code has no declared contract-field relationship
  (e.g. `YAML_PARSE_FAILED`, `CONTRACT_NOT_FOUND`). When a code's
  `fields` array contains a pointer that is absent from the loaded
  contract (e.g. `--config` was given for a minimal contract), that
  pointer is listed with the note "(not declared)". Explain never
  invokes `doctor` internally; it only reads static contract data.

- **JSON output with `--config`** adds `contractPath`, `repoRoot`,
  and a `contractFields` array:

  ```json
  {
    "ok": true,
    "code": "GIT_REQUIRED_BUT_UNAVAILABLE",
    "severity": "error",
    "what": "...",
    "why": "...",
    "fix": "...",
    "related": ["GIT_UNAVAILABLE"],
    "contractPath": "/path/to/agent-ready.yaml",
    "repoRoot": "/path",
    "contractFields": [
      {
        "field": "/paths/protected",
        "value": [".env*"],
        "note": "paths.protected is declared; agent-ready check requires git."
      }
    ],
    "diagnostics": []
  }
  ```

  When `--config` is given but contract load fails, `ok` is `false`
  and `diagnostics` contains the load errors — mirroring `doctor`'s
  contract-load failure behavior. The explanation for the code itself
  is still printed (or included in JSON) because an invalid contract
  doesn't make the diagnostic-code definition any less valid.

- **Exit codes** — within the existing 5-value scheme per
  [ADR-0009](0009-pre-1.0-stability-policy.md):
  - `0` (`ExitCode.SUCCESS`) — code recognized, explanation rendered.
  - `1` (`ExitCode.VALIDATION_FAILED`) — `--code` value is not a
    recognized diagnostic code (plain usage error, not a `Diagnostic`;
    stderr carries the message, `resolveExitCode` is not involved); or
    `--config` was given and the loaded contract has validation errors
    surfaced through `resolveExitCode`.
  - `2` (`ExitCode.CONTRACT_NOT_FOUND`) — `--config` given but
    contract not found or not readable.

- **No new diagnostic codes.** `explain` is a read-only documentation
  renderer; the only failure modes are usage errors (unrecognized
  `--code`) and contract-load failures (which reuse existing
  diagnostic codes from the pipeline).

- **No new abstraction boundaries.** No `BinaryClient`, no `GitClient`,
  no `CommandRunner`. `FileSystem` is needed only when `--config` is
  given and flows through the existing `loadContract` pipeline.

- **Public API**: `runExplain` and the `ExplanationRegistry` are
  **not** exported from [`src/index.ts`](../../src/index.ts). Same
  discipline as every other per-command run function.

- **Tests**:
  - **Unit** — `tests/unit/explain.test.ts`. Exercises:
    - every flag combination (`--code`/`--code --json`/`--code
      --config`/`--code --json --config`).
    - every diagnostic code has a registry entry (structural invariant
      test).
    - unrecognized `--code` → exit 1, human error message.
    - `--config` with a valid contract → contractFields populated.
    - `--config` with a missing contract → exit 2.
    - `--config` with an invalid contract → exit 1, diagnostics in
      output.
  - **Integration** — `tests/integration/explainCli.test.ts`.
    End-to-end via `runExplain(...)` against a `mkdtemp` working tree
    containing a fixture contract. Verifies exit codes, human output
    structure, JSON envelope shape, and the "Your contract" section.
    Mirrors `tests/integration/doctorCli.test.ts` in pattern.

## Consequences

- `agent-ready explain` is the third Path A command shipped. Path A's
  post-`doctor` sequence (`explain` → `init`) advances one step.
- The diagnostic-code registry becomes load-bearing for a second
  consumer (after the existing diagnostic renderers): every registered
  code now also has an extended explanation that a user can access
  directly from the CLI.
- A new `ExplanationRegistry` (inline TypeScript map) is the only new
  module; it carries a structural invariant test that every
  `DIAGNOSTIC_CODES` entry has a corresponding explanation, so
  future diagnostic-code additions cannot widen the code list without
  also adding an `explain` entry.
- Zero contract-schema change. Zero new diagnostic code. Zero new
  abstraction boundary. Zero new exit code. `action.yml` is not
  updated in this PR (same `schema`/`doctor` precedent).
- The "Your contract" section when `--config` is given reuses
  `loadContract` — the same pipeline `doctor`/`check`/`analyze`/
  `verify` already use — so `explain`'s contract-load path is
  exercised by the same validation infrastructure every other
  contract-loading command already exercises.
- The CLI reference, diagnostics spec, implementation-scope status
  table, and Path A documentation are all updated in the same landing
  per the per-command convention established through
  [ADR-0022](0022-agent-ready-schema-command.md).

## Reconsideration trigger

- If a `--pipe` or `--from-json <path>` input mode becomes warranted
  by usage evidence (e.g. users want `agent-ready validate --json |
  agent-ready explain` without retyping a diagnostic code), add it
  behind a separate flag — the `--code` default stays unchanged.
- If the `ExplanationRegistry` grows large enough that an inline
  TypeScript map is unwieldy (200+ entries), consider extracting it to
  a data file (JSON or YAML) with a compile-time validation step. For
  today's ~40 codes this is premature.
- If a future command (e.g. `agent-ready init`) wants to
  programmatically consume explanations during an interactive wizard,
  the `ExplanationRegistry` can be exported from `src/index.ts` behind
  its own ADR — today it stays internal per the existing CLI-command
  discipline.
