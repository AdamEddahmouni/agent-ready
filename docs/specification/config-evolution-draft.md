# Config evolution: draft ideas (non-normative)

**This document is not a specification.** Everything here is a sketch of
possible future `agent-ready.yaml` fields. None of it is valid input
today — the authoritative, current field list is
[contract-reference.md](contract-reference.md), matching
[schemas/v1/agent-ready.schema.json](../../schemas/v1/agent-ready.schema.json)
exactly. Adding any field described below to the real schema requires
its own ADR and, per [GOVERNANCE.md](../../GOVERNANCE.md#decision-making-process),
explicit maintainer sign-off, since a schema change affects every
consumer of the contract, not just this repository.

## Why draft this at all before an ADR

The current schema already covers project metadata, environment,
commands, verification, paths, instruction sources, and adapters. Two
categories from the CLI/package direction are not yet representable:
richer agent-operating guidance (allowed tools, disallowed actions,
approval-required actions) and lightweight architecture notes
(decisions, boundaries, invariants). Sketching the shape here, clearly
marked as non-normative, lets that direction be discussed concretely
without pretending it is decided.

## Possible future blocks

```yaml
# Illustrative only — not valid against the current schema.

agents:
  default_instructions: ""
  allowed_tools: []
  disallowed_actions: []
  approval_required_for: []

quality_gates:
  required_before_completion:
    - lint
    - typecheck
    - test
  evidence_required: true

architecture:
  decisions: []
  boundaries: []
  invariants: []

handoff:
  required_summary: true
  required_files_changed: true
  required_commands_run: true
  required_known_issues: true
```

Notes on each, as currently sketched:

- **`agents`** would overlap in intent with `instructions.sources`
  (today's mechanism for pointing at human-maintained instruction
  documents). Before this is proposed as an ADR, it needs a clear answer
  to why structured `allowed_tools`/`disallowed_actions` fields belong
  in the contract rather than in the instruction documents
  `instructions.sources` already points at and `agent-ready generate`
  already compiles into `AGENTS.md`/`CLAUDE.md`/etc.
- **`quality_gates`** would substantially overlap with the existing
  `verification.required` field, which already declares an ordered list
  of commands required for verification. Any ADR proposing this block
  would need to justify a second, parallel mechanism rather than
  extending the existing one.
- **`architecture`** has no current equivalent; it is the least
  contested addition in principle, but "decisions"/"boundaries"/
  "invariants" as free-form arrays would need concrete validation rules
  before becoming schema fields (compare how `paths.protected` is a
  glob-pattern list with defined semantics, not a free-form array).
- **`handoff`** overlaps with the proposed evidence model in
  [evidence.md](evidence.md). If pursued, these two proposals should be
  reconciled into one ADR rather than two independent, possibly
  conflicting mechanisms.

## What would have to be true before any of this becomes real

1. A single ADR per block (or a combined ADR if the overlaps above are
   resolved in favor of one mechanism), following the same rigor as
   existing schema ADRs ([ADR-0002](../decisions/0002-json-schema-design.md),
   [ADR-0005](../decisions/0005-path-and-glob-semantics.md)).
2. A concrete validation model for each new field — not just a shape,
   but the same kind of semantic rules `contract/semantic.ts` already
   enforces for existing fields (reference resolution, path safety,
   category-conflict checks).
3. An answer to whether this requires a new contract `version` or is
   additive within `version: 1`, per
   [schema-versioning.md](schema-versioning.md).
4. Updated golden fixtures and adapter output, since any new field that
   flows into generated instructions would need the same
   Markdown-escaping discipline [ADR-0017](../decisions/0017-adapter-output-markdown-escaping.md)
   established.

Until all of the above happens, this document remains a discussion
aid, not a promise.
