# Vision: Agent-Ready as infrastructure for autonomous software evolution

> **Status: design thesis. Not a specification. Not implemented.**
>
> This document is the argument for where Agent-Ready is going. No code in this
> repository implements anything described here. The shipped, installable,
> supported product remains the v0.6.x repository-contract CLI described in
> [README.md](README.md) and
> [docs/project-standing.md](docs/project-standing.md).
>
> Nothing in this document is normative for the `agent-ready.yaml` contract, the
> JSON Schema, the CLI, or the adapter-output compatibility corpus. Where this
> document and the shipped specification disagree, the specification wins and this
> document is simply wrong or premature.
>
> - Authored: 2026-09-25
> - Direction selected by
>   [ADR-0041](docs/decisions/0041-vnext-autonomous-software-evolution.md)
> - Formalized as
>   [RFC-0001](docs/vnext/RFC-0001-autonomous-software-evolution.md)
> - Positioned against adjacent standards in
>   [LANDSCAPE.md](docs/vnext/LANDSCAPE.md)
> - Threats this thesis creates, none of them mitigated today, in
>   [threat-model-vnext.md](docs/security/threat-model-vnext.md)
> - Superseded planning history in
>   [docs/archive/roadmap-v1.md](docs/archive/roadmap-v1.md)

## How to read this

The thesis is preserved below as written, including its section numbers, because
the argument is the asset and rewriting it would hide which claims are load-bearing
and which were illustrative. Section numbers are cited elsewhere in the repository
as `VISION.md §n`.

Three things are deliberately unsettled and marked as such in the text: the
adoption class arithmetic in §13 (worked example, not a schema), the assurance
levels in §18 (a proposed taxonomy, not a standard), and the autonomy profiles in
§30 (illustrative, explicitly "not final").

---

# Agent-Ready

## Open Infrastructure for Constitutionally Governed, Continuously Self-Evolving Software

**Status:** Master direction / vNext design thesis
**Starting point:** Agent-Ready v0.6.1
**Long-term category:** Autonomous software infrastructure / software evolution systems / agentic software engineering
**Core philosophy:** Human-governed. Machine-operated. Independently verified. Continuously evolving.

---

## 1. Executive thesis

Agent-Ready began as a vendor-neutral repository contract for coding agents.

The original system allowed a repository to define commands, environment requirements, protected paths, architecture constraints, agent instructions, verification requirements, and completion evidence in a schema-validated `agent-ready.yaml`. A deterministic TypeScript CLI then validated that contract, generated agent-specific instructions, checked repository state, executed verification, and recorded evidence. The current implementation is v0.6.1 and already includes eleven CLI commands, structured diagnostics, filesystem/Git/process abstractions, cross-platform testing, verification evidence, and substantial security engineering.

That original abstraction is now too small.

The agent ecosystem has moved toward open standards for instructions, tools, agent communication, identity, authorization, and provenance. AGENTS.md and MCP are now housed under the Linux Foundation's Agentic AI Foundation, which has rapidly expanded around interoperable agent infrastructure. MCP itself is expanding into long-running tasks, enterprise authorization, agent identity, and scalable agent communication.

Agent-Ready therefore should no longer attempt to become the universal file describing how agents work.

It should move one level deeper.

### New thesis

> **Agent-Ready is an open, vendor-neutral control plane for autonomous software evolution.**

Its purpose is to make it possible for software systems to:

1. understand their own structure and operational state;
2. represent human-defined intent and constraints;
3. detect divergence between desired and observed state;
4. commission heterogeneous autonomous agents to investigate and propose changes;
5. constrain those agents through explicit identity, authority, budgets, and capabilities;
6. evaluate competing candidate changes independently of the agents that produced them;
7. deploy accepted changes through staged and reversible mechanisms;
8. observe whether the real system actually improved;
9. retain validated causal knowledge from the outcome;
10. continuously repeat the process;
11. eventually improve parts of the autonomy machinery itself without allowing it to redefine its own governing objectives.

The long-term objective is not merely autonomous coding.

It is:

> **Software that can understand, maintain, repair, optimize, and evolve itself while remaining subordinate to human-defined authority and independently verifiable evidence.**

---

## 2. The category Agent-Ready should create

Agent-Ready should not be positioned primarily as:

- an AI coding assistant;
- an agent orchestrator;
- a prompt manager;
- a repository instruction generator;
- a policy-as-code engine;
- a CI wrapper;
- an agent benchmark;
- an MCP server;
- a source-control replacement;
- an autonomous DevOps product.

Those can all become components or integrations.

The larger category is:

### Autonomous Software Evolution Infrastructure

The system sits between:

```text
Human / organizational intent
            │
            ▼
     Agent-Ready control plane
            │
   ┌────────┼─────────┐
   ▼        ▼         ▼
Claude    Codex     future systems
   │        │         │
   └────────┼─────────┘
            ▼
     candidate changes
            │
            ▼
 independent verification
            │
            ▼
      safe deployment
            │
            ▼
    production reality
            │
            ▼
       learning loop
```

The best conceptual analogy is not "another coding tool."

It is closer to:

> **Kubernetes-style reconciliation for software evolution.**

Kubernetes continuously attempts to reconcile infrastructure with a declared desired state.

Agent-Ready would attempt to reconcile a software system with human-defined desired state.

The critical difference is that software evolution involves reasoning, uncertainty, competing possible implementations, human authority, production outcomes, and epistemic questions about what constitutes evidence.

That is the research and engineering frontier.

---

## 3. The governing principle

Everything in Agent-Ready should follow one invariant:

> **The actor proposing a change must not have unilateral authority to redefine the criteria that certify that change.**

An agent may:

- propose code;
- propose tests;
- propose architecture;
- propose new verification techniques;
- propose changed objectives;
- propose changes to Agent-Ready itself.

But the producer cannot silently alter its own acceptance conditions and then declare itself successful.

This creates a separation between:

```text
PROPOSAL AUTHORITY
and
CERTIFICATION AUTHORITY
```

That separation is the foundation for trustworthy autonomous software evolution.

---

## 4. Human root authority

Agent-Ready is not designed around "AI autonomy at all costs."

The target architecture is:

