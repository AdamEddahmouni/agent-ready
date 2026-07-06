# ADR-0025: `agent-ready init` command — starter contract scaffold writer

## Status

Accepted. Implemented per this ADR in the same landing: `src/cli/commands/init.ts`
and `src/cli/commands/initDetect.ts`, wired into `src/cli/index.ts`,
with one new diagnostic code (`INIT_CONTRACT_EXISTS`) and comprehensive
test coverage (unit, integration, and adversarial). Path A is now
complete: `schema` → `doctor` → `explain` → `init`.

## Context

[ADR-0021](0021-cli-package-maturity-direction.md) named `agent-ready init`
as the final Path A command, sequenced last after `agent-ready schema`
(ADR-0022 — shipped), `agent-ready doctor` (ADR-0023 — shipped), and
`agent-ready explain` (ADR-0024 — shipped). ADR-0021's prompt-text
sketched the role:

> the only one that writes; a starter `agent-ready.yaml` scaffolder
> from repository inspection. Mirrors `generate --write`'s "refuse to
> overwrite without `--force`" pattern and `verify --execute`'s "default
> to dry run, require explicit opt in" posture. Sequenced last because
> it is the only second writer in the codebase and deserves a second
> proof point from `doctor`/`explain` before it ships.

This ADR scopes that into a concrete command: its repository-inspection
model, detection heuristics, output shapes, write-boundary design,
contract-validation behavior, exit-code policy, and how it differs from
`generate --write` as the codebase's second (and higher-stakes) writer.

The motivation is the first user story from
[docs/implementation-scope-cli-package.md](../implementation-scope-cli-package.md):

> As a maintainer with no `agent-ready.yaml` yet, I can generate a
> starter contract from what's actually in my repository (detected
> package manager, detected test/lint/build scripts from
> `package.json`), review it, and adjust it — without starting from a
> blank file.

Today, adopting Agent-Ready means hand-authoring the first
`agent-ready.yaml` from the examples in `examples/` or the spec. `init`
replaces that manual step with a single command that inspects the
repository and emits a valid, schema-conformant starter contract the
maintainer reviews and adjusts.

## Alternatives considered

- **Overwrite policy: refuse always vs. refuse-with-`--force`**:
  - _Refuse always_: if `agent-ready.yaml` exists at the repo root,
    `init` exits with a clear message and a non-zero exit code.
    Matches [implementation-scope](../implementation-scope-cli-package.md)'s
    "Never overwrites an existing contract file." The contract is the
    repository's source of truth — unlike generated adapter output
    (`AGENTS.md`, etc.), it is never a candidate for silent or forced
    overwrite. A maintainer who wants a fresh start can delete or
    rename the existing file.
  - _Refuse with `--force` override_: matches `generate --write`'s
    pattern exactly. ADR-0021's sketch suggested this. But the contract
    is not generated output — it is hand-authored, version-controlled
    configuration whose loss is not recoverable from source (unlike
    `AGENTS.md`, which `generate` can reproduce deterministically).
  - **Selected: refuse always, no `--force` flag.** This departs from
    ADR-0021's preliminary sketch in favor of the stricter policy the
    implementation-scope document already asserts. The contract's
    irreplaceability warrants a stronger guardrail than generated
    adapter output. The dry-run default (`agent-ready init` prints to
    stdout without writing) already gives the review-before-write path;
    no `--force` is needed to close a gap.

- **Repo-root discovery without an existing contract**:
  - _Reuse `discoverRepositoryContext`_: the normal discovery pipeline
    looks for `agent-ready.yaml` and stops at `.git` boundaries. Since
    `init` exists precisely because no contract exists yet, the normal
    pipeline would always return `CONTRACT_NOT_FOUND`.
  - _Walk upward for `.git` only_: same ancestor-search logic as
    `discoverByAncestorSearch` but checking only for a `.git` entry
    (file or directory), not the contract. Stops at the first `.git`
    found; falls back to `cwd` if no `.git` exists anywhere in the
    ancestry. Bounded by the same `MAX_ANCESTOR_DEPTH` (64).
  - _Accept an explicit `--root <path>` flag_: lets the user specify
    the repo root explicitly, bypassing the `.git` search.
  - **Selected: walk upward for `.git`, fall back to `cwd`.** No new
    CLI flag — `init`'s purpose is "scaffold for this repo," and the
    repo root is well-defined by the `.git` boundary the rest of
    Agent-Ready already uses. An explicit-root escape hatch can be
    added later if usage evidence justifies it, but the `startDir`
    parameter (internal, same as every other command) already lets
    tests control the search root.

