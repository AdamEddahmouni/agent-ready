# ADR-0033: `agents` contract block

## Status

Accepted for v0.5.0; not implemented

## Context

Projects often repeat the same operating constraints across `AGENTS.md`,
`CLAUDE.md`, editor rules, and hand-authored documentation: which actions need
approval, which actions agents should avoid, and which files give essential
context. The current `instructions` block can carry prose and source links but
cannot distinguish those categories or validate context-file references.

## Decision

Add an optional, additive `agents` block within contract `version: 1`:

```yaml
agents:
  disallowed_actions:
    - Do not install packages without explicit approval.
  approval_required_for:
    - Changes to CI configuration.
  context_files:
    - docs/architecture/overview.md
    - docs/decisions/README.md
```

- `disallowed_actions` and `approval_required_for` are optional arrays of
  1–300-character, non-empty strings. They are declarations for generated
  instructions, not runtime enforcement.
- `context_files` is an optional ordered list of safe, repository-relative
  Markdown paths. Semantic validation rejects duplicates; `analyze` verifies
  their existence and Markdown form.
- All five adapters render an `## Agent Constraints` section with separate
  "Do not" and "Ask before" lists, followed by links to context files. The
  section is omitted when the block is absent.
- Strings use `escapeMarkdownText`; validated context-file paths are rendered
  as link targets. Existing contracts remain byte-identical when the block is
  absent.

## Alternatives considered

- **`allowed_tools`:** rejected. Tool availability and permission semantics
  are agent-vendor specific and cannot be deterministically enforced here.
- **`default_instructions`:** rejected. `instructions.content` already serves
  maintainer-authored default guidance without creating a parallel prose field.
- **`quality_gates`:** rejected. It duplicates `verification.required` and
  would create conflicting completion semantics.
- **Runtime enforcement of text declarations:** rejected. Agent-Ready remains
  a local contract and generator, not an agent runtime or policy engine.

## Consequences

Implementation must update the JSON Schema, types, normalizer, analyzer,
shared adapter renderer, fixtures, compatibility corpus, and documentation.
Tests must demonstrate additive compatibility for all existing contracts and
safe handling of malformed, missing, duplicate, and Markdown-special input.

## Reconsideration trigger

Revisit if a future vendor-neutral, deterministic enforcement interface exists
that can distinguish advisory guidance from mechanically enforceable policy.
