# ADR-0014: Verification execution and the command-execution trust boundary

> v0.6.0 note: ADR-0035 narrowly reopens the deferred per-command-timeout
> decision. `commands.<name>.timeout` now overrides the global CLI fallback.

## Status

Accepted

## Context

Since Phase 0/1, `commands` and `verification.required` have been validated,
normalized, and rendered into generated instruction files, but never run.
[ADR-0006](0006-command-representation.md) established this as a deliberate,
load-bearing security boundary: `run` strings are opaque data, and no code
path anywhere spawns a process or shell based on contract content. That ADR
also named the trigger for revisiting it: "When a future phase implements
actual command execution... revisit whether `run` needs to become a
structured (argv-array) form to avoid shell interpretation entirely, versus
staying a shell-invoked string with documented shell-quoting rules." This is
that phase.

`ROADMAP.md`'s "long-term open-source direction" lists local command
execution and verification evidence first among its candidate next phases,
and the README's own pipeline diagram has always shown "CI policies,
verification evidence" as the step after protected-path enforcement
(Phase 4). Implementing it necessarily crosses ADR-0006's boundary — there is
no way to "run the commands a repository declares" without running them.
The goal of this ADR is not to avoid that, but to make the resulting,
narrower boundary just as explicit and load-bearing as the one it replaces.

## The trust boundary reframing

Before this phase, `agent-ready.yaml` content was treated as fully untrusted
input throughout the pipeline (see `docs/security/threat-model.md`) because
nothing ever interpreted it as anything other than inert, validated data.
Once a command can execute `run` strings, that framing cannot hold for the
command that does so: whoever can edit `agent-ready.yaml` can declare
arbitrary shell commands, and running them is the entire point of the
feature. This is not a new risk particular to Agent-Ready — it is exactly
the same trust boundary `package.json`'s `scripts`, a `Makefile`'s targets,
and a CI config's `run:` steps already have. Anyone with write access to
`agent-ready.yaml` already has write access to those files in the same
repository.

The boundary this phase draws is therefore about **surface area**, not about
pretending the risk away:

- Execution lives behind exactly one command, `agent-ready verify`.
  `validate`, `inspect`, `generate`, and `check` are entirely unaffected and
  remain provably non-executing — grepping for the new `CommandRunner`
  interface's only real implementation (`NodeCommandRunner`) shows it is
  constructed nowhere else.
- `agent-ready verify` itself defaults to a **dry run** that only prints the
  ordered plan; nothing is spawned unless `--execute` is passed explicitly.
  This mirrors [ADR-0010](0010-generate-write-boundary.md)'s `--write`
  boundary for `generate` — the one other command in this project capable of
  a side effect defaults to inert, and so does this one.
- Only commands reachable via `verification.required` are ever run. A
  `commands` entry that exists but isn't referenced from
  `verification.required` is still inert data, exactly as it is today.

## Alternatives considered

**Command invocation form:**

- **Argv-array splitting** (parse `run` into discrete arguments, spawn
  without a shell): rejected. It would require either a shell-lexing
  dependency or a hand-rolled one, and it silently breaks every `run` string
  in this project's own examples and dogfooded contract that relies on shell
  features (`pnpm install --frozen-lockfile` is fine split naively, but
  nothing stops an author from writing `pnpm lint && pnpm test` or
  `pnpm build > build.log`, which argv-splitting cannot express without
  reintroducing a shell anyway). `contract-reference.md` already documents
  `run` as "the literal command line," which only makes sense under shell
  invocation.
- **Shell invocation via `child_process.spawn(..., { shell: true })`,
  chosen.** The same approach `npm run`/`pnpm run` and GitHub Actions'
  `run:` steps use. Cross-platform shell differences (`cmd.exe` on Windows
  vs. `/bin/sh` elsewhere) are an inherent, well-understood characteristic
  of every tool that takes this approach, not a defect to fix here.

**Scope of what's runnable:**

