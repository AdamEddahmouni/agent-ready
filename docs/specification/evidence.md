# Evidence and verification model

This document separates what Agent-Ready **records today** from what a
richer, proposed "handoff evidence" model **could** cover later. Nothing
in the proposed section is implemented; see
[docs/implementation-scope-cli-package.md](../implementation-scope-cli-package.md)
for how new scope like this would be evaluated.

## What exists today: command-level verification evidence

`agent-ready verify --execute` runs the contract's
`verification.required` commands, in declared order, and reports one of
`planned` / `passed` / `failed` / `timed-out` / `spawn-failed` /
`skipped` per command. `agent-ready verify --execute --record` writes
that result, plus a `recordedAt` timestamp, to a single file at the
repository root, `agent-ready-verify-result.json`, overwritten on every
run. Full behavior, flags, and JSON shape are documented in
[cli-reference.md](cli-reference.md#agent-ready-verify); the design
rationale is [ADR-0014](../decisions/0014-verification-execution.md)
(execution) and [ADR-0015](../decisions/0015-verification-evidence-recording.md)
(recording).

This is real, narrow evidence: it proves that specific declared
commands were run, in what order, and whether each one exited
successfully. **It is not a claim that the code is correct** — a
passing `test` command proves the test suite passed, not that the tests
were adequate. It also captures no command stdout/stderr, no history
across runs, and no aggregation — by design (see ADR-0015's explicit
scope boundary against a future "historical verification-evidence
retention" commercial category in [ROADMAP.md](../../ROADMAP.md)).

## The problem a weak handoff has

A coding agent (or a human) reporting only:

```text
Done.
```

gives a reviewer nothing to check. It doesn't say what changed, what
was run, what passed, what was skipped, or what still needs a human
look. Agent-Ready's contract already gives a repository a way to
_declare_ what verification should happen (`verification.required`);
the evidence model above lets a run _prove_ that declared verification
happened. The gap is that nothing yet captures the surrounding
narrative a reviewer actually needs.

## Proposed: structured handoff evidence (not implemented)

A more complete handoff record could include, in addition to the
existing command-level results:

- a plain-language summary of what changed and why;
- the specific files changed;
- the commands actually run, beyond just `verification.required`;
- tests added, not only tests passed;
- assumptions made during the work;
- checks explicitly skipped, and why;
- known issues or follow-ups;
- risks a reviewer should weigh;
- anything that still requires manual verification.

A future `agent-ready verify` (or a new command) could accept and
validate that this structure is present and well-formed before
treating a handoff as complete — checking **shape**, not truth. It
would still be true, as it is today, that Agent-Ready verifies evidence
_structure_, never code _correctness_: a syntactically complete handoff
record with a false summary would still pass. This proposal has no ADR
yet and no committed field names; it is listed here so the direction is
visible, not because it is scheduled.

## Non-goals for this model, now and in any future phase

- Proving code correctness. Agent-Ready checks that declared
  verification ran and that evidence is structurally complete — never
  that the underlying change is actually correct.
- Persisting a command's actual stdout/stderr as evidence. Only
  structured status fields are captured today, and any future evidence
  format should preserve that boundary unless a separate ADR
  deliberately revisits it.
- Multi-run history or a hosted evidence store. Local, single-run,
  overwritten-per-run evidence is the model; historical retention
  remains a listed, unimplemented, possible commercial-product category
  (see [ROADMAP.md](../../ROADMAP.md#long-term-commercial-direction-not-implemented)).