```text
Human root authority
        │
        ▼
Software Constitution
        │
        ▼
Evolution Kernel
        │
        ▼
Agent delegation
        │
        ▼
Autonomous execution
```

Humans define or ratify the highest-order rules.

Agents operate under delegated authority.

The more consequential the change, the stronger the required evidence and/or human approval.

The system may eventually become extremely autonomous operationally while remaining constitutionally subordinate to humans.

---

## 5. The Software Constitution

The first new foundational abstraction is the **Software Constitution**.

Today the intended nature of a software system is fragmented across:

- requirements;
- code;
- README files;
- architecture documents;
- ADRs;
- tests;
- tickets;
- SLOs;
- security policies;
- CI;
- permissions;
- deployment procedures;
- operational runbooks;
- tribal knowledge.

Agent-Ready should construct a machine-readable governing model above those sources.

The Constitution describes what the system is allowed to become.

Conceptually it contains:

```text
Purpose

Objectives

Invariants

Architectural constraints

Security constraints

Reliability expectations

Performance expectations

Cost constraints

Compatibility requirements

Data-governance constraints

Human approval boundaries

Agent delegation rules

Evidence requirements

Escalation rules

Rules for modifying the Constitution itself
```

It should not require that humans duplicate everything into one giant YAML file.

Some constitutional facts can be authored directly.

Others should be compiled or referenced from existing authoritative sources.

Examples:

```text
CODEOWNERS
OpenAPI
package.json
pyproject.toml
Terraform
Kubernetes manifests
SLO definitions
CI workflows
security policy
ADR documents
test suites
database migrations
runtime configuration
```

Agent-Ready becomes a compiler of software governance and intent rather than a second source of truth for everything.

---

## 6. Desired Software State

The Constitution enables a second concept:

### Desired Software State

A software system should be able to express statements like:

```text
Payments API availability ≥ 99.99%

p95 latency < 120 ms

No critical known vulnerabilities

Public API remains backwards compatible

No service outside the payments boundary accesses card data

Monthly infrastructure cost < defined ceiling

All production mutations remain attributable

Database-destructive changes require human approval
```

Some desired-state properties will be directly machine-verifiable.

Others will be partially observable.

Others may remain human judgment.

Agent-Ready should represent that distinction explicitly instead of pretending all software requirements can be reduced to automated checks.

---

## 7. Observed Software State

Desired state means nothing without observed state.

Agent-Ready therefore needs a continuously maintained model of reality.

That becomes the:

### System Twin

The System Twin is a structured, queryable representation of the software system.

It may eventually include:

```text
source repositories
packages
files
symbols
APIs
dependency graphs
database schemas
tests
build systems
CI workflows
deployment environments
cloud infrastructure
runtime services
ownership
security boundaries
vulnerabilities
historical incidents
deployments
logs
traces
metrics
SLOs
costs
user-facing behaviors
past Evolutions
```

The Twin should distinguish:

```text
DECLARED FACTS
facts explicitly defined by configuration or specifications

DERIVED FACTS
facts inferred deterministically from repositories and infrastructure

OBSERVED FACTS
facts learned from runtime telemetry

INFERRED FACTS
probabilistic interpretations produced by agents or analysis
```

These must never be silently conflated.

---

## 8. The System Twin is not "LLM memory"

This distinction is important.

The Twin should not be primarily a vector store full of conversational history.

It should be an evidence-linked graph.

For example:

```text
BillingService.calculateInvoice
    │
    ├── public API
    │
    ├── owned by Payments
    │
    ├── called by 7 observed runtime paths
    │
    ├── covered by 42 tests
    │
    ├── involved in incident INC-218
    │
    ├── constrained by PCI boundary B-3
    │
    └── last modified in Evolution EV-881
```

This gives agents structured software self-knowledge.

Repository-scale reasoning continues to be a major challenge for coding agents, making a strong machine-readable environment potentially valuable independently of model improvements.

---

## 9. The Evolution Kernel

The trusted heart of Agent-Ready becomes the:

### Evolution Kernel

The kernel is a deterministic state machine that governs changes.

It is responsible for:

```text
opening an Evolution
establishing immutable base state
assigning identities
delegating capabilities
enforcing authority boundaries
creating isolated transactions
tracking candidate solutions
invoking verification
collecting evidence
requiring approvals
coordinating deployment
observing postconditions
committing or rolling back
recording the final result
```

The Kernel itself should remain intentionally boring.

It should not require an LLM.

This preserves one of the strongest properties of current Agent-Ready: its deterministic core operates without model calls, API keys, telemetry, or mandatory network access.

AI may surround the kernel.

AI should not become the kernel.

---

## 10. The Evolution

The central unit of autonomous engineering becomes the:

### Evolution

An Evolution represents:

> **A proposed transition from one software-system state to another, motivated by intent and accompanied by evidence.**

This is deliberately richer than:

```text
Git commit
pull request
ticket
coding session
```

An Evolution may contain:

```text
ID

Trigger

Intent

Desired postconditions

Base system state

Constitution revision

Participants

Delegated authorities

Budgets

Investigations

Hypotheses

Candidate implementations

Verification results

Exceptions

Human approvals

Deployment stages

Observed outcomes

Rollback information

Learned facts

Final status
```

Possible statuses:

```text
proposed
investigating
implementing
verifying
awaiting-approval
deploying
observing
accepted
rejected
rolled-back
superseded
partially-satisfied
failed
```

---

## 11. Change Transactions

An Evolution may contain one or more:

### Change Transactions

A Change Transaction is the execution boundary for autonomous engineering work.

Every transaction has:

```text
immutable base state

agent identity

delegated authority

writable scope

tool capabilities

network capabilities

secret capabilities

time budget

compute budget

financial budget

verification profile

workspace

checkpoints

resulting candidate
```

The transaction should ideally run in an isolated worktree, container, VM, sandbox, or future execution environment.

Agents should not inherit ambient developer authority by default.

---

## 12. Identity and delegation

The existing software ecosystem typically authenticates the human or process holding credentials.

Agentic software requires something richer:

```text
Who is this agent?

Who delegated authority?

For what objective?

For how long?

Against which system?

With what capabilities?

What may it delegate further?

What actions require escalation?
```

NIST is actively exploring identification, authorization, auditing, and non-repudiation for software and AI agents, confirming that these are emerging infrastructure problems rather than merely implementation details.

