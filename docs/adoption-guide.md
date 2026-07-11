# Adoption guide

Agent-Ready's CLI already exists (see
[docs/project-standing.md](project-standing.md)), so adoption today does
not require waiting for a future tool. The `agent-ready init` command can
scaffold a starter contract from your repository, or you can hand-author
one — both paths are real today.

## Current adoption flow (real today)

1. Install the public preview with `npm install -D agent-ready@next` once the
   `0.4.0-beta.1` package is published. Until then, run `pnpm install` and
   `pnpm build` inside a source checkout; see [README.md](../README.md).
2. Scaffold a starter contract with `agent-ready init` (review the
   output, then `agent-ready init --write` to write it), or hand-author
   one using [docs/specification/contract-reference.md](specification/contract-reference.md)
   and the examples in [examples/](../examples/) —
   [examples/minimal/agent-ready.yaml](../examples/minimal/agent-ready.yaml)
   for the smallest valid contract, or
   [examples/complete-phase-1/agent-ready.yaml](../examples/complete-phase-1/agent-ready.yaml)
   for one using every field.
3. Edit `agent-ready.yaml` at the repository root, declaring at minimum
   `version: 1` and `project.name`.
4. Declare the commands your repository already runs
   (`commands.lint.run`, `commands.test.run`, etc.) and list the ones
   that must pass under `verification.required`.
5. Declare `paths.protected` for anything an agent should never modify
   without explicit review (secrets, generated output, CI config).
6. Run `agent-ready validate` and fix any diagnostics it reports.
7. Enable the adapters you want (`adapters.agentsMd.enabled: true`,
   etc.) and run `agent-ready generate --write` to produce
   `AGENTS.md`/`CLAUDE.md`/etc. — safe to re-run; it never overwrites
   hand-authored content without `--force`.
8. Wire `agent-ready check`, `agent-ready generate --check`, and
   `agent-ready verify --execute` into CI, either by hand-copying the
   CLI invocations or by adopting the reusable composite action (see
   [docs/specification/ci-integration.md](specification/ci-integration.md)).
9. Point AI coding agents at the generated instruction files (or the
   contract directly) as the source of truth for repository commands
   and constraints.

For a repository that already has a valid contract from an earlier release,
run `agent-ready upgrade` first, review its field-level diff, and opt in with
`agent-ready upgrade --write` when the additions are appropriate.

## npm preview flow

```bash
npm install -D agent-ready@next
npx agent-ready init
npx agent-ready validate
npx agent-ready generate --write
```

The package workflow is ready but the first public preview still requires the
repository-visibility and npm bootstrap steps in
[docs/releasing.md](releasing.md). Stable v0.4.0 will use the normal
`npm install -D agent-ready` command without the `next` tag.

## What adoption does not require

- No account, no hosted service, no network access beyond `pnpm
install`'s package download.
- No CI change is mandatory to get value: `agent-ready validate` and
  `agent-ready generate` are useful run locally, on demand.
- No commitment to enable every adapter — enabling zero adapters still
  makes `validate`/`check`/`verify`/`analyze` useful on their own.
