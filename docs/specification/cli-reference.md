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

| Code | Meaning                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success                                                                                                                                                                                                           |
| 1    | Validation failed (schema or semantic error), a `generate --write` target exists but is unmanaged, `generate --check` found drift, `check` found a violation, or a `verify --execute` command failed or timed out |
| 2    | Contract not found or unreadable; the repository is not a Git working tree or Git could not be read (`check`); or a `verify --execute` command could not be spawned at all                                        |
| 3    | Unsupported contract version                                                                                                                                                                                      |
| 10   | Internal Agent-Ready failure, including a `generate --write` or `verify --execute --record` write failure (please report as a bug)                                                                                |

See [diagnostics.md](diagnostics.md) and
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) for how a set
of diagnostics maps to a single exit code.

## Stability

`--json` output shape is covered by the pre-1.0 compatibility policy in
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md) (additive
changes only). Human-readable (non-JSON) output is **not** covered by any
compatibility guarantee and may be reformatted at any time — scripts must
use `--json`.