Agent-Ready should therefore avoid inventing a closed proprietary identity scheme.

Instead, it should provide an experimentation and integration layer for standards-compatible identities and capabilities.

---

## 13. Capability-based autonomy

Agents should receive explicit capabilities.

For example:

```text
Principal:
agent://provider/model/session

Evolution:
EV-8291

May:
read repository
modify packages/payments/**
run sandboxed tests
query staging telemetry

May not:
modify CI
read production secrets
change constitutional policy
merge its own work

Conditional:
dependency changes require approval

Expires:
timestamp

Budget:
compute / tokens / money / duration
```

Authority should be:

```text
explicit
minimal
time-bounded
auditable
revocable
delegatable only when permitted
```

---

## 14. Agent Fabric

Agent-Ready must not become dependent on one model vendor.

The system treats all actors as capability providers.

```text
Claude
Codex
Gemini
Copilot
Cursor agents
local models
future agents

humans

static analyzers
fuzzers
SAT/SMT solvers
linters
compilers
benchmark harnesses
security scanners
formal verifiers
```

All participate through the:

### Agent Fabric

The Fabric handles:

```text
capability registration
identity
work assignment
budgets
communication
handoff
results
historical performance
```

Agent-Ready should use existing interoperability standards where appropriate rather than reinventing generic agent/tool communication.

MCP has already evolved far beyond its initial local-tool use case and now supports tasks, stronger authorization, extensions, and a roadmap including agent identity and production-scale agent communication.

Therefore:

> **MCP should be a transport/integration layer for Agent-Ready, not something Agent-Ready competes with.**

---

## 15. Agent negotiation

When an agent enters a system, Agent-Ready should eventually support capability negotiation.

Example:

```text
AGENT

I support:
TypeScript
PostgreSQL
browser automation
performance analysis

I request:
repository read
payments write
staging DB
test execution

SYSTEM

Identity verified.

Granted:
repository read
payments/**
sandbox execution
staging DB

Denied:
production credentials
CI modification

Conditional:
schema migration requires human approval

Evolution:
EV-1032

Transaction:
TX-1032-B
```

This is much cleaner than encoding authority in prose instructions.

---

## 16. Work orchestration

Agent-Ready should not merely start one agent.

It should be capable of assigning work strategically.

Current systems are already moving from interactive sessions toward continuous orchestration. OpenAI's Symphony, for example, treats an issue tracker as a control plane that dispatches isolated coding-agent work and reconciles task state.

Agent-Ready should operate at a different layer.

Symphony-style systems decide:

> Which task should receive an agent?

Agent-Ready should decide:

> Under what authority can work occur, what evidence is required, and whether the resulting system transition is acceptable?

---

## 17. Competitive implementation

Cheap autonomous labor changes software economics.

For important changes, Agent-Ready should be able to request multiple independent candidate implementations.

```text
Intent
  │
  ├── Candidate A — Claude
  ├── Candidate B — Codex
  ├── Candidate C — specialist model
  └── Candidate D — human
            │
            ▼
      Verification Arena
```

Candidate selection can consider a Pareto frontier across:

```text
correctness
security
performance
maintainability
complexity
cost
energy
blast radius
compatibility
```

This changes software engineering from:

> accept the first workable implementation

toward:

> search a space of implementations and prove which candidates satisfy the objective best.

---

## 18. Proof Laboratory

Agent-Ready should eventually contain an extensible:

### Proof Lab

A Proof Lab evaluates candidate changes independently of their producer.

Assurance levels may include:

#### Level 1 — Static baseline

```text
format
lint
type checking
unit tests
build
```

#### Level 2 — Integration

```text
integration tests
API compatibility
migration checks
dependency checks
```

#### Level 3 — Robustness

```text
fuzzing
property testing
mutation testing
stress testing
```

#### Level 4 — Security / architecture

```text
security scanning
architecture rules
sensitive-boundary analysis
adversarial agents
```

#### Level 5 — Simulation

```text
traffic replay
synthetic users
shadow services
database clones
fault injection
```

#### Level 6 — Deployment evidence

```text
preview environment
canary
progressive rollout
runtime postconditions
```

#### Level 7 — Long-horizon validation

```text
error-budget effects
cost effects
incident rates
user outcomes
performance drift
```

Verification strength should scale with risk.

---

## 19. Verification independence

Each proof should record:

```text
producer

verifier

inputs

environment

method

result

confidence / authority class

timestamp

artifact hashes
```

The system must distinguish:

```text
self-verification

independent machine verification

independent agent review

human review

production observation
```

They do not carry equal epistemic weight.

---

## 20. Proof-carrying software changes

Every material software revision could eventually carry an **Evolution Receipt**.

Example:

```text
Revision:
sha256:...

Evolution:
EV-3921

Intent:
Reduce checkout p95 latency below 120ms

Producer:
agent://...

Delegation:
capability://...

Constitution:
revision 48

Verification:
unit ✓
integration ✓
security ✓
performance ✓

Deployment:
5% ✓
25% ✓
100% ✓

Observed postcondition:
p95 = 104ms

Approvals:
payments owner ✓

Provenance:
signed
```

This should interoperate with supply-chain standards.

SLSA 1.2 already separates build provenance from source provenance and includes source-change-management and actor-attribution concepts.

Agent-Ready should not duplicate SLSA.

It should explore the layer above it:

> **intent + authority + verification + observed outcome.**

---

## 21. Deployment Plane

Agent-Ready must eventually extend beyond pre-merge verification.

A change cannot truly be called successful merely because tests passed.

The Deployment Plane coordinates:

```text
preview environments

shadow execution

canary deployment

progressive rollout

feature flags

automatic rollback

post-deployment monitoring
```

An Evolution remains open until relevant postconditions are evaluated.

---

## 22. Observation Plane

The Observation Plane answers:

> What actually happened?

Sources might include:

```text
OpenTelemetry

metrics

logs

traces

alerts

incidents

user behavior

error budgets

cost telemetry

security events
```

Observed state feeds the System Twin.

It must remain distinguishable from inferred interpretation.

---

## 23. Reconciliation

Once desired and observed state exist, Agent-Ready can introduce:

### Continuous Reconciliation

Example:

