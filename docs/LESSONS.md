# Verified Lessons

Reusable findings, patterns, and pitfalls discovered during development of
Agent-Ready. Each entry is a candidate for brain memory curation.

## Index

| Date       | ID         | Title                                                    | Status    |
| ---------- | ---------- | -------------------------------------------------------- | --------- |
| 2026-07-13 | LESSON-001 | Brain integration follows startup/completion protocol    | candidate |
| 2026-07-16 | LESSON-002 | A roadmap written before a field ships can contradict it | candidate |

---

## LESSON-001 — Brain integration follows startup/completion protocol

**Date:** 2026-07-13
**Status:** candidate

**Finding:** When integrating a repository with the Agentic Development Brain,
the CLAUDE.md and AGENTS.md files should contain the startup and completion
protocols without duplicating the full knowledge base. The knowledge base
(commands, paths, restrictions, architecture) lives in `agent-ready.yaml`.
The protocol files reference the knowledge base — they don't replicate it.

**Applied in:** `CLAUDE.md`, `AGENTS.md`

**Verification:** The protocol files are under 100 lines each and delegate
all factual claims (commands, paths, schema shape) to `agent-ready.yaml` and
the files it references.

---

## LESSON-002 — A roadmap written before a field ships can contradict it

**Date:** 2026-07-16
**Status:** candidate

**Finding:** ROADMAP-TO-1.0.md planned v0.7.0's import-graph analysis against
`architecture.boundaries` before v0.5.0 had shipped that field. When it shipped
(ADR-0032) it was free-form 1–500-character prose. The roadmap still assumed a
parseable `from → to` syntax "validated at contract-load time," which would have
retyped a shipped field and broken both ADR-0009 and the roadmap's own
additive-only guiding principle. The roadmap's dogfooding exit criterion was
likewise unmeetable: it required zero false positives against this repository's
own `boundaries`, which are concepts ("CLI presentation modules"), not paths.

The mismatch was invisible from the roadmap alone. It only surfaced by reading
the shipped schema (`$defs.architectureGuidanceList`) and the repo's own
contract next to the plan.

**How to apply:** When a roadmap milestone builds on a field from an earlier
milestone, re-read the field's shipped schema and the ADR that landed it before
trusting the roadmap's description of it. Prefer the earlier ADR's
reconsideration trigger over the roadmap's forward guess — ADR-0032's trigger
had already called for "a separately structured, machine-readable boundary form
rather than overloading human guidance strings," which is exactly what ADR-0037
adopted, and it predated the roadmap text that contradicted it.

**Corollary:** ADR numbers reserved by a roadmap are not reserved in reality.
ADR-0040 was accepted out of sequence (release/version taxonomy) while the
roadmap's table still assigned 0040 to the 1.0 public API freeze. Allocate an
ADR number from `docs/decisions/`, never from a plan document.

**Applied in:** `docs/decisions/0037-architecture-dependency-analysis.md`,
`ROADMAP-TO-1.0.md`

**Verification:** ADR-0037 keeps `boundaries` untouched and adds
`boundary_rules` as an additive sibling; both of this repository's prose
boundaries are expressible as structured rules, making the v0.7.0 exit
criterion meetable.