- **What repository artifacts should `init` inspect?**
  - _`package.json` only_: covers the common case (Node/TypeScript
    projects) but produces an empty contract for non-Node repos.
  - _`package.json` + lock files + `.nvmrc`/`.node-version` + docs
    directory + `.gitignore`_: covers the adoption-friction user
    story comprehensively without reaching into framework detection
    (a non-goal).
  - _Full framework detection (Next.js, React, Python, Rust, etc.)_:
    out of scope — framework detection is an explicit non-goal in
    [ROADMAP.md](../../ROADMAP.md), and the contract schema doesn't
    have framework-specific fields to populate anyway.
  - **Selected: `package.json` + lock files + `.nvmrc`/`.node-version`
    + documentation files + `.gitignore`.** The detection surface is
    deliberately narrowed to artifacts the contract schema already
    has fields for: `project.name`/`description`, `environment.*`,
    `commands`, `verification.required`, `paths.*`,
    `instructions.sources`. Every detected value maps to an existing
    schema field — no new field is smuggled in.

- **Should `init` validate its own output before writing?**
  - _Never validate_: faster, but risks writing an invalid contract
    that the user then has to debug with `agent-ready validate`.
  - _Always validate before `--write`_: guarantees the written file
    passes `agent-ready validate` on the same Agent-Ready version that
    generated it. Adds a pipeline run (parse → schema-validate →
    semantic-validate → normalize) on the generated YAML string. If
    validation fails, the write is aborted and the diagnostics are
    reported — `init` never writes an invalid contract. This is the
    same "validate before writing" discipline `check`/`verify` use:
    the contract pipeline runs before any side effect.
  - **Selected: always validate before `--write`.** `init`'s value
    proposition is "a valid starter contract in one command." Writing
    invalid YAML that the user must then debug would undermine that
    proposition. The dry-run path (`init` without `--write`) prints
    the generated YAML but also runs validation and reports any
    diagnostics — the user sees both the proposed contract and
    whether it would pass validation, before committing to `--write`.

- **Detection heuristics: aggressive vs. conservative**:
  - _Aggressive_: detect every `package.json` script and populate
    `commands` with all of them. Risks generating a noisy, 20-entry
    `commands` block the user must cull.
  - _Conservative_: populate only well-known script names (`lint`,
    `test`, `build`, `typecheck`, `format`, `check`). Misses
    project-specific commands but keeps the starter contract focused.
  - **Selected: conservative, with a clear comment in the generated
    YAML noting which scripts were detected and which were skipped.**
    The generated contract includes a YAML comment header explaining
    every detection decision, so the user knows what `init` found and
    can add the skipped scripts themselves. The well-known set is:
    `lint`, `test`, `build`, `typecheck`, `format`, `check`,
    `test-e2e`, `ci`.

- **Output shape: plain YAML vs. annotated YAML with detection
  comments**:
  - _Plain YAML_: minimal, clean, identical to what the user would
    hand-write. But the user has no visibility into *why* `init` made
    each choice.
  - _Annotated YAML_: the generated file begins with a YAML comment
    block summarizing what `init` detected and why each field was
    populated. The contract itself (below the comments) is plain,
    schema-conformant YAML — the comments do not affect validation
    because YAML parsers discard them.
  - **Selected: annotated YAML with a detection-summary comment
    header.** The header is the "review this" section the user story
    calls for: it makes the scaffolding decisions transparent so the
    user can adjust them before the first `agent-ready validate`.

- **Should `init` use a managed-file marker like `generate`?**
  - _Yes (ADR-0010-style marker)_: `init --write` embeds a machine-
    checkable comment so a future `init` re-run could detect it was
    previously generated. But `init` refuses to run when
    `agent-ready.yaml` exists at all, so the marker would never be
    read by a second `init` invocation.
  - _No marker_: the contract is not machine-regenerated the way
    adapter output is. The user edits it immediately after `init`,
    and the marker would either confuse them or become stale on the
    first edit.
  - **Selected: no managed-file marker.** `init` writes exactly once,
    into an empty slot. The contract is not regenerable — unlike
    `AGENTS.md`, which `generate` can reproduce deterministically
    from the contract. The marker's purpose (distinguishing generated
    from hand-authored content for safe overwrite) does not apply
    when overwrite is refused unconditionally.