```text
Desired:
checkout p95 < 120ms

Observed:
checkout p95 = 212ms

Divergence:
92ms

Action:
open Evolution EV-9021
```

This may trigger:

```text
investigation
candidate generation
verification
deployment
observation
```

Eventually the same pattern can apply to:

```text
security vulnerabilities

dependency aging

reliability

performance

cost

architecture drift

test quality

documentation drift

accessibility

technical debt
```

---

## 24. Evolution Memory

Agent memory should not primarily consist of old chat transcripts.

Agent-Ready needs:

### Evolution Memory

Memory contains validated facts learned from Evolutions.

Example:

```text
Finding:
Query-plan strategy Q2 reduces checkout latency under workload W.

Evidence:
Evolution EV-2011

Observed:
-38% p95

Limitations:
PostgreSQL 18
dataset family DS-4

Confidence:
high
```

A failed Evolution is useful too.

```text
Attempt:
cache layer C

Outcome:
rolled back

Reason:
memory use +72%

Relevant future condition:
avoid under container memory < 2GB
```

Future agents inherit evidence-linked organizational knowledge.

---

## 25. Evolution Ledger

The system should retain an append-only logical history of Evolutions.

Git tells us:

```text
what code existed
```

The Evolution Ledger should tell us:

```text
why it changed

what objective was pursued

who or what changed it

what authority they possessed

what alternatives were attempted

what evidence existed

what deployment occurred

what reality said afterward
```

This creates a causal software history.

---

## 26. The Software Evolution Graph

Over time, the Ledger and Twin produce a graph:

```text
requirement
   │
incident ───► Evolution ◄── vulnerability
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
 candidate   candidate   candidate
       │         │         │
       └─────────┼─────────┘
                 ▼
             verification
                 │
                 ▼
             deployment
                 │
                 ▼
             observation
                 │
                 ▼
              outcome
                 │
                 ▼
            learned fact
                 │
                 ▼
          future Evolution
```

This may become one of Agent-Ready's most valuable long-term assets.

---

## 27. Counterfactual software engineering

The system should evolve toward asking:

> **What is likely to happen if we make this change?**

Counterfactual evaluation can progress through stages.

Initially:

```text
dependency analysis
tests
benchmarks
```

Then:

```text
traffic replay
synthetic workloads
database clones
fault injection
```

Eventually:

```text
candidate A → simulated world A
candidate B → simulated world B
candidate C → simulated world C
```

Deployment becomes an empirical experiment testing those predictions.

This turns software maintenance into a scientific loop:

```text
observe
hypothesize
experiment
measure
intervene
observe
```

---

## 28. Software as an experimental science

Agent-Ready should eventually allow autonomous agents to propose hypotheses rather than only implement tickets.

Example:

```text
Observation:
timeout rate rises when connection pool utilization exceeds 88%

Hypothesis:
pool starvation causes incident pattern

Experiment:
increase pool size in isolated staging replica

Measurement:
timeouts fall 72%

Candidate Evolution:
adjust production pool configuration

Verification:
performance / cost / failure-mode profile

Canary:
pass
```

The system can learn from controlled experimentation.

---

## 29. Safe recursive improvement

Eventually agents will improve:

```text
prompts
skills
planners
memory systems
task decomposition
verification systems
agent selection
sandboxes
Agent-Ready itself
```

This introduces a circular trust problem.

Agent-Ready should therefore define trust strata:

```text
Application software
        │
Application verifiers
        │
Evolution Kernel
        │
Kernel verifiers
        │
Software Constitution
        │
Human root authority
```

A lower layer must not be able to silently weaken the higher layer that certifies it.

Meta-evolution should require stronger evidence than ordinary application evolution.

---

## 30. Autonomy profiles

Agent-Ready should eventually define operational autonomy classes.

Illustrative—not final:

```text
AR-0
Human-controlled development

AR-1
AI recommendation only

AR-2
Agent executes bounded tasks
human approves all changes

AR-3
Agent independently produces candidate changes
human authorizes deployment

AR-4
Continuous autonomous maintenance
under fixed constitutional boundaries

AR-5
Continuous autonomous evolution
including bounded meta-improvement
```

These should not be marketing scores.

They should represent concrete capability, authority, verification, and oversight properties.

---

## 31. Organization-scale operation

The project should not remain repository-bound forever.

A real organization has:

```text
many repositories
shared libraries
services
databases
infrastructure
identity
deployment systems
observability
business objectives
```

Long-term architecture:

```text
             Organization Constitution
                       │
                       ▼
              Agent-Ready Control Plane
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   Service A        Service B       Library C
       │               │               │
       └──────── organizational graph ─┘
                       │
                       ▼
                 infrastructure
                       │
                       ▼
                    reality
```

Cross-repository Evolutions become possible.

---

## 32. Federation

Eventually organizations and open-source projects need to trust artifacts and autonomous contributions from outside their own infrastructure.

Agent-Ready should therefore anticipate federation.

Example:

```text
Project A publishes:

revision
source provenance
Evolution receipt
verification
authority chain

Project B consumes:

revision
+ evidence
+ provenance
```

Consumers can independently decide which evidence they trust.

Agent-Ready does not become a global certificate authority.

It provides interoperable evidence structures.

---

## 33. Open-source autonomous contribution

Long-term, public projects could publish explicit machine contribution policies.

Example:

```text
Autonomous contributors may:
fix documentation
add tests
repair isolated defects

Human sponsor required:
public API modification

Domain maintainer required:
scheduler changes

Evidence required:
cross-platform CI
regression reproduction
compatibility report

Autonomous submissions must include:
Evolution receipt
```

That could become an open protocol for machine contribution to open-source software.

---

## 34. Research Commons

Opt-in Agent-Ready installations could eventually contribute privacy-preserving aggregate research data.

Possible questions:

```text
Which verification methods catch which agent failures?

How predictive is pre-merge verification of production success?

When does multi-agent competition outperform one strong model?

How much autonomy is safe under different assurance profiles?

Which repository structures create the most agent failures?

How often do agents correctly abstain?

What forms of persistent knowledge improve long-term architecture preservation?

Which models excel at which engineering domains?

How does autonomous maintenance affect technical debt over years?
```

The project could become both infrastructure and a research platform.

---

## 35. Standards position

