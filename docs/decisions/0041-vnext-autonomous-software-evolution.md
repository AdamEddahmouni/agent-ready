# ADR-0041: vNext direction: autonomous software evolution control plane

## Status

Accepted

## Context

Agent-Ready v0.6.1 ships a real, deterministic implementation: a schema-validated
`agent-ready.yaml` contract, eleven CLI commands, protected-path enforcement,
verification execution, evidence recording, five instruction-file adapters, a
reusable GitHub Action, and a documented pre-1.0 compatibility policy. It is
useful, and it is bounded: it describes how an agent should work inside one
repository, and it proves that the work happened.

That boundary is the problem. The interesting question is no longer how to
describe a repository to an agent. It is what stands between a commissioned agent
and a change to a running system, once the work is no longer interactive, is not
produced by one model, and is not reviewed by the person who wrote it.

The surrounding ecosystem is standardizing quickly, and mostly elsewhere.
`AGENTS.md` and MCP now sit under the Linux Foundation's Agentic AI Foundation.
MCP is expanding beyond local tool calls into long-running tasks, stronger
authorization, agent identity, and production-scale agent communication. SLSA 1.2
separates build provenance from source provenance and models actor attribution.
NIST is exploring identification, authorization, auditing, and non-repudiation for
software and AI agents.

The consequence for this project is a gap, not a feature list. Coding-agent
vendors own the inner loop of producing a candidate change. No owner has emerged
for the outer loop: what the agent was allowed to do, who authorized it, whether
the change is actually correct, whether it should ship, and what reality said
afterwards. That outer loop is a governance and evidence problem, and it is
deterministic infrastructure, not a model problem.

Three directions were available.

1. Continue the v0.7 to v1.0 repository-contract path in the now-archived
   [roadmap-v1.md](../archive/roadmap-v1.md) — architecture-dependency drift
   analysis, runtime probing, external adapter registration, then stabilization.
   This is real, finishable work with existing users in mind, and it remains
   valuable. But it continues improving the instruction surface while the
   governance gap widens.
2. Introduce contract `version: 2` now and restructure the project around a
   control plane. Rejected as sequencing: no implementation experience yet with
   transactions, capability enforcement, or independent proof, so the new
   contract would encode guesses, and the experiment's own evidence base would be
   discarded before it could produce findings.
3. Pivot the center of gravity to a control-plane thesis while preserving v0.6.1
   as a working, released implementation that supplies trustworthy primitives.

Two facts constrain the shape of the answer. The project's own adoption evidence
records no confirmed external adopters, so vNext must produce standalone value on
an arbitrary repository rather than assume a community has already agreed to a
standard. And the thesis must be falsifiable, or "autonomous software evolution"
becomes unfalsifiable enthusiasm.

## Decision

Adopt option 3. Agent-Ready's next chapter is a vendor-neutral control plane for
constitutionally governed autonomous software evolution, specified in
[docs/vnext/RFC-0001-autonomous-software-evolution.md](../vnext/RFC-0001-autonomous-software-evolution.md)
and argued in [VISION.md](../../VISION.md).

The load-bearing commitments are:

- **Proposal authority is separated from certification authority.** An actor that
  proposes a change may not unilaterally redefine the criteria that certify it.
  This is the project's governing invariant, and it applies to Agent-Ready
  itself.
- **Human root authority is explicit.** Humans define or ratify the highest-order
  rules; agents operate under delegated authority; more consequential changes
  require stronger evidence or human approval.
- **The deterministic core is trusted and boring.** Schema and protocol parsing,
  the Evolution state machine, capability enforcement, evidence binding,
  transaction isolation, verification dispatch, ledger integrity, and
  constitutional authority do not require an LLM. AI may surround the kernel; AI
  must not become the kernel.
- **v0.6.1 is preserved as Experiment 0, not deleted.** Its diagnostics, filesystem
  and Git abstractions, command runner, verification execution, evidence model,
  and security threat-model culture are the trusted primitives the control plane
  generalizes. The pivot is added to the project's history, not substituted for it.
- **Progress is gated by research questions, not feature counts.** Each phase
  names a question and an exit condition; the abstraction has to survive real use
  before the next layer is built.
- **The first wedge is standalone utility.** `agent-ready discover` must produce
  useful machine-readable understanding of an arbitrary repository before anyone
  is asked to author a constitution.

This ADR selects a direction. It adds no code, no schema field, no CLI surface,
no diagnostic code, and no dependency. The architecture, phase structure, and
falsification conditions live in the RFC and
[VISION.md](../../VISION.md).

## Consequences

- The v0.7 to v1.0 milestones in the archived
  [roadmap-v1.md](../archive/roadmap-v1.md) are superseded for planning
  purposes and kept as history. Their unfinished work, notably ADR-0037
  through ADR-0039, is not built.
- The first shipped vNext capability must be read-only and must work on a
  repository that has no `agent-ready.yaml` at all.
- vNext is a research-driven open-source project. Experiments, datasets, and
  negative results are publishable outputs, and the criteria that decide whether
  the thesis survives are written down before the work, not after.
- The project must stay candid that implementation maturity currently exceeds
  ecosystem usage, and that no part of the control plane exists yet.
- Instruction-file generation is demoted to a compatibility feature. It stops
  being the product's center and keeps working.

## Reconsideration trigger

Reconsider this direction if any of the conditions in
[VISION.md](../../VISION.md) under "Explicit failure conditions" is met: repository
models do not materially improve agent performance; transactions add complexity
without meaningful safety; independent proof poorly predicts production outcomes;
existing standards fully absorb the proposed primitives; vendors converge on a
superior interoperable solution; or developers decline even zero-config
discovery. Reconsider sooner if the control-plane direction produces no shipped
capability while the v1 surface atrophies.