- **New diagnostic codes?** One: `INIT_CONTRACT_EXISTS`. `init` is the
  first command whose primary failure mode is "the thing this command
  would create already exists." This is a user-actionable condition
  (the user can delete or rename the existing file) but is not a
  contract-validation failure — no contract was loaded or validated.
  A single new diagnostic code, additive per
  [ADR-0009](0009-pre-1.0-stability-policy.md), captures this cleanly.
  A write failure (`INIT_WRITE_FAILED`) maps to the existing
  `INTERNAL_ERROR` (10) bucket — same as `GENERATE_WRITE_FAILED`.

- **`CliOutcome` shape**: reuse
  [`src/cli/commands/validate.ts`](../../src/cli/commands/validate.ts)'s
  `CliOutcome` interface — `{ exitCode, stdout, stderr }`. Same as
  every other command.

- **Should `init` appear in `action.yml`?** No, in this ADR's PR.
  Following the `schema`/`doctor`/`explain` precedent: the composite-
  action extension is a separate, future PR. `init` is an interactive
  scaffolding command, not a CI command — it's unlikely to be useful
  in the composite action at all, but the same "separate PR" precedent
  applies regardless.

## Decision

- **New `src/cli/commands/init.ts`** exporting
  `runInit(fs, args, startDir?)` returning `Promise<CliOutcome>`.
  The `(fs, args, startDir)` shape matches `runValidate` /
  `runGenerate` — `FileSystem` is needed for repo-root discovery,
  artifact reading (`package.json`, lock files, `.gitignore`, doc
  files), and, when `--write` is given, writing the generated
  contract.