Agent-Ready should be standards-compositional.

It should explicitly avoid rebuilding mature adjacent standards.

### AGENTS.md

Use for human-readable repository guidance where useful.

Do not make instruction-file generation the core product.

AGENTS.md now has neutral open-source governance under AAIF alongside MCP.

### MCP

Use for agent/tool/context interoperability and potentially parts of capability negotiation.

Do not invent a generic competing agent RPC protocol.

### SLSA / in-toto

Use for software provenance and attestations.

Extend semantically where Agent-Ready needs intent, authority, verification, and outcome records.

### OpenTelemetry

Use for runtime observation where possible.

Do not create a proprietary telemetry universe.

### OCI / containers / VMs / sandboxes

Use existing isolation substrates.

### Git

Remain the content/history substrate.

Do not replace Git initially.

Agent-Ready adds semantic evolution above it.

---

## 36. Specification family

Do not create all of these immediately.

But the architecture can anticipate a future specification family:

```text
AR-CONSTITUTION
software intent, invariants, governance

AR-TWIN
software system-state representation

AR-EVOLUTION
Evolution lifecycle

AR-TX
transactional autonomous work

AR-IDENTITY
actor / agent identity bindings

AR-CAP
delegated capability semantics

AR-PROOF
verification evidence

AR-OBSERVE
post-deployment outcome semantics

AR-LEDGER
Evolution history

AR-HANDOFF
cross-agent resumability

AR-CONFORMANCE
implementation compatibility
```

The first public specification should remain as small as possible.

Standards should emerge from implementation experience.

---

## 37. Reference implementation

Agent-Ready should remain an implementation, not merely become a specification repository.

A future workspace could eventually contain:

```text
packages/

  kernel/
  constitution/
  twin/
  evolution/
  transactions/
  policy/
  proof/
  identity/
  ledger/
  adapters/
  mcp/
  git/
  telemetry/
  conformance/

apps/

  cli/
  daemon/
  github-app/
  dashboard/

spec/

  evolution/
  proof/
  constitution/

research/

  experiments/
  benchmarks/
  datasets/
```

This is directional only.

Do not perform a giant monorepo rewrite immediately.

---

## 38. Future CLI

The CLI could evolve toward something like:

```text
agent-ready init

agent-ready discover

agent-ready twin build

agent-ready twin query

agent-ready constitution validate

agent-ready evolution open

agent-ready evolution inspect

agent-ready tx begin

agent-ready tx checkpoint

agent-ready verify

agent-ready prove

agent-ready observe

agent-ready evolution close

agent-ready ledger

agent-ready conformance repo

agent-ready conformance agent

agent-ready serve
```

Legacy commands can remain temporarily under compatibility aliases.

---

## 39. The Agent-Ready daemon

Eventually:

```bash
agent-ready serve
```

starts a local runtime exposing controlled repository/system capabilities.

Possible interfaces:

```text
local IPC
MCP
HTTP
CI integrations
GitHub App
future standards
```

The daemon maintains:

```text
current Twin

open Evolutions

transaction state

capability grants

proof state

local ledger

observation subscriptions
```

---

## 40. Minimal configuration philosophy

`agent-ready.yaml` should shrink.

It should contain only information that cannot safely be discovered or derived.

Illustrative:

```yaml
version: 2

constitution:
  protect:
    - .github/workflows/**
    - infrastructure/prod/**

authority:
  dependency_changes: approval
  production_access: deny
  ci_changes: approval

verification:
  default:
    - test
    - typecheck

  profiles:
    public_api:
      - test
      - integration
      - api_compatibility

autonomy:
  max_parallel_transactions: 4
```

Everything possible should come from existing authoritative systems.

---

## 41. Relationship to Agent-Ready v0.6.1

The existing implementation should be viewed as:

### Experiment 0

It already contains valuable kernel components:

- deterministic parsing;
- JSON Schema validation;
- semantic validation;
- normalization;
- diagnostics;
- filesystem abstraction;
- Git abstraction;
- command execution;
- environment checks;
- path validation;
- verification execution;
- machine-readable evidence;
- CI integration.

The architecture deliberately separates side effects behind `FileSystem`, Git, binary, and process interfaces, and adapter rendering is already designed deterministically.

Its verification/evidence work already connects repository contracts to executed checks and recorded proof.

These concepts should survive.

---

## 42. What to retain

Retain and generalize:

```text
diagnostic framework

filesystem abstraction

Git abstraction

command runner

contract loading infrastructure

safe YAML parsing

schema/version handling

process isolation work

verification execution

evidence model

security threat-model culture

cross-platform CI

package/release provenance

JSON output discipline
```

---

## 43. What to demote

Demote to compatibility features:

```text
AGENTS.md generation

CLAUDE.md generation

Gemini generation

Copilot instruction generation

Cursor-specific instruction generation
```

These are no longer the center of the project.

---

## 44. What to archive

Archive the current roadmap as historical documentation.

The existing roadmap still centers v0.7 around architecture-dependency analysis, v0.8 around runtime probing/custom adapters, v0.9 around stabilization, and v1.0 around adoption criteria; the current project summary already notes that parts of that roadmap are stale relative to the implementation.

Suggested:

```text
docs/archive/roadmap-v1.md
```

Do not pretend those milestones remain authoritative.

---

## 45. What not to delete

Do not erase project history.

The story is valuable:

```text
v0.x
repository contract experiment

↓

agent ecosystem standardizes instruction surfaces

↓

Agent-Ready discovers the deeper problem

↓

vNext
autonomous software evolution infrastructure
```

The pivot becomes part of the project's intellectual history.

---

## 46. Adoption reality

The project should remain candid about adoption.

Its implementation maturity currently exceeds its ecosystem usage; its own adoption evidence reports no confirmed independent adopters in the relevant snapshot.

That means vNext must be designed around **immediate standalone utility**, not around developers first agreeing to adopt a new standard.

The first command should create useful information on an arbitrary repository.

---

## 47. The initial wedge

The moonshot is huge.

The first wedge must be narrow.

### First useful product

```bash
agent-ready discover
```

On an arbitrary repository it should automatically construct a machine-readable repository model:

```text
languages
package managers
commands
tests
entry points
packages
modules
dependency edges
public APIs
CI workflows
ownership
sensitive paths
generated paths
agent surfaces
deployment hints
```

