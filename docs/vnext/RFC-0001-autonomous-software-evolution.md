# RFC-0001: Autonomous Software Evolution

| Field       | Value                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Design RFC — open for maintainer review, not a public specification                                                                                                                                                   |
| Date opened | 2026-09-25                                                                                                                                                                                                            |
| Supersedes  | The v0.7-to-v1.0 planning milestones in the archived [roadmap-v1.md](../archive/roadmap-v1.md)                                                                                                                        |
| Companion   | [VISION.md](../../VISION.md), [LANDSCAPE.md](LANDSCAPE.md)                                                                                                                                                            |
| Decisions   | [ADR-0041](../decisions/0041-vnext-autonomous-software-evolution.md), [ADR-0042](../decisions/0042-v1-freeze-and-parallel-vnext-surface.md), [ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md) |

## Summary

Agent-Ready should stop trying to be the file that tells an agent how to work in a
repository, and become the control plane that governs, verifies, and observes
software changes produced by autonomous agents. Humans retain root authority over
objectives. Agents receive bounded, explicit authority. Changes are certified by
verifiers that did not produce them. Outcomes are observed in production, and the
resulting causal knowledge is retained.

This RFC proposes the direction. It proposes no code, no schema field, and no CLI
surface, and it deliberately leaves most abstractions unfixed until implementation
experience forces them.

## Status of this document

[GOVERNANCE.md](../../GOVERNANCE.md) states that a broader RFC process — a
proposal open for community comment before implementation — is expected to be
required once the project has an established external user base, and that today
an ADR plus maintainer review is sufficient. That condition is not met:
[docs/adoption-and-impact.md](../adoption-and-impact.md) records no confirmed
external adopters.

This document is therefore a **design RFC**: a written position that can be
rejected or amended before any code exists. It does not activate the public RFC
process. When the public process activates, changes to the vNext surface are
governed by it, and this document becomes the historical record of the design
phase that preceded it.

Nothing here is normative for the shipped `agent-ready.yaml` contract, the JSON
Schema, the CLI, or the adapter-output compatibility corpus. Those are frozen per
[ADR-0042](../decisions/0042-v1-freeze-and-parallel-vnext-surface.md).

## Problem statement