- **New `src/cli/commands/initDetect.ts`** exporting pure inspection
  functions — one per artifact — so the detection logic is unit-
  testable independently of the CLI rendering and write path:

  ```ts
  interface InitDetection {
    /** Detected project name (from package.json "name" or directory name). */
    readonly projectName: string;
    /** Detected project description (from package.json "description"), if any. */
    readonly projectDescription?: string;
    /** Detected Node version range (from package.json engines.node, .nvmrc, or .node-version). */
    readonly nodeRange?: string;
    /** Detected package manager (from package.json packageManager or lock files). */
    readonly packageManager?: { readonly name: "npm" | "pnpm" | "yarn"; readonly version: string };
    /** Well-known scripts detected in package.json, ready for commands block. */
    readonly detectedScripts: Readonly<Record<string, string>>;
    /** Script names recommended for verification.required (subset of detectedScripts keys). */
    readonly verificationScripts: readonly string[];
    /** Existing documentation files detected at the repo root. */
    readonly docSources: readonly string[];
    /** Path patterns detected from .gitignore suitable for paths.ignored. */
    readonly ignoredPatterns: readonly string[];
    /** Whether a .env* pattern appears in .gitignore (suggests paths.protected). */
    readonly hasEnvInGitignore: boolean;
  }
  ```

  Detection heuristics (each in its own pure function):

  1. **Project name**: `package.json`'s `name` field, stripped of
     scope prefix (`@scope/`). Falls back to the repo-root directory
     name. Validated against the schema's `project.name` pattern
     (`^\S(?:.*\S)?$`, 1–100 chars); if the fallback name violates
     the pattern, `init` sanitizes it (replaces runs of whitespace
     with `-`, truncates to 100 chars) and notes the sanitization in
     the detection-summary comment.

  2. **Project description**: `package.json`'s `description` field,
     if present and within the schema's 1–500 char constraint.

  3. **Node runtime**: `package.json`'s `engines.node` field, if
     present and a non-`"*"` value. If absent, reads `.nvmrc` or
     `.node-version` (whichever exists; `.nvmrc` preferred) and
     converts the version string to a semver range (e.g. `20` →
     `>=20 <21`, `20.10.0` → `>=20.10.0 <21`). Both files are
     plain-text, single-line reads.

  4. **Package manager**: `package.json`'s `packageManager` field
     (e.g. `"pnpm@10.0.0"`), parsed to extract name and version.
     If absent, detects lock files at the repo root:
     `pnpm-lock.yaml` → `{ name: "pnpm", version: "10" }`,
     `yarn.lock` → `{ name: "yarn", version: "1" }`,
     `package-lock.json` → `{ name: "npm", version: "10" }`.
     The version for lock-file-detected managers is a conservative
     default (`"1"` for yarn, `"10"` for npm/pnpm) noted in the
     detection-summary comment with a recommendation to pin the
     actual installed version.

  5. **Scripts**: reads `package.json`'s `scripts` field. Includes
     only well-known keys: `lint`, `test`, `build`, `typecheck`,
     `format`, `check`, `test-e2e`, `ci`. Each becomes a
     `commands` entry with the script's value as `run`. The
     detection-summary comment lists every script key that was
     *skipped* (not in the well-known set) so the user can add them
     manually.

  6. **Verification**: scripts whose keys are in the subset
     `["lint", "typecheck", "test", "build"]` are added to
     `verification.required` in the order they appear in
     `package.json.scripts` — not the well-known order — because a
     project that declares `test` before `lint` likely has a reason
     (e.g. `test` sets up state `lint` depends on). The user can
     reorder after scaffolding.

  7. **Documentation sources**: checks for the existence of
     `README.md`, `CONTRIBUTING.md`, and any
     `.md` files directly under `docs/` (one level deep only —
     `docs/*.md`). Existing files become `instructions.sources`
     entries. A `docs/` directory with subdirectories is noted in
     the detection-summary comment but its children are not
     auto-included (the user should curate which specific docs
     files are instruction sources).

  8. **Paths**: reads `.gitignore` (if present) and extracts
     patterns suitable for `paths.ignored`. Only includes patterns
     that are already in the schema's supported glob subset (no
     extglobs, no negation beyond leading `!`). The detection-
     summary comment lists every `.gitignore` pattern that was
     *skipped* (unsupported syntax) so the user can add them
     manually. If `.env*` or `.env` appears in `.gitignore`,
     suggests `paths.protected: [".env*"]` — this is the single
     most common protected-path use case.

  9. **Adapters**: all five adapters (`agentsMd`, `claude`,
     `cursor`, `copilot`, `gemini`) are enabled by default. The
     detection-summary comment notes this and points to
     `agent-ready generate` for the next step.

- **Wired into `src/cli/index.ts`** via commander following the
  existing per-command pattern.

- **Flags**:

  - `--write` — write `agent-ready.yaml` to the detected repo root.
    Without this flag, `init` prints the generated YAML to stdout
    (dry run) and exits 0 regardless of validation outcome — the
    user is reviewing, not committing.
  - `--json` — structured JSON output (uniform with every other
    command).

  No `--config`, no `--force`, no `--output`. `init` always writes
  to the canonical `agent-ready.yaml` at the detected repo root.
  The dry-run path (`init` without `--write`) lets the user pipe to
  an arbitrary location: `agent-ready init > /tmp/agent-ready.yaml`.