Then:

```bash
agent-ready evolution run <task>
```

could create an isolated change transaction and produce a verifiable receipt.

That gives developers value before they author a Constitution.

---

## 48. Roadmap philosophy

Do not roadmap by speculative feature count.

Each phase should answer a research question.

Progress only when the abstraction survives real use.

---

## 49. Phase 0 — Re-foundation

### Duration

Immediate.

### Objective

Publicly establish that Agent-Ready is entering a vNext design phase while preserving v0.6.1.

### Deliverables

```text
VISION.md
vNext RFC
old roadmap archived
landscape analysis
formal problem statement
threat-model update
architecture principles
```

### Core research question

> What abstraction is genuinely missing between coding agents and software systems?

### Exit condition

The project can explain what it owns that MCP, AGENTS.md, SLSA, agent orchestrators, and coding-agent vendors do not.

---

## 50. Phase 1 — Repository Intelligence Kernel

### Scope

TypeScript/Node repositories only.

### Build

```text
automatic repository discovery

repository graph

command discovery

test discovery

ownership discovery

API discovery

CI discovery

machine-readable repository snapshot
```

### CLI

```text
agent-ready discover
agent-ready twin build
agent-ready twin query
```

### Research question

> Does a standardized repository model materially improve agent efficiency, correctness, and consistency compared with raw filesystem/shell access?

### Evaluation

Same coding tasks:

```text
raw repository tools

vs.

Agent-Ready Twin
```

Measure:

```text
success
tokens
steps
files opened
invalid edits
verification choices
time
```

---

## 51. Phase 2 — Evolution + Transaction Runtime

### Build

```text
Evolution object

Change Transaction

immutable base commit

worktree/container isolation

writable scopes

budgets

checkpoints

rollback

transaction receipt
```

### CLI

```text
agent-ready evolution open
agent-ready tx begin
agent-ready tx inspect
agent-ready tx close
```

### Research question

> Can autonomous coding work be modeled as a portable transaction independent of the agent vendor?

### Initial agents

At least:

```text
Claude Code
Codex
```

Possibly one open/local agent for neutrality.

---

## 52. Phase 3 — Independent Proof

### Build

Generalize the existing verification engine into Proof Lab v1.

```text
verification profiles

producer/verifier separation

structured evidence

hash-bound outputs

proof receipts

CI verifier
```

### Research question

> Which independent evidence signals most reliably predict whether an agent-produced software change is actually correct?

### Deliverable

Open dataset of:

```text
task
agent candidate
self-reported status
independent verification
human judgment
```

---

## 53. Phase 4 — Constitution v0

Do not build Constitution first.

Build it after real transactions reveal what needs governing.

### Add

```text
authority boundaries

approval requirements

protected objectives

risk classes

required proof profiles

escalation
```

### Research question

> What is the minimal machine-readable governance model required to safely delegate software changes to autonomous agents?

---

## 54. Phase 5 — Identity and capabilities

### Add

```text
agent identity

delegation chains

capability grants

expiry

revocation

audit records

human sponsor identity
```

Align with emerging standards rather than inventing isolation.

### Research question

> Can autonomous engineering operate without ambient credentials by using task-scoped delegated capabilities?

---

## 55. Phase 6 — Agent Fabric

### Build

```text
agent adapter interface

capability declaration

agent selection

cross-agent handoff

parallel candidates

resource accounting
```

### Research question

> When should work be delegated to one strong agent versus multiple competing or specialized agents?

---

## 56. Phase 7 — Verification Arena

Add candidate competition.

```text
N candidate generation

blind independent evaluation

performance comparison

security evaluation

complexity comparison

Pareto selection
```

### Research question

> Under what task/risk conditions does multi-agent search outperform single-agent generation enough to justify its cost?

---

## 57. Phase 8 — Deployment + Observation

First support local/staging environments.

Later cloud integrations.

### Build

```text
preview environment integration

canary hooks

rollback

OpenTelemetry integration

postcondition evaluation
```

### Research question

> How much does production observation change the measured correctness of coding-agent work compared with pre-merge benchmarks?

---

## 58. Phase 9 — Continuous reconciliation

The first truly autonomous mode.

### System loop

```text
observe
compare
detect divergence
open Evolution
investigate
propose
prove
deploy
observe
close
```

Start with low-risk cases:

```text
dependency updates

simple regressions

performance regressions

documentation drift
```

Do not begin with open-ended product development.

---

## 59. Phase 10 — Evolution Memory

Build evidence-grounded project memory.

```text
successful strategies

failed strategies

incident causality

architectural constraints

verification effectiveness

agent capabilities
```

### Research question

> Does validated causal memory improve long-horizon autonomous maintenance without inducing architectural drift?

---

## 60. Phase 11 — Organization-scale Twin

Expand beyond one repository.

Model:

```text
repositories
services
libraries
deployments
databases
infrastructure
owners
dependencies
```

Cross-repository Evolutions become possible.

---

## 61. Phase 12 — Meta-Evolution

Only after every lower layer is mature.

Permit agents to propose modifications to:

```text
agent selection

verification profiles

memory retrieval

transaction planning

Agent-Ready components
```

Require higher-order proof and approval.

### Research question

> Can software-autonomy infrastructure improve itself without creating circular self-certification?

This may become the deepest long-term research program.

---

## 62. Research agenda

Agent-Ready should explicitly become a research-driven open-source project.

Major research domains:

### Repository representation

What information should a software system expose to autonomous engineers?

### Autonomous change semantics

What is the correct atomic unit of machine software work?

### Evidence

What constitutes sufficient proof for different classes of software change?

### Identity and delegation

How should autonomous engineers receive authority?

### Multi-agent engineering

When do competition, collaboration, or specialization help?

### Production validation

How should runtime reality feed back into code-generation systems?

### Long-term memory

What knowledge can safely persist across agent generations?

### Autonomy

Which tasks can safely progress without human intervention?

### Recursive improvement

How can autonomy infrastructure improve itself without weakening its governing constraints?

### Human governance

What objectives must remain fundamentally human-authorized?

---

## 63. Benchmark strategy

Do not create another generic SWE-bench clone.

Create experiments native to the Agent-Ready thesis.