Coding agents are being commissioned to change software in settings where nobody
is watching each individual action. The surrounding ecosystem has standardized
how agents talk to tools ([MCP](https://modelcontextprotocol.io)), how agents are
told what to do ([AGENTS.md](https://agents.md)), and how software artifacts are
attested ([SLSA](https://slsa.dev), [in-toto](https://in-toto.io)).

Three things remain unowned, and they are the same three things regardless of which
model is driving:

1. **Authority.** What was this actor allowed to do, granted by whom, for which
   objective, until when, and what happens when it exceeds that? Today the answer
   is ambient credentials, and ambient credentials are not a governance model.
2. **Certification.** Was the change actually correct, and who established that?
   A producer reporting its own success is a claim, not evidence.
3. **Outcome.** Did the deployed system actually improve? Passing tests is not the
   same claim as achieving the objective that motivated the change.

Each gap is individually addressable, but they are not independent. Authority
without certification is unrestricted automation. Certification without outcome
feedback is a ritual that cannot learn. Outcome without authority is telemetry
nobody is allowed to act on.

Agent-Ready's existing contribution is adjacent but not overlapping: it makes
repository-level claims structured, validated, and deterministically checkable. The
control plane extends the same discipline from a single repository's static claims
to a change's full life cycle, including the parts that happen after the merge.

## Design goals

- Make it possible for arbitrary agents — vendors, models, static analyzers, human
  contributors — to participate in software evolution through one authority and
  evidence model.
- Keep the deepest enforcement and evidence machinery deterministic, offline, free,
  and API-key-free.
- Make every consequential action attributable, auditable, and reversible.
- Scale assurance to risk instead of applying one fixed bar to every change.
- Produce standalone value on an arbitrary repository, without requiring anyone to
  adopt a new standard or author configuration first.

## Non-goals

- Not a coding agent, a model, or a prompt manager.
- Not a general-purpose agent RPC protocol; MCP is used, not replaced.
- Not a source-control replacement; Git remains the content and history substrate.
- Not a CI product; it consumes evidence and produces it.
- Not a hosted service in this phase.
- Not a self-improving system in this phase. Meta-evolution is a research program,
  not a roadmap commitment (see §29 of [VISION.md](../../VISION.md)).
- Not a replacement for the shipped v1 contract, which continues to release.

## Governing invariant

> **The actor proposing a change must not have unilateral authority to redefine the
> criteria that certify that change.**

This is the one commitment that makes the rest coherent. It implies a separation
between proposal authority and certification authority, it applies to Agent-Ready's
own changes, and it constrains the design of every layer below.

## Core concepts (proposed, not settled)

These names are placeholders chosen for clarity. Each is expected to change under
implementation pressure, and changing them is not a failure of the design.

| Concept                   | One-line meaning                                                                                                    | Discussion                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Software Constitution** | The machine-readable governing model: objectives, invariants, authority, approval boundaries, evidence requirements | [VISION.md §5](../../VISION.md)  |
| **System Twin**           | A queryable model of the software system, separating declared, derived, observed, and inferred facts                | [VISION.md §7](../../VISION.md)  |
| **Evolution**             | A proposed transition between system states, motivated by intent and accompanied by evidence                        | [VISION.md §10](../../VISION.md) |
| **Change Transaction**    | The execution boundary for autonomous work: base state, authority, writable scope, budgets, checkpoints             | [VISION.md §11](../../VISION.md) |
| **Capability**            | An explicit, minimal, time-bounded, revocable grant of authority to an actor                                        | [VISION.md §13](../../VISION.md) |
| **Proof Lab**             | Independent evaluation of candidates across assurance levels, from static checks to production evidence             | [VISION.md §18](../../VISION.md) |
| **Evolution Receipt**     | The proof-carrying record bound to a specific revision: intent, authority, verification, deployment, outcome        | [VISION.md §20](../../VISION.md) |
| **Evolution Ledger**      | Append-only causal history of Evolutions and their outcomes                                                         | [VISION.md §25](../../VISION.md) |
| **Evolution Memory**      | Evidence-linked validated knowledge, including failed attempts and their conditions                                 | [VISION.md §24](../../VISION.md) |

Two design rules apply to all of them:

- **A concept that cannot be made verifiable does not ship.** Anything asserted
  about a system state must be traceable to a declared source, a deterministic
  derivation, an observation, or a labeled inference. The four are never
  conflated.
- **The deterministic core stays boring.** Schema and protocol parsing, the state
  machine, capability enforcement, evidence binding, transaction isolation,
  verification dispatch, and ledger integrity do not require an LLM, per
  [ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md).

## Layered architecture

| Layer                     | Responsibility                                                     | Trust   |
| ------------------------- | ------------------------------------------------------------------ | ------- |
| Human root authority      | Ratifies objectives and constitutional rules                       | Highest |
| Software Constitution     | Intent, objectives, invariants, authority, risk, escalation        | High    |
| System Twin               | Declared, derived, observed, and inferred state                    | Medium  |
| Evolution Kernel          | Deterministic state machine, reconciliation, governance            | High    |
| Agent Fabric              | Heterogeneous actors, capability registration, assignment, handoff | Low     |
| Change Transactions       | Isolation, scoped authority, budgets, checkpoints                  | Medium  |
| Proof Lab                 | Independent verification, evidence, receipts                       | High    |
| Deployment / Observation  | Staged rollout, rollback, runtime postconditions                   | Low     |
| Evolution Memory / Ledger | Causal history and validated knowledge                             | Medium  |
| Meta-evolution            | Governed improvement of the autonomy system itself                 | Lowest  |

Two boundaries are load-bearing. **The trust strata** prevent a lower layer from
silently weakening the higher layer that certifies it
([VISION.md §29](../../VISION.md)). **The core/integration split** keeps the
deterministic kernel free of network dependencies
([ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md)).

## Alternatives considered

| Alternative                                        | Why not                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue the v1 repository-contract roadmap to 1.0 | Defensible and finishable, but improves the instruction surface while the authority/evidence gap widens. Preserved as Experiment 0.                                                                                       |
| Introduce contract `version: 2` immediately        | Encodes guesses. Discards the first experiment's evidence base before it produced findings.                                                                                                                               |
| Build an MCP server                                | MCP is a transport, not a governance model. Positioning there would be a commodity wrapper.                                                                                                                               |
| Build an agent orchestrator                        | Orchestrators decide which task gets an agent. This thesis decides under what authority work may occur and whether the resulting transition is acceptable. Directly adjacent to, and not a substitute for, task dispatch. |
| Build a policy-as-code engine                      | Policies are one input. A constitution without transactions, evidence, and observation is a linter.                                                                                                                       |
| Build a general benchmark suite                    | A generic SWE-bench clone would not test this thesis. Benchmarks are designed per research question (§63 of [VISION.md](../../VISION.md)).                                                                                |

## Phases

Each phase answers a research question and has an exit condition. A phase that
fails its question does not get a successor; it gets a reassessment. No phase
begins before the previous phase's exit condition is met.

| Phase | Question                                                                                                                       | First deliverable                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 0     | What abstraction is genuinely missing between coding agents and software systems?                                              | This RFC, [VISION.md](../../VISION.md), [LANDSCAPE.md](LANDSCAPE.md), threat model, archived roadmap — **complete** |
| 1     | Does a standardized repository model materially improve agent efficiency and correctness over raw filesystem and shell access? | `agent-ready discover` for TypeScript/Node repositories                                                             |
| 2     | Can autonomous coding work be modeled as a portable transaction independent of the agent vendor?                               | Evolution object and worktree-backed Change Transaction with a receipt                                              |
| 3     | Which independent evidence signals most reliably predict whether an agent-produced change is actually correct?                 | Proof Lab v1 with producer/verifier separation and an open dataset                                                  |
| 4     | What is the minimal machine-readable governance model required to delegate software changes safely?                            | Constitution v0, built from what real transactions turned out to need                                               |
| 5     | Can autonomous engineering operate without ambient credentials, using task-scoped delegated capabilities?                      | Identity, delegation chains, expiry, revocation, audit                                                              |
| 6     | When should work go to one strong agent versus multiple competing or specialized agents?                                       | Agent Fabric with capability declaration and handoff                                                                |
| 7     | Under what task and risk conditions does multi-agent search outperform single-agent generation enough to justify its cost?     | Verification Arena with blind evaluation and Pareto selection                                                       |
| 8     | How much does production observation change the measured correctness of agent work versus pre-merge benchmarks?                | Local/staging deployment, canary, rollback, OpenTelemetry                                                           |
| 9     | Can the observe–compare–open–prove–deploy–close loop run without per-cycle human approval on low-risk classes?                 | Continuous reconciliation, starting with dependency and documentation drift                                         |
| 10    | Does validated causal memory improve long-horizon autonomous maintenance without inducing architectural drift?                 | Evolution Memory over completed Evolutions                                                                          |
| 11    | Does the model generalize from one repository to an organization graph?                                                        | Cross-repository Twin and cross-repository Evolutions                                                               |
| 12    | Can software-autonomy infrastructure improve itself without circular self-certification?                                       | Bounded meta-evolution under externally fixed evaluation                                                            |

Constitution (phase 4) is deliberately late. Writing governance before real
transactions exist produces a governance model for imagined work.

## Standards strategy

Compositional, per [VISION.md §35](../../VISION.md) and
[LANDSCAPE.md](LANDSCAPE.md): consume AGENTS.md, MCP, SLSA/in-toto,
OpenTelemetry, and existing isolation substrates; extend only the layer they do not
cover — intent, authority, verification, and observed outcome.

Sequence: reference implementation, then real adoption, then interoperability pain,
then documented primitives, then conformance tests, then formal specification, then
neutral governance if that is justified by evidence. Declaring a standard before
that sequence runs produces documents, not a standard.

## Success criteria

Technical: change success rate, verification false-positive and false-negative
rates, authority violation rate, rollback rate, transaction reproducibility,
cross-agent portability, time from divergence to verified repair.

Research: published datasets, reproduced experiments, external usage, papers,
standards contributions.

Ecosystem: independent repositories, **independent agent implementations**,
third-party verifiers, external contributors, organizations accepting receipts, and
non-Agent-Ready implementations of the protocol. The last one matters most: a
protocol becomes real when someone implements it without using the reference
implementation.

Not a success criterion: GitHub stars, download counts, or a declaration of
standard status.

## Falsification

The thesis must be abandonable. Reassess and change direction if:

- repository Twins do not materially improve agent performance;
- Change Transactions add complexity without meaningful safety;
- independent proof poorly predicts production outcomes;
- existing standards fully absorb the proposed primitives;
- vendors converge on a superior interoperable solution;
- developers will not adopt even zero-config discovery;
- the system becomes too dependent on proprietary model behavior.

A phase that produces a negative result is a successful phase. The failure mode to
avoid is a decade of infrastructure defending an unfalsified premise.

## Security posture of this RFC

Adopting this direction increases the project's attack surface enormously, because
the system is designed to grant authority to autonomous actors. The threat classes
created by this RFC are enumerated in
[docs/security/threat-model-vnext.md](../security/threat-model-vnext.md), together
with the trusted computing boundary, the trust strata, and the explicit statement
that **none of these threats are mitigated today**, because none of the
corresponding capabilities exist yet.

The shipped v0.6.x line is unaffected by this RFC and keeps its current threat
model.

## Open questions

These are unresolved and are meant to be resolved by experiment rather than
argument:

- What is the smallest useful System Twin? Over-specification is the most likely
  failure of phase 1.
- Can verification independence be achieved cheaply enough to be the default rather
  than an opt-in?
- What is the right atomic unit of machine software work — commit, transaction,
  or Evolution?
- Which Phase 1 discovery signals actually predict agent performance, and which are
  noise?
- Should agent identity bind to a standards-compatible scheme, or is a
  task-scoped capability identifier sufficient to start?
- What assurance level should be the default for a change nobody has classified?