- **Dry-run output** (human, no `--write`):

  ```text
  agent-ready init - repoRoot: /path/to/my-project

  Detected:
    project name: my-project (from package.json)
    package manager: pnpm (from package.json packageManager field)
    Node range: >=20 (from .nvmrc)
    scripts: lint, test, build, typecheck (4 included; 3 skipped: dev, start, clean)
    verification order: lint → typecheck → test → build
    doc sources: README.md, CONTRIBUTING.md, docs/architecture.md
    .gitignore patterns: node_modules/, dist/, .env* (3 included; 0 skipped)
    adapters: all 5 enabled (agentsMd, claude, cursor, copilot, gemini)

  --- proposed agent-ready.yaml ----------------------------------------
  # Generated by agent-ready init on 2026-07-06.
  # Review each section before your first agent-ready validate.
  # Detection summary:
  #   - project.name: from package.json "name"
  #   - project.description: from package.json "description"
  #   - environment.runtimes.node: from .nvmrc ("20" → ">=20 <21")
  #   - environment.packageManager: from package.json packageManager field ("pnpm@10.0.0")
  #   - commands: from package.json scripts (well-known subset)
  #   - verification.required: lint → typecheck → test → build
  #   - instructions.sources: existing README.md, CONTRIBUTING.md, docs/*.md
  #   - paths.ignored: from .gitignore (supported subset)
  #   - paths.protected: .env* in .gitignore → suggested
  #   - adapters: all 5 enabled (opt-out)
  #   - Skipped scripts: dev, start, clean

  version: 1

  project:
    name: my-project
    description: A starter Agent-Ready contract.

  environment:
    runtimes:
      node: ">=20 <21"
    packageManager:
      name: pnpm
      version: "10"

  commands:
    lint:
      run: pnpm lint
    typecheck:
      run: pnpm typecheck
    test:
      run: pnpm test
    build:
      run: pnpm build

  verification:
    required:
      - lint
      - typecheck
      - test
      - build

  paths:
    protected:
      - ".env*"
    ignored:
      - "node_modules/"
      - "dist/"

  instructions:
    sources:
      - README.md
      - CONTRIBUTING.md
      - docs/architecture.md

  adapters:
    agentsMd:
      enabled: true
    claude:
      enabled: true
    cursor:
      enabled: true
    copilot:
      enabled: true
    gemini:
      enabled: true

  ---
  Validation: would pass agent-ready validate.
  Run `agent-ready init --write` to create this file at
    /path/to/my-project/agent-ready.yaml
  ```

- **Write output** (`--write`, success):

  ```text
  agent-ready init - repoRoot: /path/to/my-project

  Detected:
    (same detection summary as dry run)

  Wrote agent-ready.yaml (4 commands, 4 verification steps).
  Next steps:
    agent-ready validate
    agent-ready doctor
    agent-ready generate --write
  ```

  If validation fails during `--write`, the write is aborted and
  diagnostics are rendered to stderr — `init` never writes an
  invalid contract.

- **JSON output** (`--json`, dry run):

  ```json
  {
    "ok": true,
    "repoRoot": "/path/to/my-project",
    "mode": "dry-run",
    "detection": {
      "projectName": "my-project",
      "projectNameSource": "package.json",
      "packageManager": { "name": "pnpm", "version": "10" },
      "packageManagerSource": "package.json",
      "nodeRange": ">=20 <21",
      "nodeRangeSource": ".nvmrc",
      "scriptsIncluded": ["lint", "typecheck", "test", "build"],
      "scriptsSkipped": ["dev", "start", "clean"],
      "verificationScripts": ["lint", "typecheck", "test", "build"],
      "docSources": ["README.md", "CONTRIBUTING.md", "docs/architecture.md"],
      "ignoredPatterns": ["node_modules/", "dist/"],
      "hasEnvInGitignore": true
    },
    "contract": {
      "version": 1,
      "project": { "name": "my-project", "description": "A starter Agent-Ready contract." },
      "environment": {
        "runtimes": { "node": ">=20 <21" },
        "packageManager": { "name": "pnpm", "version": "10" }
      },
      "commands": {
        "lint": { "run": "pnpm lint" },
        "typecheck": { "run": "pnpm typecheck" },
        "test": { "run": "pnpm test" },
        "build": { "run": "pnpm build" }
      },
      "verification": { "required": ["lint", "typecheck", "test", "build"] },
      "paths": { "protected": [".env*"], "ignored": ["node_modules/", "dist/"] },
      "instructions": { "sources": ["README.md", "CONTRIBUTING.md", "docs/architecture.md"] },
      "adapters": {
        "agentsMd": { "enabled": true },
        "claude": { "enabled": true },
        "cursor": { "enabled": true },
        "copilot": { "enabled": true },
        "gemini": { "enabled": true }
      }
    },
    "validationPassed": true,
    "diagnostics": []
  }
  ```

  With `--write`, `mode` is `"write"` and the output adds
  `contractPath`. When `validationPassed` is `false`, `diagnostics`
  contains the validation errors and the `contract` field is still
  present (the user can inspect what would have been written).