Examples:

### Repository understanding benchmark

Same agent with and without Twin.

### Authority benchmark

Measure violations under progressively constrained capability models.

### Verification benchmark

Measure whether different verifier portfolios catch known agent defects.

### Handoff benchmark

Agent A begins; Agent B resumes from structured transaction state.

### Long-running maintenance benchmark

Maintain a repository autonomously across weeks/months of incoming changes.

### Production prediction benchmark

Compare pre-deployment confidence with actual post-deployment outcomes.

### Meta-evolution benchmark

Allow the system to improve a limited part of its own harness under externally fixed evaluation.

---

## 64. Conformance program

Eventually there should be two conformance categories.

### Repository conformance

```text
Can this repository expose Agent-Ready semantics correctly?
```

### Agent conformance

```text
Can this agent correctly operate inside an Agent-Ready environment?
```

Possible commands:

```text
agent-ready conformance repo

agent-ready conformance agent
```

This is more useful than an arbitrary readiness score.

---

## 65. Threat model

The threat model becomes much larger.

Major threats include:

```text
agent modifies its verifier

agent modifies governing policy

agent obtains excess credentials

agent falsifies evidence

agent exploits test gaps

agent colludes with verifier

agent causes hidden production regressions

agent optimizes metric while harming actual intent

agent poisons persistent memory

agent modifies observations

agent exceeds resource budget

agent delegates beyond authority

agent creates irreproducible state

agent introduces supply-chain compromise
```

Agent-Ready must assume agents can be mistaken, adversarial, compromised, or manipulated.

---

## 66. Trusted computing boundary

The trusted boundary should be deliberately small.

Ideally:

```text
schema / protocol parser

Evolution state machine

capability enforcement

evidence binding

transaction isolation

verification dispatcher

ledger integrity

constitutional authority
```

Everything else can be less trusted.

That includes sophisticated AI.

---

## 67. Economics

Agent-Ready should measure engineering resources explicitly.

Each Evolution can record:

```text
model tokens

compute

wall-clock time

human review time

CI minutes

cloud spend

verification spend

deployment cost
```

This enables real comparisons of autonomous engineering systems.

Eventually the scheduler can optimize:

```text
quality

risk

latency

money

energy

human attention
```

---

## 68. Agent reputation without hand-wavy scores

Do not assign simplistic global agent ratings.

Maintain scoped empirical histories.

Example:

```text
Agent X

TypeScript refactoring:
34/40 independently accepted

PostgreSQL performance:
3/12

Security-sensitive changes:
insufficient data
```

Selection decisions can use task-relevant historical evidence without pretending there is one universal "agent quality" number.

---

## 69. Governance of Agent-Ready itself

If this project becomes infrastructure, governance matters.

The current repository already has governance and ADR discipline.

vNext should eventually formalize:

```text
spec change process

reference implementation change process

security response

conformance policy

extension process

compatibility policy

working groups

release lifecycle
```

Do not prematurely create a foundation.

Earn external contributors first.

---

## 70. Standards strategy

Sequence:

```text
reference implementation

↓

real adoption

↓

interoperability pain

↓

document stable primitives

↓

conformance tests

↓

formal specification

↓

neutral governance if justified
```

Do not start by declaring a universal standard.

Standards without adopters are documents.

---

## 71. Open-source strategy

Agent-Ready should remain:

```text
open specification

open reference implementation

open conformance tests

open threat model

open benchmark methodology

open datasets where safe

open governance history
```

Commercial products can eventually exist above that layer.

But the substrate should remain broadly implementable.

---

## 72. Grant / research framing

For research funding, Agent-Ready should not be pitched as:

> a better coding CLI.

Pitch:

> **Research and open infrastructure for independently verifiable autonomous software evolution.**

Representative research question:

> Can complex software systems safely delegate increasing portions of maintenance and improvement to heterogeneous autonomous agents while preserving human control over objectives, authority, and standards of evidence?

Outputs:

```text
protocols

reference implementation

evaluation datasets

threat models

research papers

conformance suites

open benchmarks

case studies
```

---

## 73. Anthropic OSS framing

For Claude for Open Source or similar programs, remain grounded in the current project.

Describe v0.6.1 truthfully.

Then explain that Claude Code would be used as:

```text
development tool

system under test

agent participant in conformance experiments
```

Do not claim the full control plane exists yet.

---

## 74. Product strategy

There can eventually be three layers.

### Open protocol

The durable public substrate.

### Open-source local runtime

Usable by developers and researchers.

### Optional hosted control plane

Potential future commercial product for:

```text
organizations

fleet management

telemetry

policy management

verification compute

agent scheduling

audit

enterprise integrations
```

Do not build the SaaS first.

---

## 75. First 90 days

The immediate plan should be much smaller than the vision.

### Month 1 — Intellectual reset

Deliver:

```text
MASTER-PLAN.md

RFC-0001: Autonomous Software Evolution

LANDSCAPE.md

THREAT-MODEL-VNEXT.md

old roadmaps archived

README rewritten around the design phase

GitHub issues for Phase 1
```

Do not promise functionality that does not exist.

### Month 2 — Repository Twin prototype

Implement for TypeScript/Node:

```text
package discovery

script discovery

workspace discovery

module graph

test mapping

public API mapping

CI mapping

ownership mapping

machine-readable snapshot
```

Expose:

```bash
agent-ready discover --json
```

and perhaps an experimental MCP surface.

### Month 3 — First Evolution transaction

Implement:

```text
Evolution object

Git worktree-backed transaction

restricted writable paths

verification profile

candidate receipt

base/diff hashes

Claude Code experiment

Codex experiment
```

Then conduct the first controlled comparison.

That would be the first concrete vNext milestone.

---

## 76. One-year target

Within roughly the first serious research/development cycle, Agent-Ready should aim to demonstrate:

```text
automatic Twin generation

portable Evolutions

isolated Change Transactions

two or more real coding agents

independent verification

structured receipts

basic Constitution

MCP integration

conformance experiments

open evaluation results
```

If those primitives are compelling, expand.

If they are not, reassess before building the larger layers.

---

## 77. Three-year research horizon

A mature experimental system could include:

