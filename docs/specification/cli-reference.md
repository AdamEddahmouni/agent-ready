# CLI reference

The `agent-ready` CLI never executes a command declared in a contract and
never modifies the repository it inspects.

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

## Exit codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Success                                               |
| 1    | Validation failed (schema or semantic error)          |
| 2    | Contract not found or unreadable                      |
| 3    | Unsupported contract version                          |
| 10   | Internal Agent-Ready failure (please report as a bug) |

See [diagnostics.md](diagnostics.md) and
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) for how a set
of diagnostics maps to a single exit code.

## Stability

`--json` output shape is covered by the pre-1.0 compatibility policy in
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md) (additive
changes only). Human-readable (non-JSON) output is **not** covered by any
compatibility guarantee and may be reformatted at any time — scripts must
use `--json`.