- **JSON output** (`--json --write`, contract already exists):

  ```json
  {
    "ok": false,
    "repoRoot": "/path/to/my-project",
    "mode": "write",
    "contractPath": "/path/to/my-project/agent-ready.yaml",
    "diagnostics": [
      {
        "code": "INIT_CONTRACT_EXISTS",
        "severity": "error",
        "summary": "agent-ready.yaml already exists at the repository root.",
        "detail": "/path/to/my-project/agent-ready.yaml already exists. init never overwrites an existing contract.",
        "remediation": "Remove or rename the existing agent-ready.yaml, then re-run agent-ready init --write."
      }
    ]
  }
  ```

- **Exit codes** — within the existing 5-value scheme per
  [ADR-0009](0009-pre-1.0-stability-policy.md):

  - `0` (`ExitCode.SUCCESS`) — dry run completed (always exits 0;
    validation diagnostics are informational in dry-run mode) or
    `--write` succeeded with a valid generated contract.
  - `1` (`ExitCode.VALIDATION_FAILED`) — `agent-ready.yaml` already
    exists at the repo root (`INIT_CONTRACT_EXISTS`) or the
    generated contract failed validation during `--write`
    (`resolveExitCode` on the validation diagnostics).
  - `10` (`ExitCode.INTERNAL_ERROR`) — `--write` succeeded in
    generating a valid contract but the `writeTextFile` call itself
    failed (`INIT_WRITE_FAILED`, mapping to the same bucket as
    `GENERATE_WRITE_FAILED`).

  The "contract already exists" case is a `VALIDATION_FAILED` (1),
  not `CONTRACT_NOT_FOUND` (2), because the user's action is to
  delete/rename the existing file — a repo-state fix, same class
  as `GENERATE_TARGET_UNMANAGED`.

