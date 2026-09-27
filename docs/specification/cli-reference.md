# CLI reference

The `agent-ready` CLI never modifies the repository it inspects — except
`agent-ready generate --write`, which writes only the adapter-hardcoded
files it plans to generate (see [`agent-ready generate`](#agent-ready-generate)
below); `agent-ready init --write`, which writes a starter
`agent-ready.yaml` and refuses if one already exists (see
[`agent-ready init`](#agent-ready-init) below and
[ADR-0025](../decisions/0025-agent-ready-init-command.md)); and
`agent-ready upgrade --write`, which applies a validated set of safe,
additive changes to an existing contract after showing a dry-run diff (see
[`agent-ready upgrade`](#agent-ready-upgrade) and
[ADR-0028](../decisions/0028-agent-ready-upgrade-command.md)); and
`agent-ready verify --execute --record`, which writes a single
JSON evidence file to the repository root (see
[`agent-ready verify`](#agent-ready-verify) below and
[ADR-0015](../decisions/0015-verification-evidence-recording.md)) — and
never executes a command declared in a contract, except `agent-ready
verify --execute`, which runs exactly the commands declared in
`verification.required` (see [`agent-ready verify`](#agent-ready-verify)
below and [ADR-0014](../decisions/0014-verification-execution.md)).

This reference covers the twelve commands that exist today. Path A is
complete: `agent-ready schema` ([ADR-0022](../decisions/0022-agent-ready-schema-command.md)),
`agent-ready doctor` ([ADR-0023](../decisions/0023-agent-ready-doctor-command.md)),
`agent-ready explain` ([ADR-0024](../decisions/0024-agent-ready-explain-command.md)),
and `agent-ready init` ([ADR-0025](../decisions/0025-agent-ready-init-command.md)).
`agent-ready discover`
([ADR-0044](../decisions/0044-repository-discovery-model.md)) is the twelfth
and is additive surface on the parallel vNext track: per
[ADR-0042](../decisions/0042-v1-freeze-and-parallel-vnext-surface.md) it leaves
the v1 contract and the other eleven commands untouched.

## `agent-ready --help` / `agent-ready --version`

Standard help and version output. The version is read from this
package's own `package.json` (single authoritative source — never
hardcoded elsewhere).

## `agent-ready validate`

Discovers, reads, parses, schema-validates, semantically validates, and
normalizes the contract, then reports success or failure.

```bash
agent-ready validate
agent-ready validate --json
agent-ready validate --config path/to/agent-ready.yaml
```

| Option            | Description                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `--json`          | Print a machine-readable JSON result instead of human-readable text.                                |
| `--config <path>` | Use this exact file instead of discovering one; see [discovery.md](discovery.md#explicit---config). |

**Human output** (success):

```text
Contract is valid: /path/to/agent-ready.yaml
  project: example-project
  commands declared: 3
  verification steps: 2
```

**JSON output** (`--json`), always an object with `ok: boolean` and a
`diagnostics` array (see [diagnostics.md](diagnostics.md) for the shape
of each entry):

```json
{
  "ok": true,
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path/to",
  "diagnostics": []
}
```

On failure, `ok` is `false` and `diagnostics` is non-empty; human output
goes to stderr instead of stdout.

## `agent-ready inspect`

Runs the same pipeline as `validate`, then prints the fully normalized
contract instead of a validation summary.

```bash
agent-ready inspect
agent-ready inspect --json
```

`--json` output is an object `{ ok: true, repoRoot, contractPath, contract }`
where `contract` is the complete `NormalizedContract` (see
[contract-reference.md](contract-reference.md) for field semantics, and
[../architecture/overview.md](../architecture/overview.md) for the exact
TypeScript shape). This output is deterministic: running `inspect --json`
twice against the same contract on the same machine produces
byte-identical output.

Non-JSON output is a deliberately designed, human-readable summary (not a
raw object dump) grouped by section: Project, Environment, Commands,
Verification, Paths, Architecture, Agent Constraints, Instruction sources, Adapters.

## `agent-ready generate`

Runs the same pipeline as `validate`, then compiles the normalized
contract's enabled adapters into their output files: `agentsMd` ->
`AGENTS.md`, `claude` -> `CLAUDE.md`, `cursor` -> `.cursorrules`, `copilot`
-> `.github/copilot-instructions.md`, `gemini` -> `GEMINI.md` (see
[ADR-0012](../decisions/0012-cursor-copilot-gemini-output-format.md) for why
`copilot`'s output isn't at the repository root). Defaults to a dry run —
nothing is written to disk unless `--write` is passed.

```bash
agent-ready generate                       # dry run
agent-ready generate --write               # write planned files
agent-ready generate --write --force       # also overwrite unmanaged files
agent-ready generate --check               # CI mode: exit non-zero on drift
agent-ready generate --json
```

| Option            | Description                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--write`         | Write planned files to disk. Refuses to overwrite an existing file that lacks the managed-file marker (`GENERATE_TARGET_UNMANAGED`) unless `--force` is also passed. |
| `--check`         | Never writes. Exits non-zero (exit code 1) if any planned file would differ from what's currently on disk — for CI. Mutually exclusive with `--write`.               |
| `--force`         | With `--write`, overwrite an existing file even if it lacks the managed-file marker.                                                                                 |
| `--json`          | Print a machine-readable JSON result instead of human-readable text.                                                                                                 |
| `--config <path>` | Use this exact file instead of discovering one; see [discovery.md](discovery.md#explicit---config).                                                                  |

Every file Agent-Ready generates begins with a machine-checkable marker
comment identifying it as generated. This is how `--write` tells
Agent-Ready-generated content apart from a file you wrote by hand, so a
re-run never silently clobbers hand-authored content. See
[ADR-0010](../decisions/0010-generate-write-boundary.md).

All five adapter names (`agentsMd`, `claude`, `cursor`, `copilot`, `gemini`)
have a renderer as of this release. Enabling an adapter name Agent-Ready
doesn't yet recognize a renderer for (reserved for a future adapter added to
the schema ahead of its renderer) produces an `ADAPTER_NOT_YET_IMPLEMENTED`
warning and is skipped rather than failing generation.

**Per-file status values:**

| Status        | Meaning                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `would-write` | The file does not exist yet, or exists with stale but managed content.                                                                |
| `up-to-date`  | The file already exists with exactly the content Agent-Ready would generate.                                                          |
| `unmanaged`   | The file exists but was not generated by Agent-Ready (no marker); refused without `--force`.                                          |
| `written`     | (`--write` only) The file was just written.                                                                                           |
| `refused`     | (`--write` only) The file was not written — either unmanaged without `--force`, or the write itself failed (`GENERATE_WRITE_FAILED`). |

**JSON output** (`--json`) is an object:

```json
{
  "ok": true,
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path/to",
  "mode": "dry-run",
  "files": [
    {
      "adapter": "agentsMd",
      "path": "/path/to/AGENTS.md",
      "relativePath": "AGENTS.md",
      "status": "would-write"
    }
  ],
  "diagnostics": []
}
```

`mode` is one of `"dry-run"`, `"write"`, or `"check"`. Passing `--check`
and `--write` together is rejected before the pipeline runs (exit code
1, plain usage message, not a `Diagnostic`).

## `agent-ready check`

Runs the same pipeline as `validate`, then checks whether any file
matching the contract's `paths.protected` patterns was changed in Git,
relative to the working tree (default), the Git index (`--staged`), or an
explicit ref (`--against <ref>`). **Requires a Git working tree and the
`git` executable on `PATH`** — unlike `validate`/`inspect`/`generate`,
which need only Node.js. Git is only ever invoked with
Agent-Ready-hardcoded arguments (plus a validated `--against` ref, passed
after Git's own `--end-of-options` marker so it can never be interpreted
as an option); no contract-declared content ever reaches a `git`
argument. See [ADR-0013](../decisions/0013-protected-path-enforcement-and-git-invocation.md).

```bash
agent-ready check                          # working tree vs HEAD (staged + unstaged + untracked)
agent-ready check --staged                 # staged changes only
agent-ready check --against origin/main    # changes relative to an explicit ref
agent-ready check --json
```

| Option            | Description                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--staged`        | Check staged changes (`git diff --cached`) instead of the full working tree.                                                                                    |
| `--against <ref>` | Check changes relative to an explicit Git ref instead of `HEAD`. Mutually exclusive in effect with `--staged` (`--staged` takes precedence if both are passed). |
| `--json`          | Print a machine-readable JSON result instead of human-readable text.                                                                                            |
| `--config <path>` | Use this exact file instead of discovering one; see [discovery.md](discovery.md#explicit---config).                                                             |

By default, brand-new (never-committed) files are included: an untracked
file matching `paths.protected` is flagged just like a modified tracked
one. In a repository with no commits yet, every currently staged/working
file is treated as changed rather than producing an error.

**Human output** (violation found):

```text
error[PROTECTED_PATH_MODIFIED]: Protected path was modified: .env.production
  ".env.production" matches protected pattern ".env*" declared in paths.protected.
  suggestion: Revert this change, or update paths.protected in agent-ready.yaml if this file should no longer be protected.
```

**JSON output** (`--json`):

```json
{
  "ok": false,
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path/to",
  "base": { "kind": "working-tree" },
  "changedFiles": [{ "path": ".env.production", "status": "modified" }],
  "violations": [{ "path": ".env.production", "pattern": ".env*" }],
  "diagnostics": [{ "code": "PROTECTED_PATH_MODIFIED", "severity": "error", "...": "..." }]
}
```

`changedFiles`/`violations`/`base` are omitted when the pipeline failed
before Git was ever consulted (e.g. an invalid contract).

## `agent-ready analyze`

Runs the same contract pipeline as `validate`, then reads each file declared in
`instructions.sources` and checks its repository-relative Markdown link
destinations. It is read-only: it never invokes Git, executes contract commands,
follows remote links, or rewrites documentation. See
[ADR-0020](../decisions/0020-instruction-source-link-analysis.md). Each
declared source is inspected before reading and must not exceed 5,000,000
bytes; larger files fail with `INSTRUCTION_SOURCE_TOO_LARGE`. It also checks
that every `architecture.key_decisions[].file` and `agents.context_files[]`
reference exists as a regular file. Those references are not parsed for links;
they are bounded context references only. JSON output adds `declaredFiles`,
each with `kind`, `path`, and `exists`.

```bash
agent-ready analyze
agent-ready analyze --json
agent-ready analyze --config path/to/agent-ready.yaml
```

| Option            | Description                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `--json`          | Print structured source counts, findings, and diagnostics.                                             |
| `--config <path>` | Use this exact contract file instead of discovery; see [discovery.md](discovery.md#explicit---config). |

The bounded scanner recognizes inline links, image destinations, and reference
definitions. Fenced code, inline code, URI-scheme links, protocol-relative
links, root-relative URLs, and fragment/query-only destinations are ignored.
For local links, fragments and queries are removed before resolving the target
relative to the instruction source. Files and directories are both valid
targets. Traversal above the repository root is rejected.

**Human output** (success):

```text
No documentation drift found.
  instruction sources checked: 2
  local links checked: 14
```

**JSON output** (broken link):

```json
{
  "ok": false,
  "contractPath": "/repo/agent-ready.yaml",
  "repoRoot": "/repo",
  "sources": [{ "path": "README.md", "linksChecked": 1 }],
  "linksChecked": 1,
  "findings": [
    {
      "kind": "broken",
      "sourcePath": "README.md",
      "destination": "docs/missing.md",
      "resolvedPath": "docs/missing.md",
      "line": 8,
      "column": 12
    }
  ],
  "diagnostics": [{ "code": "DOCUMENTATION_LINK_BROKEN", "severity": "error", "...": "..." }]
}
```

When no instruction sources are declared, analysis succeeds with zero source
and link counts.

## `agent-ready schema`

Prints the bundled Agent-Ready contract JSON Schema — the file the CLI
itself validates `agent-ready.yaml` against — without requiring a
contract, repository, or Git working tree. Read-only: never modifies
the repository, never invokes Git, never runs commands, and never
makes network calls. See
[ADR-0022](../decisions/0022-agent-ready-schema-command.md).

```bash
agent-ready schema              # metadata-only human-readable summary
agent-ready schema --json       # structured JSON without schema body
agent-ready schema --content    # also include the full schema body (human)
agent-ready schema --json --content   # structured JSON, body included as `schema` field
```

| Option      | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| `--json`    | Print results as machine-readable JSON.                          |
| `--content` | Include the parsed schema body in the output, not just metadata. |

This command has no `--config` flag and does not consult the user's
`agent-ready.yaml`/repository/Git. It is the only Agent-Ready command
that does not require any pre-existing repository state at all.

**Human output** (success, no `--content`):

```text
Agent-Ready contract JSON Schema (bundled with this CLI).
  contract version: 1
  path: /abs/path/to/schemas/v1/agent-ready.schema.json
  bytes: 5402
  JSON Schema $schema: https://json-schema.org/draft/2020-12/schema
  JSON Schema $id: https://schemas.agent-ready.dev/v1/agent-ready.schema.json
  title: Agent-Ready Repository Contract (v1, Phase 1 minimal core)
```

**JSON output** (`--json`, no `--content`):

```json
{
  "ok": true,
  "schemaPath": "/abs/path/to/schemas/v1/agent-ready.schema.json",
  "contractVersion": 1,
  "draft": "https://json-schema.org/draft/2020-12/schema",
  "id": "https://schemas.agent-ready.dev/v1/agent-ready.schema.json",
  "title": "Agent-Ready Repository Contract (v1, Phase 1 minimal core)",
  "byteCount": 5402,
  "diagnostics": []
}
```

With `--content`, the human output appends a pretty-printed schema body
after the metadata, and the `--json` output adds a `schema` field whose
value is the parsed JSON Schema object.

On an integrity failure (bundle missing, malformed, or not a JSON
object), `ok` is `false`, the run's exit code reflects
`ExitCode.INTERNAL_ERROR` (10), and `diagnostics` contains exactly one
`INTERNAL_INVARIANT_VIOLATION`. The bundled schema is shipped next to
the installed CLI and should always parse cleanly; this is treated as
an Agent-Ready-installation bug rather than a user-correctable error.

## `agent-ready init`

Scaffolds a starter `agent-ready.yaml` from repository inspection —
detecting the project name, runtime constraints, package manager,
well-known scripts, documentation files, `.gitignore` patterns, and
more — and prints it to stdout (dry run) or writes it to disk
(`--write`). **Never overwrites an existing contract file.** Always
validates the generated YAML through the full contract pipeline before
writing. Read-only unless `--write` is passed; never executes
contract-declared commands, never invokes Git. See
[ADR-0025](../decisions/0025-agent-ready-init-command.md).

```bash
agent-ready init              # dry run: inspect the repo and print proposed YAML
agent-ready init --write      # write agent-ready.yaml to the repo root
agent-ready init --json       # machine-readable detection summary
agent-ready init --json --write   # structured output for write mode
```

| Option    | Description                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `--write` | Write `agent-ready.yaml` to the detected repo root. Refuses if the file already exists, unconditionally. |
| `--json`  | Print results as machine-readable JSON instead of human-readable text.                                   |

This command has no `--config` flag — it always writes to the canonical
`agent-ready.yaml` at the detected repo root. The dry-run path lets you
pipe to an arbitrary location: `agent-ready init > /tmp/agent-ready.yaml`.

**Detection heuristics** (each degrades gracefully when its source is
missing):

- **Project name**: from `package.json` `"name"` (stripped of scope
  prefix), falling back to the directory name. Sanitized if it violates
  the schema pattern.
- **Project description**: from `package.json` `"description"`, if
  within 1–500 characters.
- **Node runtime**: from `package.json` `engines.node` (non-`"*"`),
  falling back to `.nvmrc` or `.node-version` (`.nvmrc` preferred).
  Single-part versions become next-major ranges (e.g. `"20"` →
  `">=20 <21"`).
- **Package manager**: from `package.json` `"packageManager"`
  (e.g. `"pnpm@10.0.0"`), falling back to the lock file present
  (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
  `package-lock.json` → npm).
- **Scripts**: well-known keys from `package.json` `"scripts"` only:
  `lint`, `test`, `build`, `typecheck`, `format`, `check`, `test-e2e`,
  `ci`. Skipped keys are listed in the detection summary.
- **Verification**: `lint`, `typecheck`, `test`, `build` in
  `package.json` script order.
- **Documentation sources**: `README.md`, `CONTRIBUTING.md`, and
  common `.md` files under `docs/`.
- **Paths**: supported `.gitignore` patterns (extglobs and negations
  excluded). If `.env` or `.env*` appears, `paths.protected: [".env*"]`
  is suggested.
- **Adapters**: all five enabled by default.

The generated YAML begins with a YAML comment header explaining every
detection decision.

**Human output** (dry run):

```text
agent-ready init - repoRoot: /path/to/my-project

Detected:
  project name: my-project (from package.json)
  package manager: pnpm (from package.json)
  scripts: lint, test (2 included; 1 skipped: dev)
  adapters: all 5 enabled (...)

--- proposed agent-ready.yaml ----------------------------------------
# Generated by agent-ready init on ...
# Review each section before your first agent-ready validate.
...

---
Validation: would pass agent-ready validate.
Run `agent-ready init --write` to create this file at
  /path/to/my-project/agent-ready.yaml
```

**Exit codes**: `0` on dry run (always) or successful `--write`; `1`
if a contract already exists (`INIT_CONTRACT_EXISTS`) or the generated
contract failed validation during `--write`; `10` on write failure.

**JSON output** (`--json`, dry run):

```json
{
  "ok": true,
  "repoRoot": "/path/to/my-project",
  "mode": "dry-run",
  "detection": {
    "projectName": "my-project",
    "projectNameSource": "package.json",
    "packageManager": { "name": "pnpm", "version": "10.0.0" },
    "packageManagerSource": "package.json",
    "scriptsIncluded": ["lint", "test"],
    "scriptsSkipped": ["dev"],
    "verificationScripts": ["lint", "test"],
    "docSources": [],
    "ignoredPatterns": [],
    "hasEnvInGitignore": false
  },
  "contract": "<generated YAML string>",
  "validationPassed": true,
  "diagnostics": []
}
```

With `--write`, `mode` is `"write"` and the output adds `contractPath`.
When the contract already exists, `ok` is `false`, `mode` reflects the
invocation (dry-run or write), and `diagnostics` contains
`INIT_CONTRACT_EXISTS`.

## `agent-ready upgrade`

Inspects an already-valid contract and proposes conservative, additive
modernizations. It is a dry run by default and never removes a declaration or
replaces a maintainer-authored scalar. See
[ADR-0028](../decisions/0028-agent-ready-upgrade-command.md).

```bash
agent-ready upgrade
agent-ready upgrade --json
agent-ready upgrade --write
agent-ready upgrade --config path/to/agent-ready.yaml
```

| Option            | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `--write`         | Validate and apply the proposed transformations to the existing contract. |
| `--json`          | Print structured changes, the field-level diff, status, and diagnostics.  |
| `--config <path>` | Upgrade this exact contract instead of using normal ancestor discovery.   |

Automatic rules are evidence-backed:

- `.env*` is added to `paths.protected` only when `.gitignore` already excludes
  environment files.
- `node_modules/**`, `dist/**`, and `coverage/**` are classified only when the
  declared package manager or commands support the recommendation.
- `README.md` is added to `instructions.sources` only when the file exists.
- A recommendation is skipped if the same normalized path already belongs to
  any path category.

Old Node ranges are never rewritten automatically. They produce
`UPGRADE_MANUAL_REVIEW_REQUIRED` with the current and suggested values. Before
`--write`, the complete proposed YAML is parsed, schema-validated, and
semantically validated. A failed proposal is never written.

**Human output** (dry run):

```text
Upgrade (dry-run) - contract: /repo/agent-ready.yaml

  /paths/ignored: Ignore installed Node.js dependencies.

--- /repo/agent-ready.yaml
+++ /repo/agent-ready.yaml (proposed)
@@ /paths/ignored @@
- <absent or empty>
+ ["node_modules/**"]

Dry run only. Re-run with --write to apply these changes.
```

**JSON output** contains `ok`, `contractPath`, `repoRoot`, `mode`, `written`,
`changes`, `diff`, and `diagnostics`. Each change has a stable `id`, JSON
Pointer `field`, summary, and exact `before`/`after` values.

**Exit codes**: `0` for a successful dry run/write, including
`UPGRADE_NO_CHANGES_NEEDED` and manual-review warnings; the ordinary contract
pipeline codes for invalid input; `10` for `UPGRADE_WRITE_FAILED` or an invalid
internal proposal.

## `agent-ready doctor`

Inspects the host environment for fitness to run Agent-Ready against the
contract without spawning anything contract-declared. Reports, per
check, whether the host satisfies what the contract declares: declared
Node range, declared package manager, declared non-`node` runtimes, Git
on `PATH`, and Git working-tree membership. **Read-only**: never
executes contract-declared commands, never invokes Git for
state-changing operations, never modifies the repository. Loads and
validates through the same contract pipeline as
[`agent-ready validate`](#agent-ready-validate), so a contract that
fails validation short-circuits the run with the same diagnostics. See
[ADR-0023](../decisions/0023-agent-ready-doctor-command.md).

```bash
agent-ready doctor
agent-ready doctor --json
agent-ready doctor --config path/to/agent-ready.yaml
```

| Option            | Description                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `--json`          | Print a machine-readable JSON envelope (per-check rows + diagnostics) instead of human-readable.       |
| `--config <path>` | Use this exact contract file instead of discovery; see [discovery.md](discovery.md#explicit---config). |

**Per-check axes (in document order):**

| Check axis             | Always emitted?  | Notes                                                                                                           |
| ---------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `runtime-node`         | yes              | Detected via `process.version` vs declared `environment.runtimes.node`. Warn when not declared.                 |
| `runtime-other-<name>` | yes, one per key | One row per non-`node` declaration under `environment.runtimes`. Warn-only: doctor does not probe non-Node yet. |
| `package-manager`      | only if declared | Detected via `BinaryClient.probe(<name>, root)` vs declared `environment.packageManager`.                       |
| `git-on-path`          | yes              | Detected via `BinaryClient.probe('git', root)`. Required iff `paths.protected` is non-empty (else warn-only).   |
| `git-repository`       | yes              | Detected via `GitClient.isRepository(root)`. Warn-only on mismatch when `paths.protected` is non-empty.         |

**Human output** (success):

```text
Agent-Ready doctor - repoRoot: /path

  [pass] runtime-node: detected v20.10.0 satisfies declared ">=20 <23"
  [pass] package-manager: detected pnpm 10.0.0 satisfies declared "10"
  [pass] git-on-path: detected git version 2.43.0 on /usr/bin/git
  [pass] git-repository: cwd is inside a Git working tree

All 4 checks pass.
```

**JSON output** (`--json`), always an envelope `{ ok, contractPath,
repoRoot, checks, diagnostics }`:

```json
{
  "ok": false,
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path",
  "checks": [
    {
      "check": "runtime-node",
      "status": "pass",
      "declared": ">=20 <23",
      "detected": "v20.10.0"
    },
    {
      "check": "runtime-other-python",
      "status": "warn",
      "declared": ">=3.10",
      "detected": null,
      "summary": "doctor does not probe python in this ADR."
    },
    {
      "check": "package-manager",
      "status": "fail",
      "declared": { "name": "pnpm", "version": "10" },
      "detected": null,
      "summary": "Declared package manager pnpm is not on PATH."
    },
    {
      "check": "git-on-path",
      "status": "pass",
      "required": true,
      "detected": { "version": "git version 2.43.0", "path": "/usr/bin/git" }
    },
    {
      "check": "git-repository",
      "status": "pass",
      "required": false,
      "detected": true
    }
  ],
  "diagnostics": [
    {
      "code": "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
      "severity": "warning",
      "summary": "Declared runtime python is not probed by doctor in this ADR.",
      "field": "/environment/runtimes/python",
      "remediation": "Track ADR-0023 follow-ups; future ADRs may graduate python to a first-class BinaryClient.probe target."
    },
    {
      "code": "PACKAGE_MANAGER_UNAVAILABLE",
      "severity": "error",
      "summary": "Declared package manager pnpm is not on PATH.",
      "field": "/environment/packageManager",
      "remediation": "Install pnpm or update environment.packageManager to match an installed manager."
    }
  ]
}
```

Per-row fields appear conditionally per ADR-0023 "JSON output": every
row carries `check` and `status`; `declared`, `detected`, `required`,
and `summary` appear only where ADR-0023 calls for them. `summary` is
present whenever a row's `status` is `"warn"` or `"fail"`.

Five additive diagnostic codes per
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md):
[`RUNTIME_VERSION_MISMATCH`, `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`,
`PACKAGE_MANAGER_UNAVAILABLE`, `PACKAGE_MANAGER_VERSION_MISMATCH`,
`GIT_REQUIRED_BUT_UNAVAILABLE`](diagnostics.md).

## `agent-ready explain`

Prints an extended, plain-language explanation of a diagnostic code —
what it means, why Agent-Ready checks for it, how to fix it, and which
contract fields it relates to. Takes the existing one-line
`remediation` text every diagnostic already carries and expands it into
a structured tutorial. Optionally loads a contract via `--config` for
field-specific "Your contract" context. Read-only: never modifies the
repository, never executes commands, never invokes Git. See
[ADR-0024](../decisions/0024-agent-ready-explain-command.md).

```bash
agent-ready explain --code PACKAGE_MANAGER_UNAVAILABLE
agent-ready explain --code PROTECTED_PATH_MODIFIED --json
agent-ready explain --code CONTRACT_VERSION_UNSUPPORTED --config path/to/agent-ready.yaml
```

| Option            | Description                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--code <CODE>`   | (required) The diagnostic code to explain (e.g. `PACKAGE_MANAGER_UNAVAILABLE`).                                       |
| `--json`          | Print results as machine-readable JSON.                                                                               |
| `--config <path>` | Load this contract for field-specific "Your contract" context. If omitted, prints a generic explanation for the code. |

**Human output** (no `--config`):

```text
agent-ready explain CONTRACT_NOT_FOUND

What it means:
  Agent-Ready could not find an agent-ready.yaml file in the current
  directory or any ancestor directory.

Why it happens:
  Agent-Ready needs a contract file to know which commands, paths,
  and environment constraints to validate against.

How to fix it:
  1. Create an agent-ready.yaml file at the root of your repository.
  2. Or, pass it explicitly:
       agent-ready validate --config path/to/agent-ready.yaml

Related codes:
  CONTRACT_READ_FAILED
```

**Human output** (with `--config`): appends a "Your contract" section
showing the relevant field values from the loaded contract:

```text
agent-ready explain PACKAGE_MANAGER_UNAVAILABLE

What it means:
  ...

Why it happens:
  ...

How to fix it:
  ...

Related codes:
  PACKAGE_MANAGER_VERSION_MISMATCH, PACKAGE_MANAGER_INVALID

Your contract (/path/to/agent-ready.yaml):
  /environment/packageManager = {"name":"pnpm","version":"10"}
```

When the code has no contract-field relationship (e.g. `YAML_PARSE_FAILED`),
the "Your contract" section is omitted even when `--config` is given.
When a declared field is absent from the loaded contract, it is listed
with `(not declared)`.

**JSON output** (`--json`, no `--config`):

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

With `--config` and a valid contract load, the JSON envelope adds
`contractPath`, `repoRoot`, and a `contractFields` array:

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
      "value": [".env*"]
    }
  ],
  "diagnostics": []
}
```

When `--config` is given but the contract fails to load, `ok` is
`false` and `diagnostics` contains the load errors — but the explanation
for the code itself is still included, because an invalid contract
doesn't make the diagnostic-code definition any less valid.

Recognized codes are validated against the same `isDiagnosticCode()`
function the rest of the CLI uses. An unrecognized `--code` value is a
usage error (exit 1, plain stderr message, not a `Diagnostic`).

Exit codes: `0` on success, `1` on unrecognized code or contract
validation failure, `2` when `--config` is given but the contract is
not found.

## `agent-ready discover`

Builds a deterministic, evidence-bearing model of a repository. Works **with or
without** an `agent-ready.yaml`: a missing contract is reported as a fact, not
as a failure. This is the one command that can describe a repository nobody has
written a contract for. See
[ADR-0044](../decisions/0044-repository-discovery-model.md) for the design
rationale and
[diagnostics.md](diagnostics.md#repository-discovery-diagnostics) for the full
diagnostic contract.

**Strictly read-only.** Unlike `generate --write`, `init --write`, and
`verify --record`, this command exposes no mutation path at all: the only
capability a probe receives is repository-relative reading, stat-ing, and
directory listing. There is no writer, no process runner, no Git client, and no
network client in the path, so it cannot modify the repository, execute anything,
or reach the network. A declared script is a fact about a string; it is never an
instruction to run it. There is deliberately no `--write` and no `--force`;
adding one would need its own decision.

```bash
agent-ready discover
agent-ready discover --json
agent-ready discover --root path/to/repo
agent-ready discover --root path/to/repo --json
```

| Option          | Description                                                                           |
| --------------- | ------------------------------------------------------------------------------------- |
| `--json`        | Print the discovery snapshot as machine-readable JSON. This is the primary interface. |
| `--root <path>` | Repository directory to inspect. Defaults to the working directory.                   |

### Probe, evidence, fact

Three things are deliberately kept apart:

- A **probe** is a bounded, read-only inspection with a four-way outcome:
  `found`, `not-found` (the inspection completed and the thing is absent),
  `failed` (the inspection could not be completed), and `unsupported` (out of
  scope for this repository). Collapsing any pair of those would be a
  correctness bug, not a simplification.
- **Evidence** is where a claim came from: a repository-relative `source`, an
  optional `pointer` into that document, and a `detail`. A fact that makes a
  positive claim must always cite it.
- A **fact** is a record, never a bare value. Every fact carries an epistemic
  `kind` — `declared` (a file asserts it), `derived` (a fixed rule in the code
  computed it), `author-declared` (a human claimed it in `agent-ready.yaml`),
  or `unknown` — plus the claims and evidence behind it.

The boundary these enforce: **output claim strength ≤ support provided by the
evidence contract.** Concretely, `discover` will not

- turn a probe's success into more certainty than the probe supports;
- turn a probe's failure into proof of absence (a failed probe yields `unknown`
  with reason `probe-failed`, never `false`);
- report two claims citing the same file as independent corroboration;
- promote an `author-declared` claim over what the repository itself shows;
- fall back to a default value where evidence is missing;
- choose a winner between sources that disagree.

### Facts reported today

The vocabulary is deliberately **small and conceptual**. Every id is a property a
repository has, never a property of one entity inside it: a repository with forty
packages has one `repository.packages` fact holding forty entries, not forty
facts, and a repository with three hundred scripts has one `repository.commands`
fact holding three hundred of them. That is what keeps `FACT_IDS` a list a
contributor can read in full and check against the specification, rather than a
key space generated from repository content. Module-graph facts are
[#39](https://github.com/AdamEddahmouni/agent-ready/issues/39) onward, and they
will arrive as declared ids rather than appearing unannounced.

| Fact id                                 | Kind              | Meaning                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository.root`                       | `derived`         | The repository root, always the relative anchor `"."`.                                                                                                                                                                                                                                                                                                            |
| `repository.contract.present`           | `derived`         | Whether an `agent-ready.yaml` exists at the root as a regular file.                                                                                                                                                                                                                                                                                               |
| `repository.contract.valid`             | `derived`         | Whether that contract validates. `not-probed` when there is no contract.                                                                                                                                                                                                                                                                                          |
| `repository.declarationSurface.present` | `derived`         | Whether any of a fixed, versioned set of agent-instruction or CI paths exists.                                                                                                                                                                                                                                                                                    |
| `repository.packages`                   | `derived`         | Every directory that holds a manifest, with what each declares.                                                                                                                                                                                                                                                                                                   |
| `repository.workspace.declarations`     | `declared`        | Workspace patterns, verbatim and in declaration order.                                                                                                                                                                                                                                                                                                            |
| `repository.workspace.candidates`       | `derived`         | Repository paths the declared patterns resolve to, and whether they exist.                                                                                                                                                                                                                                                                                        |
| `repository.workspace.members`          | `derived`         | Candidates holding a readable manifest.                                                                                                                                                                                                                                                                                                                           |
| `repository.workspace.root`             | `derived`         | The manifest carrying the workspace declaration, or null.                                                                                                                                                                                                                                                                                                         |
| `repository.packageManager.<scope>`     | mixed             | One package manager per manifest. A declared value beside contradicting artifacts is reported as **incomplete**; disagreeing artifacts with nothing declared are a **conflict** with no value. Never defaults to `npm`. See [ADR-0045](https://github.com/AdamEddahmouni/agent-ready/blob/main/docs/decisions/0045-package-and-workspace-discovery-semantics.md). |
| `repository.commands`                   | `declared`        | Every declared package script, scoped to the package that declares it, with its exact body and a `source`/`pointer` citation.                                                                                                                                                                                                                                     |
| `repository.verificationEntrypoints`    | `derived`         | The subset whose **name** matches the role grammar, with a structured invocation where an agreed package manager allows one.                                                                                                                                                                                                                                      |
| `repository.contract.verification`      | `author-declared` | The contract's `verification.required`, in declared order. Kept apart from repository findings.                                                                                                                                                                                                                                                                   |

`declarationSurface` is present as a deliberately minimal heterogeneous
existence probe: it shows the substrate working against something other than the
Agent-Ready contract, and it reads presence only — never what any of those files
say. Which paths count is code, not configuration, so the derivation of a
`derived` fact cannot be tuned per repository.

`corroboration` records how much independent support a fact has. `corroborated` is
true only when at least two **claims** support the value; a single source does
not confirm itself, and the weaker question — is this more than the author's
word? — is answered by `corroboration.kinds`. Two narrower rules keep the
property meaningful: one claim is one source, so a claim citing four lockfiles
still makes one assertion, and no probe may split one document into several
claims, so independence can never be manufactured by re-reading a field. Package
managers are the one place with genuinely multi-source evidence — a declaration
and a lockfile are two documents, and they do corroborate each other.

### Commands and verification

`discover` answers **"how do I verify this package?"** from repository-declared
interfaces, without executing anything and without a maintainer having to explain
the repository. It does so from **names**, never from what a script's body looks
like.

A **command** is one key/value pair in a package manifest's `scripts` object,
scoped to the package that declares it. Nothing else is a command — not a CI step,
not a dependency, not a `vitest.config.ts`, not a Makefile target.

#### The role grammar

A role is assigned from a script's **name** and nothing else:

```text
name  := ROOT | ROOT ":" SUFFIX
ROOT  := "test" | "build" | "lint" | "typecheck"
```

Anchored, exact, no substring matching, no case folding, no synonym table. So:

| Name                                       | Role            |
| ------------------------------------------ | --------------- |
| `test`, `build`, `lint`, `typecheck`       | itself          |
| `test:unit`, `build:prod`, `lint:fix`      | the root family |
| `pretest`, `posttest`                      | _(none)_        |
| `contest`, `testdata`, `rebuild`, `eslint` | _(none)_        |
| `types`, `check:types`, `type-check`       | _(none)_        |

`pretest` and `posttest` are real declared scripts and appear in the command
inventory; they are package-manager **lifecycle hooks** rather than entrypoints,
and modelling when a package manager fires them would mean emulating a package
manager. Aliases such as `check:types` are deliberately unsupported: an alias
table is a synonym dictionary that grows by accretion, and a name that does not
fit is reported as what it is — a declared command with no recognised role.

**Script bodies are never parsed.** A script named `deploy` whose body is
`vitest run` is a command with **no role**, not a test entrypoint. Classifying
from the body cannot be made trustworthy — commands wrap other scripts, tools
span several roles, and `"deploy": "npm test && ship"` contains the token
`npm test` while being nothing of the kind — so the body is stored exactly as
declared and read for nothing. It is never passed to a shell, `eval`, or a
process, and the bodies Agent-Ready reports verbatim are the strongest evidence
that it did not: a script that would delete a file on execution is stored as
that string, unmodified and unrun.

Bodies are stored **exactly**: no trimming, no shell-operator splitting, no
executable canonicalization. An empty-string body is a declared command, not an
absent one.

#### Declared versus unclassifiable

```json
{
  "packagePath": ".",
  "scriptsStatus": "declared",
  "commands": [
    {
      "name": "test",
      "body": "vitest run",
      "source": "package.json",
      "pointer": "/scripts/test"
    }
  ],
  "unmodelledScripts": [],
  "unsupportedReason": null
}
```

`scriptsStatus` distinguishes four states, and the difference is the answer to
"does this package have no tests?":

| `scriptsStatus` | Means                                                       | Commands                    |
| --------------- | ----------------------------------------------------------- | --------------------------- |
| `declared`      | the manifest parsed and `scripts` is an object              | every string-valued entry   |
| `absent`        | the manifest parsed and has no `scripts` key                | none — **known empty**      |
| `unsupported`   | `scripts` is present in a shape this version does not model | none, and not claimed empty |
| `unobservable`  | the manifest is malformed or unreadable                     | none, and not claimed empty |

An **unknown semantic role is not an unknown command.** A script named `abc` is
in the inventory with no role, and that is a true statement about the repository
rather than a gap in the model. Missing verification roles raise no diagnostic:
a package may deliberately have no `build`, `lint`, `test`, or `typecheck` script,
and that is known absence. Discovery describes; it does not score.

#### Structured invocation

A verification entrypoint carries a shell-independent invocation where the
package-manager evidence allows one:

```json
{
  "packagePath": "packages/api",
  "script": "test",
  "role": "test",
  "body": "vitest run",
  "primary": true,
  "invocation": { "cwd": "packages/api", "executable": "pnpm", "args": ["run", "test"] },
  "invocationStatus": "resolved",
  "source": "packages/api/package.json",
  "pointer": "/scripts/test"
}
```

Structured rather than `cd packages/api && pnpm run test`, because the shell
form bakes POSIX quoting, path escaping, and a shell dialect into a format that
has to be byte-identical on Windows. It is a **derived description** of an
interface: `discover` never runs it, and never validates it by running it.

`primary` means one thing only — the name **equals** the role root. It is not a
safety claim. `lint:fix` is in the `lint` namespace and is just as likely to
modify files; Agent-Ready claims the first from the name and says nothing about
the second. When only `test:unit` and `test:integration` exist, neither is
primary and both are reported, because choosing between them would be a guess.

`invocationStatus` has four states, and three of them are successful results:

| `invocationStatus`           | Meaning                                             |
| ---------------------------- | --------------------------------------------------- |
| `resolved`                   | an agreed package manager; `invocation` is present  |
| `package-manager-unknown`    | no manager evidence at this scope or the root       |
| `package-manager-conflict`   | the manager sources disagree; no winner is selected |
| `package-manager-incomplete` | a declaration is contradicted by another artifact   |

The script, its role, and its body are known in all four cases. An unresolved
invocation costs one field, not the entry. There is **no default executable
anywhere**: `npm` is never chosen because nothing was found, a package-local
manager always wins over the root's (including when it disagrees), a contested
declaration is never promoted to a canonical executable, and a package manager
named only in `agent-ready.yaml` never selects one — a maintainer's description
of the repository is not a statement by it.

#### The contract's verification surface

`repository.contract.verification` is the contract's `verification.required`,
with `kind: "author-declared"`, in the order the maintainer wrote it — sequence
order is declared information, and sorting it would destroy a declaration in the
act of reporting it.

It never overwrites, never becomes repository truth, and never changes a
repository-derived fact. A contract requiring `test` in a package that declares
no `test` script is a **disagreement to preserve**, not an error and not a reason
to invent the script; `discover` is not a linter. A repository's package-command
facts are byte-identical with and without a contract.

#### What `discover` does not know

- whether any command **succeeds**;
- whether the command named `test` **runs tests**, or `build` produces correct output;
- whether a `lint:*` command **modifies files**;
- whether a script **calls other scripts** internally;
- whether **CI** invokes any of them;
- whether **dependencies are installed**.

Agent-Ready discovers declared package scripts and applies a narrow deterministic
role grammar to supported verification/build entrypoints. It does **not** claim
to understand all repository commands, and the snapshot says so rather than
implying coverage it does not have. See
[ADR-0046](https://github.com/AdamEddahmouni/agent-ready/blob/main/docs/decisions/0046-command-and-verification-discovery-semantics.md).

```text
Agent-Ready repository discovery

Repository
  Root       /path/to/repo

Agent-Ready contract
  Present    yes
  Valid      yes

Repository signals
  Surfaces   yes

Packages
  Count      2, 2 named
  Manifests  2

Workspace
  Manifest   package.json
  Declared   1 source(s), 1 pattern(s)
  Matched    1 present
  Members    1

Package manager
  Manager (root)  pnpm
    Evidence
      declared  "pnpm@10.0.0"  package.json/packageManager
      derived   "pnpm-lock.yaml"  pnpm-lock.yaml

Commands
  Declared   5 script(s) in 2 package(s)

  .
    build              build   vite build
    dev                —       vite
    lint               lint    eslint .
    test               test    vitest run

  packages/api
    test               test    vitest run --coverage

Verification
  Entrypoints 3
  Required   author-declared: lint, test, build

  .
    build   pnpm run build
    lint    pnpm run lint
    test    pnpm run test

  packages/api
    test    cwd=packages/api · pnpm run test

Discovery
  Facts      13
  Known      12
  Unknown    1
  Conflicts  0
  Complete   yes
```

The evidence block is indented under the fact row it supports, so a citation can
never be read as corroborating a different fact. A value that is `unknown` is
printed as `unknown (<reason>)`, never as a value; a contradicted fact is
printed as `conflicting` with every retained claim listed; a contested one is
printed as `incomplete` with the contradicting values named, never as the
retained declaration on its own. There is deliberately no score, rating,
ranking, or recommendation.

In the command rows, `—` means **Agent-Ready did not classify that name**, not
that the command is missing or wrong; the body is shown beside it so a reader can
judge for themselves. A verification entrypoint whose package manager is
contested prints its declared script and the reason the invocation is
unresolved, and prints no executable — `npm run test` as a fallback would be the
single most misleading thing this command could do. The wording is
`declared`, `available`, `entrypoint`, and `invocation`; never `passed`,
`verified`, or `working`, because nothing was executed.

### JSON output

`--json` is a projection of the same snapshot with nothing added, dropped, or
re-derived, so the two renderings cannot disagree. It carries its own
`snapshotVersion` (currently `0`, meaning unstable and not covered by the
pre-1.0 stability promise — independent of both the contract `version` and the
package version). Every path in it is repository-relative, so byte-identical
output does not depend on where the repository is checked out.

```json
{
  "ok": true,
  "snapshotVersion": 0,
  "root": ".",
  "facts": {
    "repository.contract.present": {
      "id": "repository.contract.present",
      "kind": "derived",
      "value": true,
      "claims": [
        {
          "kind": "derived",
          "value": true,
          "evidence": [{ "source": "agent-ready.yaml", "detail": "a regular file" }]
        }
      ],
      "corroboration": {
        "kinds": ["derived"],
        "authorDeclared": false,
        "corroborated": false
      }
    },
    "repository.contract.valid": {
      "id": "repository.contract.valid",
      "kind": "derived",
      "value": true,
      "claims": [
        {
          "kind": "derived",
          "value": true,
          "evidence": [
            {
              "source": "agent-ready.yaml",
              "detail": "parsed and validated against the contract schema"
            }
          ]
        }
      ],
      "corroboration": {
        "kinds": ["derived"],
        "authorDeclared": false,
        "corroborated": false
      }
    }
  },
  "summary": { "facts": 4, "known": 4, "unknown": 0, "conflicts": 0, "complete": true },
  "diagnostics": []
}
```

An `unknown` fact has no `value` property at all, and carries the reason and the
paths that were inspected:

```json
{
  "id": "repository.contract.valid",
  "kind": "unknown",
  "reason": "no-evidence",
  "evidence": [{ "source": "agent-ready.yaml", "detail": "not present" }]
}
```

A contradicted fact has no `value` either — it keeps every claim with its own
evidence instead, and names no winner:

```json
{
  "id": "repository.declarationSurface.present",
  "kind": "declared",
  "claims": [
    {
      "kind": "declared",
      "value": true,
      "evidence": [{ "source": "signals-a.json", "pointer": "/present" }]
    },
    {
      "kind": "derived",
      "value": false,
      "evidence": [{ "source": "signals-b.json", "detail": "not declared" }]
    }
  ],
  "corroboration": {
    "kinds": ["declared", "derived"],
    "authorDeclared": false,
    "corroborated": true
  }
}
```

A conflicted fact is produced whenever two manager-specific artifacts disagree —
`pnpm-lock.yaml` beside `yarn.lock` beside `package-lock.json` — and the snapshot
reports all three with no winner. Package manager is scoped per manifest, so a
nested package naming a different manager is a second fact rather than a
contradiction about the first.

The `discover` output is a **projection** of the snapshot with nothing added,
dropped, or re-derived, so the two renderings cannot disagree about what was
discovered.

### Determinism

Two runs against an unchanged tree produce byte-identical output. There are no
absolute paths, timestamps, durations, run identifiers, or process ids; every
collection is sorted in code-unit order (never `localeCompare`, never
filesystem iteration order); and no environment variable, network call, clock,
or random source can influence a value.

Reads are bounded: a fixed set of root-level paths, plus a walk driven only by
workspace patterns the repository itself declared. That walk is fenced to the
repository root, depth- and entry-bounded, code-unit sorted, and never enters
`node_modules` or `.git`. A manifest is parsed under a byte cap and a nesting
depth guard, mirroring the YAML guards, so hostile repository content is a failed
manifest rather than a crashed process. A path that cannot be inspected is
reported as uninspectable, never as absent.

Package and command scope is deliberately **closed-world**: packages are found by
following declared workspace patterns plus the root manifest, and commands are
discovered for exactly those packages. A `package.json` that no declaration
reaches is not reported, which is documented behaviour rather than an oversight —
see [ADR-0045](https://github.com/AdamEddahmouni/agent-ready/blob/main/docs/decisions/0045-package-and-workspace-discovery-semantics.md).

### Exit codes

`0` for a snapshot with no diagnostics or warnings only — including a
repository with no contract, no signals, a failed probe, or contradictory
sources. `2` for `DISCOVERY_ROOT_UNREADABLE`, the only fatal condition. A
missing `agent-ready.yaml` is never `CONTRACT_NOT_FOUND` for this command. See
[Exit codes](#exit-codes) and
[diagnostics.md](diagnostics.md#exit-code-mapping).

## `agent-ready verify`

Runs the same pipeline as `validate`, then runs the contract's
`verification.required` commands, in declared order. **Defaults to a dry
run** — nothing is executed unless `--execute` is passed. This is the
**only** Agent-Ready command that executes contract-declared `run`
strings; see [ADR-0014](../decisions/0014-verification-execution.md) for
why, and `docs/security/threat-model.md` for the resulting, narrowly
scoped trust-boundary exception.

```bash
agent-ready verify                         # dry run: print the ordered plan, execute nothing
agent-ready verify --execute               # actually run the commands
agent-ready verify --execute --timeout 60  # override the per-command timeout (seconds; default 900)
agent-ready verify --execute --record      # also write a JSON evidence file to the repo root
agent-ready verify --execute --handoff handoff.json
agent-ready verify --execute --check-generate
agent-ready verify --json
```

| Option                | Description                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--execute`           | Actually run the commands. Without this flag, nothing is spawned.                                                                                        |
| `--timeout <seconds>` | Fallback timeout in seconds (default: 900); `commands.<name>.timeout` takes precedence.                                                                  |
| `--record`            | Requires `--execute`. Write a JSON evidence file (`agent-ready-verify-result.json`) to the repository root. See "Recording verification evidence" below. |
| `--handoff <path>`    | Requires `--execute`. Validate structured handoff JSON and include it when recording.                                                                    |
| `--check-generate`    | Requires `--execute`. Reject generated-file drift before commands run. CLI-only in v0.6.0.                                                               |
| `--json`              | Print results as machine-readable JSON.                                                                                                                  |
| `--config <path>`     | Explicit path to the contract file.                                                                                                                      |

Commands run **sequentially, in the order declared in
`verification.required`**, invoked through the platform's native shell
(`cmd.exe` on Windows, `/bin/sh` elsewhere) — the same approach `npm run`/
`pnpm run` use. Each command's stdout/stderr is inherited straight to the
terminal; Agent-Ready never captures or persists command output. As soon
as one command does not pass, execution stops and every remaining command
is reported `"skipped"` — a contract's `verification.required` order is
meaningful (it is also the order a future consumer of the contract would
expect these commands to run in).

**Per-command status values:**

| Status               | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `planned`            | Dry-run only: this command would run at this position, but did not.               |
| `passed`             | The command exited with status 0.                                                 |
| `failed`             | The command exited with a non-zero status.                                        |
| `timed-out`          | The command exceeded `--timeout` and was killed.                                  |
| `termination-failed` | The timeout elapsed but complete process-tree termination could not be confirmed. |
| `spawn-failed`       | The command's process could not be started at all (e.g. missing binary).          |
| `skipped`            | Execution had already stopped due to an earlier non-passing command.              |

**JSON output** (`--json`):

```json
{
  "ok": false,
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path/to",
  "mode": "execute",
  "commands": [
    { "id": "lint", "run": "pnpm lint", "status": "failed", "exitCode": 1, "durationMs": 1123 },
    { "id": "test", "run": "pnpm test", "status": "skipped", "exitCode": null, "durationMs": 0 }
  ],
  "diagnostics": [{ "code": "VERIFICATION_COMMAND_FAILED", "...": "..." }]
}
```

`mode` is `"dry-run"` or `"execute"`. If the contract declares no
`verification.required` commands, `agent-ready verify` succeeds (`ok:
true`, `commands: []`) with a `VERIFICATION_NOT_DECLARED` warning rather
than failing — there is simply nothing to verify.

### Recording verification evidence

`agent-ready verify --execute --record` writes the run's result to a
fixed file at the repository root, `agent-ready-verify-result.json`,
overwriting it on every run — it reflects only the most recent
invocation, with no history or aggregation across runs. `--record`
without `--execute` is a usage error (exit code 1): a dry run has nothing
verified to attest to.

The evidence file's shape is the same as the `--json` body above, plus
one field, `recordedAt` (an ISO-8601 timestamp):

```json
{
  "ok": true,
  "recordedAt": "2026-01-01T00:00:00.000Z",
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path/to",
  "mode": "execute",
  "commands": [
    { "id": "lint", "run": "pnpm lint", "status": "passed", "exitCode": 0, "durationMs": 842 }
  ],
  "diagnostics": []
}
```

When a record is written, the CLI's own output (both `--json` and human
text) additionally reports where: a `recordedTo` field in JSON mode, or a
`Recorded verification evidence to <path>` line in human mode. Like every
other write in this project, the output path is hardcoded and never
contract-supplied, and never captures a command's actual stdout/stderr —
only the same structured status fields already shown above. If the write
itself fails (permissions, disk space), `VERIFICATION_RECORD_WRITE_FAILED`
is reported and the run's own exit code reflects the failure. See
[ADR-0015](../decisions/0015-verification-evidence-recording.md) for the
full design and its explicit scope boundary against
`ROADMAP.md`'s commercial "historical verification-evidence retention"
category (this is a single local file, not history or a dashboard).

## Exit codes

| Code | Meaning                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success                                                                                                                                                                                                    |
| 1    | Validation failed (schema or semantic error), generated/protected/documentation drift was found, or a `verify --execute` command failed or timed out                                                       |
| 2    | Contract or analysis input was not readable; Git could not be read (`check`); a `verify --execute` command could not be spawned; or the `discover --root` path was missing, not a directory, or unreadable |
| 3    | Unsupported contract version                                                                                                                                                                               |
| 10   | Internal Agent-Ready failure, including a `generate --write` or `verify --execute --record` write failure or a bundled-`agent-ready schema` integrity failure (please report as a bug)                     |

See [diagnostics.md](diagnostics.md) and
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) for how a set
of diagnostics maps to a single exit code.

## Stability

`--json` output shape is covered by the pre-1.0 compatibility policy in
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md) (additive
changes only). Human-readable (non-JSON) output is **not** covered by any
compatibility guarantee and may be reformatted at any time — scripts must
use `--json`.