```text
multi-language Twin

organization graph

agent identity/delegation

multi-agent competition

verification arena

preview environments

production observation

Evolution Memory

cross-agent handoff

long-running reconciliation

research datasets
```

---

## 78. Long-term horizon

The full moonshot:

```text
human-defined constitutional objectives

continuously observed software

autonomous diagnosis

autonomous experimentation

competitive agent implementation

independent proof

automatic staged deployment

empirical postcondition checking

causal Evolution Memory

organization-scale coordination

cross-organization provenance

bounded recursive self-improvement
```

---

## 79. Success metrics

Do not optimize primarily for GitHub stars.

Technical metrics:

```text
change success rate

verification false-positive rate

verification false-negative rate

authority violation rate

rollback rate

production regression rate

agent abstention quality

human-review burden

transaction reproducibility

cross-agent portability

time to detect divergence

time to verified repair
```

Research metrics:

```text
published datasets

reproduced experiments

external research usage

papers / citations

standards contributions
```

Ecosystem metrics:

```text
independent repositories

independent agent implementations

third-party verifiers

external contributors

organizations using receipts

non-Agent-Ready implementations of the protocol
```

The last one would be particularly important.

A protocol becomes real when somebody implements it without using your implementation.

---

## 80. Explicit failure conditions

The project must be willing to discover that parts of the thesis are wrong.

Reassess if:

```text
repository Twins do not materially improve agent performance

Change Transactions add complexity without meaningful safety

independent proof poorly predicts production outcomes

existing standards fully absorb the proposed primitives

vendors converge on a superior interoperable solution

developers will not adopt even zero-config discovery

the system becomes too dependent on proprietary model behavior
```

The moonshot should be falsifiable.

---

## 81. Naming

Keep **Agent-Ready** for now.

It already has:

```text
repository
package
history
documentation
release infrastructure
```

But stop interpreting the name narrowly.

New interpretation:

> **Agent-Ready means making software systems structurally capable of working with autonomous engineering systems safely and interoperably.**

If the project eventually outgrows the name, rebrand after the new architecture proves itself.

Not before.

---

## 82. Positioning

Old:

> The missing contract between repositories and coding agents.

Retire as the primary message.

Possible transitional positioning:

> **Open infrastructure for autonomous software evolution.**

More technical:

> **A vendor-neutral control plane for governing, verifying, and observing software changes produced by autonomous agents.**

Long-term:

> **The constitutional runtime for self-evolving software.**

Internal moonshot:

> **Make software capable of safely improving itself.**

---

## 83. Core principles

The full project should remain anchored to these:

### Human sovereignty

Humans retain root authority over objectives and constitutional constraints.

### Agent replaceability

No core abstraction depends on a specific model provider.

### Independent evidence

Producers do not unilaterally certify themselves.

### Least authority

Agents receive only the capabilities required for their delegated work.

### Explicit uncertainty

Observed, derived, declared, and inferred facts remain distinguishable.

### Reversibility

Autonomous actions should be reversible whenever technically possible.

### Reproducibility

Evidence should bind to exact inputs, environments, and revisions.

### Proportional assurance

Higher-risk changes require stronger proof.

### Open interoperability

Use and extend open standards rather than enclosing the ecosystem.

### Deterministic trusted core

The deepest enforcement and evidence machinery should not depend on probabilistic reasoning.

### Empirical reality

Passing tests is not synonymous with achieving the desired real-world outcome.

### Constitutional meta-change

The system cannot silently change the rules that govern its own success.

---

## 84. Final system architecture

The complete conceptual stack:

```text
┌────────────────────────────────────────────────────────┐
│                 HUMAN ROOT AUTHORITY                   │
├────────────────────────────────────────────────────────┤
│                SOFTWARE CONSTITUTION                   │
│ intent · objectives · invariants · authority · risk   │
├────────────────────────────────────────────────────────┤
│                    SYSTEM TWIN                         │
│ code · infra · APIs · tests · telemetry · history     │
├────────────────────────────────────────────────────────┤
│                  EVOLUTION KERNEL                      │
│ state machine · reconciliation · governance            │
├────────────────────────────────────────────────────────┤
│                   AGENT FABRIC                         │
│ humans · Claude · Codex · tools · specialist agents   │
├────────────────────────────────────────────────────────┤
│                CHANGE TRANSACTIONS                     │
│ isolation · capabilities · budgets · checkpoints      │
├────────────────────────────────────────────────────────┤
│                   PROOF LAB                            │
│ tests · security · simulation · formal checks         │
├────────────────────────────────────────────────────────┤
│             DEPLOYMENT / OBSERVATION                   │
│ preview · canary · telemetry · rollback               │
├────────────────────────────────────────────────────────┤
│             EVOLUTION MEMORY / LEDGER                  │
│ causal history · provenance · validated knowledge      │
├────────────────────────────────────────────────────────┤
│                   META-EVOLUTION                       │
│ governed improvement of the autonomy system            │
└────────────────────────────────────────────────────────┘
```

---

## 85. Final project statement

**Agent-Ready is an open, vendor-neutral system for constitutionally governed autonomous software evolution. It provides the trusted infrastructure through which human-defined software intent can be translated into bounded agent work, independently verified changes, safe deployments, observed outcomes, and durable evolutionary knowledge.**

The system is designed around a future in which software development is no longer performed exclusively by humans or by individual interactive coding assistants, but by populations of autonomous engineering systems operating continuously across repositories, infrastructure, and production environments.

Agent-Ready does not attempt to make one agent intelligent.

It defines the environment in which arbitrary intelligent agents can safely participate in software evolution.

Its long-term objective is software that can:

> **understand its own structure, detect divergence from human intent, investigate its own failures, commission improvements, compare competing implementations, prove those improvements independently, deploy them safely, learn from real outcomes, and repeat—while every consequential action remains attributable, auditable, reversible, and subordinate to human authority.**

The current v0.6.1 repository is not this system.

It is the first experiment that produced several of its trusted primitives.

The next chapter of Agent-Ready is to discover whether autonomous software evolution can be turned from a collection of vendor-specific coding agents into a coherent, interoperable engineering discipline.

If that succeeds, Agent-Ready is no longer primarily a developer tool.

It becomes infrastructure for a new class of software:

> **human-governed, machine-operated, continuously verified, continuously evolving systems.**
