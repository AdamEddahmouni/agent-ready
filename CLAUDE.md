# Agent-Ready — Session Protocol

This file defines the startup and completion protocol for every agent session
in this repository. It is intentionally lightweight — the canonical project
description, commands, restrictions, architecture, and verification
requirements live in `agent-ready.yaml`. Do not duplicate the knowledge base
here.

## Startup Protocol

Every agent session must follow this sequence before editing any file:

1.  **Read `agent-ready.yaml`.** This is the single source of truth for
    commands, paths, restrictions, verification requirements, and architecture.
2.  **Read repository status.** Inspect `docs/STATUS.md` and
    `docs/project-standing.md` for the current project state and known
    limitations.
3.  **Retrieve project context from the Brain MCP.** Load curated decisions,
    verified lessons, and memory context before acting.
4.  **Check accepted decisions relevant to the task.** Browse
    `docs/decisions/README.md` and read any ADRs that govern the area you are
    about to touch.
5.  **Check recent verified lessons.** Review `docs/LESSONS.md` for reusable
    findings that may affect the approach.
6.  **Check Graphify freshness.** Run `node scripts/check-graph-freshness.mjs`
    and refresh the graph if stale.
7.  **Inspect current Git state.** `git status`, `git log --oneline -5`,
    `git diff`.
8.  **Inspect the actual affected code.** Read the files before editing.
    Understand the module boundaries from
    `docs/architecture/overview.md`.
9.  **Present a plan before editing.** State what will change and why,
    referencing the ADRs or constraints that support the approach.

## Source Priority

When resolving ambiguity, prefer sources in this order:

1.  Actual code and command output
2.  `agent-ready.yaml`
3.  Accepted decisions (`docs/decisions/`)
4.  Current status (`docs/STATUS.md`)
5.  Curated brain memory
6.  Generated graph data
7.  Candidate memory
8.  Model auto-memory

## Completion Protocol

Every agent session must complete this sequence before claiming done:

1.  **Run required verification commands.** Execute the pipeline declared in
    `agent-ready.yaml`'s `verification.required` block (format, action-pins,
    lint, typecheck, test, build). Run `agent-ready verify --execute` or the
    individual commands.
2.  **Review the complete diff.** `git diff --stat` and inspect every changed
    file.
3.  **Compare results with acceptance criteria.** Does the diff match the
    stated goal? Are new tests present for behavior changes?
4.  **Update `docs/STATUS.md`** when project state changed (version bumps,
    new capabilities, resolved limitations).
5.  **Record a session summary.** Run `node scripts/record-session-summary.mjs`
    with a brief description of what was done, what files changed, and what
    commands ran.
6.  **Submit reusable findings as memory candidates.** Add entries to
    `docs/LESSONS.md` for patterns, pitfalls, or constraints worth
    remembering.
7.  **Refresh structural graph information** when source structure changed
    (new modules, moved files, new dependencies). Run
    `node scripts/refresh-graph.mjs`.
8.  **Record commands run and files changed** in `docs/WORK_LOG.md`.
9.  **Never claim completion with failing tests.** A green verification
    pipeline is the minimum bar.
10. **Never deploy, publish, merge, or push without explicit approval.**
    This includes `npm publish`, `git push`, merging PRs, or triggering
    release workflows.

## Security

- Do not expose secrets, tokens, or environment variables to the brain.
- Exclude `.env*` files from all context.
- Exclude generated dependency directories (`node_modules/`, `dist/`,
  `coverage/`).
- Do not commit machine-specific absolute paths unless stored in a local
  ignored configuration.
- Preserve compatibility for contributors who do not use the brain —
  all required workflows must remain functional without brain integration.

## Key References

- **Canonical contract:** `agent-ready.yaml`
- **Architecture:** `docs/architecture/overview.md`
- **Decisions:** `docs/decisions/README.md`
- **Security:** `docs/security/threat-model.md`
- **Status:** `docs/STATUS.md` · `docs/project-standing.md`
- **Roadmap:** `ROADMAP.md` · `ROADMAP-TO-1.0.md`
- **Contributing:** `CONTRIBUTING.md`