- **Any `commands` entry, selectable by id** (e.g. `verify --only lint`):
  rejected for v1 — expands the executable surface beyond what the roadmap
  asked for ("actually running the commands declared in
  `verification.required`"), with no concrete need yet. Noted as a
  reconsideration trigger.
- **Exactly `verification.required`, in declared order, chosen.** Matches
  ADR-0006's own description of that field's order as "the sequence in which
  a future verification phase would run these commands."

**Failure handling:**

- **Run every command regardless of earlier failures, report a full
  matrix**: considered, but produces a less predictable default (an early
  `install` failure would still let a later `build` run against a broken
  install) and does more work — including running more arbitrary shell
  commands — when the outcome is already going to be a failure.
- **Stop at the first failure, mark the rest `"skipped"`, chosen.** Matches
  `&&`-chained shell semantics and typical CI behavior; minimizes how many
  contract-declared commands actually run when something is already broken.
  A `--keep-going` flag remains a reconsideration trigger if a concrete need
  surfaces.

**Output handling:**

- **Capture stdout/stderr into the structured result/diagnostics**:
  rejected for v1. The threat model already treats diagnostic output as
  something that "must not contain secrets or full environment state"
  (`src/diagnostics/types.ts`); a command's own output is exactly the kind
  of content that could contain either, and redacting it reliably is a
  substantial, separate problem. Buffering it also reintroduces the
  `maxBuffer` sizing question `NodeGitClient` already had to solve for a
  much narrower case (Git's own structured output).
- **Inherit stdio, chosen.** `agent-ready verify --execute` streams each
  command's real output straight to the terminal, identical to running the
  command by hand. The structured result per command carries only
  `id`, `run`, `status`, `exitCode`, and `durationMs` — enough to answer
  "did this pass" without capturing content that might need redaction.

**Timeout:**

- **A per-command schema field** (e.g. `commands.<id>.timeoutSeconds`):
  rejected for v1 — a schema change for a single concrete need, ahead of any
  evidence that a uniform default doesn't suffice. Reconsideration trigger.
- **A single global `--timeout <seconds>` CLI flag (default 900s), applied
  to every command in the run, chosen.** Simplest option that still bounds a
  hung command; matches this project's general preference for the smallest
  mechanism that solves the immediate need (see `docs/architecture/overview.md`'s
  "no unused abstractions" principle).
- Implemented with an explicit `setTimeout`/`child.kill()` pair in
  `NodeCommandRunner`, rather than `spawn`'s built-in `timeout` option,
  because the built-in option's signal-based completion is not reliably
  distinguishable from a command that happens to receive the same signal
  from something else; an explicit local flag removes the ambiguity.

## Decision

- **New `agent-ready verify` CLI command**, following the existing
  `loadContract` → domain logic → `CliOutcome` shape every other command
  uses (`src/cli/commands/verify.ts`).
- **New `src/verify/` module**, mirroring the `src/git/` pattern
  established in ADR-0013: a `CommandRunner` interface, `NodeCommandRunner`
  (real, `spawn`-backed), and `FakeCommandRunner` (deterministic test
  double, no process ever spawned in unit tests).
- **Dry run by default; `--execute` required to run anything.** Dry-run
  output lists the ordered plan (`id`, `run`, `description?`) with no
  process ever spawned.
- **Sequential execution, stop at first non-passing command.** Remaining
  commands are reported with status `"skipped"`.
- **New diagnostic codes**, added to `src/diagnostics/codes.ts` and
  `docs/specification/diagnostics.md`:
  - `VERIFICATION_NOT_DECLARED` (warning) — the contract has no
    `verification.required`; nothing to run. Does not fail the command.
  - `VERIFICATION_COMMAND_FAILED` (error) — a command exited non-zero.
  - `VERIFICATION_COMMAND_TIMEOUT` (error) — a command exceeded the timeout
    and was killed.
  - `VERIFICATION_COMMAND_SPAWN_FAILED` (error) — the process could not be
    started at all (e.g. the underlying executable is missing).
- **No new exit-code value.** Per ADR-0009's pre-1.0 stability policy, the
  5-value scheme stays stable. `VERIFICATION_COMMAND_FAILED` and
  `VERIFICATION_COMMAND_TIMEOUT` map to `VALIDATION_FAILED` (1) — the same
  bucket as `PROTECTED_PATH_MODIFIED`, a user-actionable "fix your repo/
  command" outcome. `VERIFICATION_COMMAND_SPAWN_FAILED` maps to
  `CONTRACT_NOT_FOUND` (2) — the same bucket as `GIT_UNAVAILABLE`, an
  environment/setup problem rather than something about the contract
  itself.

## Consequences

- `agent-ready verify` is the second command whose behavior depends on
  something beyond Node.js and the contract file — in this case, whatever
  the declared `run` commands themselves depend on (this was already true
  of `agent-ready check` and `git`, per ADR-0013).
- ADR-0006's "never execute contract-declared commands" boundary is no
  longer absolute across the whole project; it is now scoped specifically
  to `validate`, `inspect`, `generate`, and `check`, which remain provably
  non-executing. `docs/security/threat-model.md`, `README.md`, and
  `CONTRIBUTING.md` are updated in the same change to state the narrower
  boundary explicitly, per the same requirement ADR-0013 already satisfied
  for its own, smaller boundary crossing (Git invocation).
- `ROADMAP.md`'s strict non-goals list drops "command or shell execution of
  any kind" and "verification-evidence execution"; a new "Phase 5" entry
  records what shipped, following the Phase 4 precedent.
- A contract author now has a real, first-party way to prove their
  declared verification commands pass, closing the gap between "AGENTS.md
  says how to verify this repo" and "something actually ran that
  verification and recorded the result."

## Reconsideration trigger

Revisit this decision if:

- A concrete need emerges for per-command timeouts, environment variable
  declarations, or a working directory other than the repository root —
  at that point `commands`' schema likely needs additive fields, not a
  reshaping of `run` itself.
- A concrete need emerges for running an arbitrary `commands` entry outside
  `verification.required` (a `--only <id>` flag), or for continuing past a
  failure (`--keep-going`).
- A future phase wants to capture and persist command output as evidence
  (e.g. a completion record) — that reopens the "output may contain
  secrets" question this ADR deliberately avoided by never capturing output
  at all.