- **One new diagnostic code** (additive per
  [ADR-0009](0009-pre-1.0-stability-policy.md)):

  | Code                   | Severity | Meaning                                                                 |
  | ---------------------- | -------- | ----------------------------------------------------------------------- |
  | `INIT_CONTRACT_EXISTS` | error    | `agent-ready.yaml` already exists at the repo root; `init` will not overwrite it. |

  `INIT_WRITE_FAILED` is not a new diagnostic code — it reuses the
  existing `INTERNAL_INVARIANT_VIOLATION` pattern (same as
  `GENERATE_WRITE_FAILED`'s exit-code bucket) with a distinct
  `summary`/`detail`/`remediation`.

- **No new abstraction boundaries.** No `BinaryClient`, no
  `GitClient`, no `CommandRunner`. `FileSystem` is used for:
  - Repo-root discovery (checking for `.git` entries, same
    `fs.stat` pattern as `discovery.ts`).
  - Reading `package.json`, `.nvmrc`, `.node-version`, lock files,
    `.gitignore`, and documentation files.
  - Writing the generated contract (reuses the existing
    `writeTextFile` method — no new `FileSystem` method).

- **Public API**: `runInit` and the detection functions in
  `initDetect.ts` are **not** exported from
  [`src/index.ts`](../../src/index.ts). Same discipline as every
  other per-command run function.

- **Tests**:

  - **Unit** — `tests/unit/initDetect.test.ts`. Exercises every
    detection function in isolation with `InMemoryFileSystem`:
    - Project name from `package.json`, fallback to directory name,
      sanitization of invalid names.
    - Node range from `engines.node`, `.nvmrc`, `.node-version`,
      precedence, and fallback when none present.
    - Package manager from `packageManager` field, each lock file,
      precedence, and fallback when none present.
    - Script detection: well-known subset included, others skipped.
    - Verification ordering preserves `package.json` script order.
    - Doc sources: existence checks for common files and `docs/*.md`.
    - `.gitignore` parsing: supported patterns included, extglobs
      skipped, `.env*` detection.
    - Minimal-repo case: no `package.json`, no lock files, no
      `.gitignore` — produces a contract with only `project.name`
      (from directory) and all five adapters enabled.
  - **Unit** — `tests/unit/init.test.ts`. Exercises
    `runInit(fs, args)` end-to-end with `InMemoryFileSystem`:
    - Dry run outputs expected YAML and detection summary.
    - Dry run with validation failure still outputs YAML (review
      mode).
    - `--write` succeeds when no contract exists.
    - `--write` fails with `INIT_CONTRACT_EXISTS` when contract
      exists.
    - `--write` with validation failure aborts and reports
      diagnostics.
    - `--json` shape matches spec for dry-run, write-success, and
      write-contract-exists cases.
  - **Integration** — `tests/integration/initCli.test.ts`.
    End-to-end via `runInit(...)` against a `mkdtemp` working tree
    containing a realistic `package.json` fixture. Verifies exit
    codes, human output structure, JSON envelope shape, and that
    the written file passes `agent-ready validate`. Mirrors
    `tests/integration/generateCli.test.ts` in pattern.
  - **Adversarial** — `tests/unit/initAdversarial.test.ts`.
    Exercises detection against pathological `package.json` values
    (names with Markdown-significant characters, scripts with shell
    metacharacters, missing/broken JSON). Verifies that `init`
    never throws, always produces a valid contract or a clean
    diagnostic, and that generated YAML strings are properly quoted
    per the YAML spec.

## Consequences

- `agent-ready init` is the fourth and final Path A command. Path A
  is complete: `schema` → `doctor` → `explain` → `init`, all four
  shipped behind their own ADRs per ADR-0021's sequencing.

- The adoption funnel closes its largest gap: a maintainer with no
  `agent-ready.yaml` can run one command, review the output, and
  have a valid starter contract without reading the spec or
  hand-copying an example.

- `init` is the second writer in the codebase (after `generate
  --write`) and the first to write a file the user is expected to
  hand-edit afterward. Its write-boundary design is deliberately
  stricter than `generate --write`'s: no `--force`, no managed-file
  marker, no overwrite under any circumstance. The contract is
  irreplaceable; generated adapter output is reproducible.

- The detection module (`initDetect.ts`) is a new pure-logic
  surface, independently unit-testable with `InMemoryFileSystem`.
  Every heuristic maps to an existing schema field — no new
  contract-schema addition, no new required field.

- One new diagnostic code (`INIT_CONTRACT_EXISTS`) is added to
  `src/diagnostics/codes.ts`. Additive-only per
  [ADR-0009](0009-pre-1.0-stability-policy.md).

- The CLI reference, implementation-scope status table, project
  standing, and ROADMAP.md are all updated in the same landing per
  the per-command convention established through
  [ADR-0022](0022-agent-ready-schema-command.md).

- `ROADMAP.md`'s strict non-goals list removes `agent-ready init`
  from the enumerated non-goals — it transitions from "not
  implemented" to "implemented" as the final Path A command.

- The `agent-ready` command description in `src/cli/index.ts` grows
  from "nine real commands" to "ten real commands," and the
  `program.description()` text (which currently says "This CLI
  never modifies the repository unless `generate --write` is used")
  is updated to also mention `init --write`.

## Reconsideration trigger

- If lock-file-detected package-manager versions (`"10"` for npm,
  `"1"` for yarn, `"10"` for pnpm) prove too conservative in
  practice (i.e. the generated contract fails `agent-ready doctor`
  on the first run for a majority of adopters), run `binary.probe`
  inside `init` to pin the actual installed version — but only if
  the binary is already on PATH. `init`'s current design avoids
  spawning any process; adding `BinaryClient` would cross that
  line.

- If adoption evidence shows that `init`'s conservative script
  detection (8 well-known names) misses a script the majority of
  projects use (`lint-staged`, `prepare`, `postinstall`), widen the
  well-known set behind a follow-up ADR. The current set is a
  starting point, not a permanent ceiling.

- If a future `agent-ready init --dry-run | agent-ready validate`
  pipe becomes a common workflow (i.e. users want to validate the
  dry-run output without `--write`), add a `--validate` flag that
  runs the pipeline on stdout output explicitly. Today, the dry-run
  path runs validation internally and reports the result; a
  `--validate` flag would make that an explicit, user-visible step
  without requiring `--write`.

- If `init`'s detection-summary comment header grows unwieldy (e.g.
  40+ lines for a large monorepo), consider a `--quiet` flag that
  omits the summary and prints only the contract YAML. The current
  design prioritizes transparency over concision; a `--quiet` flag
  can be added without changing the default.

- If a `--from-contract <path>` mode is requested (scaffold a new
  contract by copying and adapting an existing one from another
  repository), that is a distinct command surface (`init --template`
  or a separate `agent-ready clone` command), not an evolution of
  `init`'s current repository-inspection model. The current `init`
  inspects only the *current* repository; template-based scaffolding
  is a different user story.
