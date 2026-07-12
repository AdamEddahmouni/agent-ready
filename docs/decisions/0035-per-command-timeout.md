# ADR-0035: Per-command verification timeout

- Status: accepted
- Date: 2026-07-11

## Decision

Contract version 1 adds optional `commands.<name>.timeout`, an integer from 1 through 3,600 seconds. Verification resolves each execution bound as `command.timeout ?? --timeout ?? 900`. The resolved seconds are included in command evidence as `timeoutSeconds`.

This narrowly reopens ADR-0014's decision to defer per-command timeouts and uses the extensible command object selected by ADR-0006. No environment, working-directory, shell, or network-policy fields are added.

## Compatibility

Contracts omitting the field normalize as before. Contract `version` remains 1 and existing evidence remains valid because the evidence addition is additive.
