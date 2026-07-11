# Contributing to Agent-Ready

Thanks for your interest in contributing. This is an early-stage,
pre-1.0 open-source project — see [GOVERNANCE.md](GOVERNANCE.md) for how
decisions get made and [ROADMAP.md](ROADMAP.md) for what's in and out of
scope right now.

## Before you start

- For anything beyond a small fix, open an issue first describing the
  problem or proposal. This avoids duplicated work and lets a maintainer
  flag scope concerns early (see the **strict non-goals** in
  [ROADMAP.md](ROADMAP.md) — PRs that implement out-of-scope features for
  the current phase will not be merged, however well executed).
- Check [docs/decisions/](docs/decisions/) first if you're touching
  something that looks like a deliberate design choice (path handling,
  discovery rules, schema shape, diagnostics). If your change conflicts
  with an existing ADR, the PR description should say so explicitly and
  propose a new ADR superseding it.

## Development setup

```bash
corepack enable   # enables pnpm
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Requires Node.js `>=20.0.0` and pnpm (see
[ADR-0001](docs/decisions/0001-runtime-and-distribution.md)).

## Before opening a pull request

Run the full local quality gate and make sure every command below
succeeds:

```bash
pnpm format:check
pnpm check:action-pins
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Guidelines:

- **Tests are required for behavior changes.** Unit tests
  (`tests/unit/`) for pure logic; integration tests (`tests/integration/`)
  for anything that touches file-system discovery, the full validation
  pipeline, or CLI output.
- **New diagnostics need a stable code** from the registry in
  `src/diagnostics/codes.ts`, documented in
  `docs/specification/diagnostics.md`, and covered by a test that
  triggers it.
- **New or changed schema fields** need: a schema update, at least one
  passing example and (if applicable) one failing example under
  `examples/`, and a `docs/specification/contract-reference.md` update.
- **Do not add unused abstractions.** This project deliberately avoids
  speculative architecture (dependency-injection containers, generic
  plugin systems, unused adapter interfaces) ahead of an actual, current
  need — see `ROADMAP.md` and the architecture principles in
  `docs/architecture/overview.md`.
- **Never execute contract-declared commands outside `agent-ready verify
--execute`.** `verify` is the one, deliberate exception to this
  boundary (see [ADR-0014](docs/decisions/0014-verification-execution.md)
  and [docs/security/threat-model.md](docs/security/threat-model.md)) —
  PRs that add any other code path spawning a process or shell based on
  contract content will not be accepted.

## Commit and PR style

- Keep commits focused; prefer a few well-described commits over one huge
  one.
- Describe _why_ in the PR description, not just _what_ — link the issue
  it addresses.
- Update `CHANGELOG.md` for any user-visible change.

## Reporting bugs

Open a GitHub issue with: the `agent-ready.yaml` contract that triggers
the problem (or a minimal reproduction), the exact command run, the full
`--json` diagnostic output if applicable, your OS and Node.js version.

## Reporting security issues

Do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Developer Certificate of Origin

By submitting a contribution, you certify that you wrote it or otherwise
have the right to submit it under this project's license (Apache-2.0),
consistent with the [Developer Certificate of Origin](https://developercertificate.org/).
No separate Contributor License Agreement is required — licensing is
"inbound = outbound": your contribution is licensed to the project under
the same Apache-2.0 terms as the rest of the codebase.
