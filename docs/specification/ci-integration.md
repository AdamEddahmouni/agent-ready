# CI integration (GitHub composite action)

See [ADR-0016](../decisions/0016-reusable-ci-action.md) for the full
rationale; this document is the user-facing summary of how to adopt
Agent-Ready's CLI in another repository's CI, without hand-copying shell
steps.

## What it is

`action.yml` at this repository's root is a GitHub **composite action**.
It builds Agent-Ready from source (`pnpm install && pnpm build`, inside
its own checkout) and then runs exactly the same `dist/cli/index.js`
entrypoint documented in [cli-reference.md](cli-reference.md) — against
**your** repository, since a composite action's final step runs in the
calling job's default working directory.

It is not a hosted service, and it does not require publishing or
installing an npm package: GitHub already checks out this repository (at
the ref you pin) before running the action, so the action can build
itself in place.

## Pinning

Prefer an immutable full commit SHA when your supply-chain policy requires it:

```yaml
uses: agent-ready/agent-ready-repo@<commit-sha>
```

For readable version pinning, use the corresponding release tag, such as
`v0.2.0`. Do not pin a mutable branch name.

## Usage

Call the action once per `agent-ready` command you want in your CI job.
Every input below mirrors an actual CLI flag documented in
[cli-reference.md](cli-reference.md) — an input irrelevant to the
`command` you chose is simply ignored.

```yaml
name: agent-ready
on: [pull_request, push]

jobs:
  agent-ready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate contract
        uses: agent-ready/agent-ready-repo@v0.2.0
        with:
          command: validate

      - name: Check generated files are up to date
        uses: agent-ready/agent-ready-repo@v0.2.0
        with:
          command: generate
          check: "true"

      - name: Check protected paths
        uses: agent-ready/agent-ready-repo@v0.2.0
        with:
          command: check

      - name: Check documentation links
        uses: agent-ready/agent-ready-repo@v0.2.0
        with:
          command: analyze

      - name: Run verification
        uses: agent-ready/agent-ready-repo@v0.2.0
        with:
          command: verify
          execute: "true"
          record: "true"
```

## Inputs

| Input          | Maps to                                                                         | Default                  |
| -------------- | ------------------------------------------------------------------------------- | ------------------------ |
| `command`      | (required) `validate` / `inspect` / `generate` / `check` / `analyze` / `verify` | —                        |
| `config`       | `--config <path>`                                                               | discovery, unset         |
| `json`         | `--json`                                                                        | `false`                  |
| `write`        | (generate) `--write`                                                            | `false`                  |
| `check`        | (generate) `--check`                                                            | `false`                  |
| `force`        | (generate --write) `--force`                                                    | `false`                  |
| `staged`       | (check) `--staged`                                                              | `false`                  |
| `against`      | (check) `--against <ref>`                                                       | unset                    |
| `execute`      | (verify) `--execute`                                                            | `false`                  |
| `timeout`      | (verify --execute) `--timeout <seconds>`                                        | unset (CLI default: 900) |
| `record`       | (verify --execute) `--record`                                                   | `false`                  |
| `node-version` | Node.js version used to build and run Agent-Ready                               | `"22"`                   |

A step's exit code is exactly the CLI's exit code (see
[cli-reference.md](cli-reference.md#exit-codes)) — a failing
`validate`/`check`/`analyze`/`verify` fails the job with no extra wiring. The
action never captures or parses the CLI's stdout/stderr; it flows
straight to the job log exactly as if you had run the command yourself.

## What it does not do

- It does not execute anything beyond what running the CLI locally with
  the same flags would do. `verify --execute` remains the only
  Agent-Ready code path that executes contract-declared content (see
  [ADR-0014](../decisions/0014-verification-execution.md)); calling this
  action with `command: verify, execute: "true"` is exactly that, run in
  CI instead of a terminal — not a new or wider execution boundary.
- It does not publish, fetch from, or depend on any package registry.
- It does not orchestrate multiple commands, retries, or caching beyond
  what's described above — one `uses:` call runs one `agent-ready`
  invocation.
