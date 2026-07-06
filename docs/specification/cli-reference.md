# CLI reference

The `agent-ready` CLI never modifies the repository it inspects — except
`agent-ready generate --write`, which writes only the adapter-hardcoded
files it plans to generate (see [`agent-ready generate`](#agent-ready-generate)
below), and `agent-ready verify --execute --record`, which writes a single
JSON evidence file to the repository root (see
[`agent-ready verify`](#agent-ready-verify) below and
[ADR-0015](../decisions/0015-verification-evidence-recording.md)) — and
never executes a command declared in a contract, except `agent-ready
verify --execute`, which runs exactly the commands declared in
`verification.required` (see [`agent-ready verify`](#agent-ready-verify)
below and [ADR-0014](../decisions/0014-verification-execution.md)).

This reference covers the nine commands that exist today. One additional
command (`init`) is proposed, not implemented — see
[docs/implementation-scope-cli-package.md](../implementation-scope-cli-package.md).
`agent-ready schema` is the first Path A ship per
[ADR-0021](../decisions/0021-cli-package-maturity-direction.md) and
[ADR-0022](../decisions/0022-agent-ready-schema-command.md);
`agent-ready doctor` is the second, per
[ADR-0023](../decisions/0023-agent-ready-doctor-command.md);
`agent-ready explain` is the third, per
[ADR-0024](../decisions/0024-agent-ready-explain-command.md).

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
Verification, Paths, Instruction sources, Adapters.

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
[ADR-0020](../decisions/0020-instruction-source-link-analysis.md).

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

| Option            | Description                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--code <CODE>`   | (required) The diagnostic code to explain (e.g. `PACKAGE_MANAGER_UNAVAILABLE`).                                      |
| `--json`          | Print results as machine-readable JSON.                                                                              |
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
agent-ready verify --json
```

| Option                | Description                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--execute`           | Actually run the commands. Without this flag, nothing is spawned.                                                                                        |
| `--timeout <seconds>` | Per-command timeout in seconds (default: 900). Applies uniformly to every command in the run.                                                            |
| `--record`            | Requires `--execute`. Write a JSON evidence file (`agent-ready-verify-result.json`) to the repository root. See "Recording verification evidence" below. |
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

| Status         | Meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `planned`      | Dry-run only: this command would run at this position, but did not.      |
| `passed`       | The command exited with status 0.                                        |
| `failed`       | The command exited with a non-zero status.                               |
| `timed-out`    | The command exceeded `--timeout` and was killed.                         |
| `spawn-failed` | The command's process could not be started at all (e.g. missing binary). |
| `skipped`      | Execution had already stopped due to an earlier non-passing command.     |

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

| Code | Meaning                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success                                                                                                                                                                                |
| 1    | Validation failed (schema or semantic error), generated/protected/documentation drift was found, or a `verify --execute` command failed or timed out                                   |
| 2    | Contract or analysis input was not readable; Git could not be read (`check`); or a `verify --execute` command could not be spawned                                                     |
| 3    | Unsupported contract version                                                                                                                                                           |
| 10   | Internal Agent-Ready failure, including a `generate --write` or `verify --execute --record` write failure or a bundled-`agent-ready schema` integrity failure (please report as a bug) |

See [diagnostics.md](diagnostics.md) and
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) for how a set
of diagnostics maps to a single exit code.

## Stability

`--json` output shape is covered by the pre-1.0 compatibility policy in
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md) (additive
changes only). Human-readable (non-JSON) output is **not** covered by any
compatibility guarantee and may be reformatted at any time — scripts must
use `--json`.
