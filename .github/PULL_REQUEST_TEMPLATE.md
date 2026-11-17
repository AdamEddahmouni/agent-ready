## Summary

<!-- Brief description of what this PR changes and why. Link any related issue. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Schema / contract change
- [ ] New or changed diagnostic code
- [ ] Documentation
- [ ] Refactor / chore

## Compatibility and breaking-change assessment

- [ ] No public surface change (CLI flags, `--json` output, diagnostic codes, schema, exports) — or the change is additive-only per [ADR-0009](/docs/decisions/0009-pre-1.0-stability-policy.md)
- [ ] Breaking or behavior-changing for existing contracts/users — explained below in the PR description, with an ADR if required by [GOVERNANCE.md](/GOVERNANCE.md)
- [ ] Generated-file impact assessed: adapter output, golden fixtures, or the compatibility corpus (`compatibility/adapter-output/`) updated if generated output changes

## Quality gate

All of the following pass locally:

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`

## Verification performed

<!-- List the commands you actually ran and their results, and paste relevant output or screenshots for UI/CLI changes. -->

## Checklist

- [ ] Tests added or updated for behavior changes (unit in `tests/unit/`, integration in `tests/integration/`)
- [ ] New diagnostic codes are registered in `src/diagnostics/codes.ts`, documented in `docs/specification/diagnostics.md`, and covered by a triggering test
- [ ] New or changed schema fields have a passing and (if applicable) failing example under `examples/`, plus a `docs/specification/contract-reference.md` update
- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] ADR added or updated if this is a consequential technical decision (see [GOVERNANCE.md](/GOVERNANCE.md))
- [ ] No contract-declared commands executed outside `agent-ready verify --execute`
