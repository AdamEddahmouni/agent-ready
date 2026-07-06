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

## Quality gate

All of the following pass locally:

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`

## Checklist

- [ ] Tests added or updated for behavior changes (unit in `tests/unit/`, integration in `tests/integration/`)
- [ ] New diagnostic codes are registered in `src/diagnostics/codes.ts`, documented in `docs/specification/diagnostics.md`, and covered by a triggering test
- [ ] New or changed schema fields have a passing and (if applicable) failing example under `examples/`, plus a `docs/specification/contract-reference.md` update
- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] ADR added or updated if this is a consequential technical decision (see [GOVERNANCE.md](/GOVERNANCE.md))
- [ ] No contract-declared commands executed outside `agent-ready verify --execute`
