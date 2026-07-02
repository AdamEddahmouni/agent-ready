# CLI reference

The `agent-ready` CLI never executes a command declared in a contract,
and never modifies the repository it inspects — except `agent-ready
generate --write`, which writes only the adapter-hardcoded files it
plans to generate (see [`agent-ready generate`](#agent-ready-generate)
below).

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
contract's enabled adapters (`agentsMd` -> `AGENTS.md`, `claude` ->
`CLAUDE.md`) into files at the repository root. Defaults to a dry run —
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

Adapters with no renderer yet (`cursor`, `copilot`, `gemini`) produce an
`ADAPTER_NOT_YET_IMPLEMENTED` warning if enabled, and are skipped rather
than failing generation.

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

## Exit codes

| Code | Meaning                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Success                                                                                                                              |
| 1    | Validation failed (schema or semantic error), a `generate --write` target exists but is unmanaged, or `generate --check` found drift |
| 2    | Contract not found or unreadable                                                                                                     |
| 3    | Unsupported contract version                                                                                                         |
| 10   | Internal Agent-Ready failure, including a `generate --write` write failure (please report as a bug)                                  |

See [diagnostics.md](diagnostics.md) and
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) for how a set
of diagnostics maps to a single exit code.

## Stability

`--json` output shape is covered by the pre-1.0 compatibility policy in
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md) (additive
changes only). Human-readable (non-JSON) output is **not** covered by any
compatibility guarantee and may be reformatted at any time — scripts must
use `--json`.
