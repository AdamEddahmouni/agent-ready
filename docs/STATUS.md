# Project Status

**Last updated:** 2026-07-13

## Summary

| Aspect          | Detail                           |
| --------------- | -------------------------------- |
| Project         | Agent-Ready                      |
| Version         | 0.6.1                            |
| Stage           | Pre-1.0 (security-hardened line) |
| Package         | `@adameddahmouni/agent-ready`    |
| License         | Apache-2.0                       |
| Node            | >= 20.0.0                        |
| Package Manager | pnpm@10                          |

## Current Branch

`codex/security-hardening-v060` — security hardening and release pipeline for v0.6.1.

## Verification Pipeline

| Command                  | Status |
| ------------------------ | ------ |
| `pnpm format:check`      | Green  |
| `pnpm check:action-pins` | Green  |
| `pnpm lint`              | Green  |
| `pnpm typecheck`         | Green  |
| `pnpm test`              | Green  |
| `pnpm build`             | Green  |

Last full verification: 2026-07-02T04:08:30.043Z (see `agent-ready-verify-result.json`).

## Known Limitations

See `docs/security/threat-model.md` for the full list. Key ones:

- Symlinked contract files are followed transparently during discovery.
- Case-insensitive path conflicts are not detected (exact match only).
- Glob-pattern overlap uses string equality, not semantic intersection.
- `agent-ready check` requires `git` on PATH.

## Recent Changes

- v0.6.1: Refuse symlink write targets, escalate timed-out POSIX processes to SIGKILL, require bounded CLI timeouts, gate releases on signed tags and protected environments.
- v0.6.0: Structured handoff evidence (`--handoff`), per-command `timeout`, `verify --execute --check-generate` drift detection.

## What's Next

See `ROADMAP-TO-1.0.md` for the milestone plan. Next milestone is v0.7.0 (Architecture-dependency analysis and framework-specific examples), followed by v0.8.0 (Multi-language doctor probing and external adapter registration).

## Brain Integration

This repository is integrated with the Agentic Development Brain. Session protocols are in `CLAUDE.md` and `AGENTS.md`. The `.devbrain/project.yaml` file records registration metadata.
