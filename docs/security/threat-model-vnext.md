# Threat model: vNext autonomous software evolution

> **Status: forward-looking threat model. Nothing here is implemented.**
>
> The threats in this document are created by a _proposed_ direction
> ([RFC-0001](../vnext/RFC-0001-autonomous-software-evolution.md),
> [VISION.md](../../VISION.md)). **None of them are mitigated today**, because
> none of the capabilities that would make them real exist yet. This document
> exists so the threat surface is written down before the code, not after.
>
> The shipped v0.6.x product is covered by
> [threat-model.md](threat-model.md), which remains accurate and authoritative for
> what this repository currently does.

## Scope

The vNext direction proposes a system that grants explicit authority to autonomous
actors, certifies their output independently, deploys accepted changes, observes
production, and retains conclusions across agent generations. Every one of those
capabilities is a new attack surface, and the central difficulty is that the most
capable actors in the system are also the least predictable.

Assumption: agents can be mistaken, adversarial, compromised, prompt-injected, or
manipulated by data they read. The system must remain safe under all of those
conditions, including the condition where the agent is trying hard to help.

## The structural problem

A conventional CI system trusts its own scripts, because the humans who wrote them
are the same humans who review changes. An autonomous evolution system breaks that
identity: the actor that produces a change is not necessarily the actor that
approves it, is not necessarily the actor that verifies it, and is not necessarily
the human whose objective is being served.

That breaks three assumptions at once:

1. **Authority is ambient** — credentials are held, not scoped.
2. **Verification is self-certifying** — the producer is also the judge.
3. **Deployment implies success** — passing checks is treated as the objective
   being met.

Each is a design commitment to abandon, which is why the vNext direction is a
security project before it is a feature project.

## Threat classes

None mitigated. Each needs a designed control, not awareness.

### T-01 Agent modifies its own verifier

An agent edits the test, the lint rule, the build script, or the evidence format so
that its change passes.

- **Surface:** verification infrastructure, test files, CI configuration, the
  recording format itself.
- **Why it is hard:** the verifier is usually in the same repository, in the same
  writable scope, and under the same agent.
- **Candidate controls:** verifiers pinned outside the transaction's writable scope;
  verification run from an immutable base-revision checkout; evidence bound to
  verifier hashes; changes to verification policy require authority the agent
  cannot self-grant.

### T-02 Agent modifies governing policy

An agent edits the Constitution, the capability rules, the approval requirements, or
the evidence requirements that constrain it.

- **Surface:** constitution files, authority configuration, escalation rules.
- **Candidate controls:** constitutional changes require higher-order authority than
  the change being governed; trust strata that prevent a lower layer from weakening a
  higher one; human ratification for changes to the rules themselves.

### T-03 Excess credential access

An agent inherits ambient developer credentials — cloud, registry, deploy, database
— rather than task-scoped capability.

- **Surface:** environment inheritance, credential helpers, CI secrets, local agent
  configuration.
- **Candidate controls:** transactions run without ambient authority; capabilities
  are explicit, minimal, time-bounded, and revocable; no production credentials are
  reachable from a transaction workspace.

### T-04 Evidence falsification

An agent fabricates, edits, deletes, or backdates verification evidence; records a
command as passed that did not run; or reuses evidence from a different revision.

- **Surface:** evidence files, records, receipts, logs.
- **Candidate controls:** evidence bound to inputs, environment, revision, and
  artifact hashes; append-only storage; independent recomputation; distinguishing
  self-reported from independently produced evidence.

### T-05 Verification gap exploitation

An agent finds a test gap and targets it deliberately rather than accidentally.

- **Surface:** coverage holes, weak assertions, flaky-test tolerance, unverified
  error paths.
- **Candidate controls:** risk-proportional assurance; adversarial verification;
  mutation testing to measure test strength; the finding that a change is
  _undertested_ is itself a first-class result rather than a pass.

### T-06 Verifier collusion

A verifier is biased, compromised, shares incentives with the producer, or is the
producer under another name.

- **Surface:** the verification portfolio itself.
- **Candidate controls:** record producer and verifier separately; weight assurance
  by independence class; prefer heterogeneous verifiers; treat a single-model
  self-check as weak evidence regardless of confidence.

### T-07 Hidden production regression

A change passes every pre-merge check and degrades the running system — latency,
error rates, data integrity, or user-visible behavior.

- **Surface:** anything deployed.
- **Why it is hard:** pre-merge verification and production reality diverge, and the
  size of the gap is an open research question this project intends to measure
  rather than assume.
- **Candidate controls:** staged rollout, canary, automatic rollback, explicit
  postconditions; an Evolution stays open until postconditions are evaluated; a
  passing check is never recorded as a satisfied objective.

### T-08 Metric optimization against intent

An agent satisfies a measurable proxy while degrading the objective it was meant to
serve — test count up, coverage up, latency up, and the actual user experience
worse.

- **Surface:** every objective expressed as a measurable property.
- **Candidate controls:** distinguish declared objectives from derived proxies;
  require human judgment where a property is not machine-verifiable; record
  explicitly which properties remain human judgment rather than pretending otherwise.

### T-09 Memory poisoning

An agent writes a false conclusion into long-term memory, and future agents treat it
as validated knowledge — including knowledge about what never works.

- **Surface:** evolution memory, learned facts, failure records.
- **Candidate controls:** every memory entry bound to the Evolution and evidence that
  produced it, with stated limitations and confidence; memory is evidence-linked, not
  a summary of conversation; failed attempts are recorded with their conditions, not
  deleted.

### T-10 Observation tampering

An agent influences the telemetry that would reveal its own failure — by disabling
instrumentation, filtering alerts, or reshaping the metric.

- **Surface:** observability configuration, alerting, telemetry pipelines.
- **Candidate controls:** treat observation infrastructure as protected; observed
  facts are sourced from systems the evolving agent does not control; distinguish
  observed facts from agent-reported ones.

### T-11 Resource budget exhaustion

An agent exceeds time, compute, token, or financial budgets — through a loop, a
runaway fan-out, or a deliberate attempt to exhaust the system.

- **Surface:** every budgeted operation.
- **Candidate controls:** enforced budgets at the transaction level, not by the
  agent's own discipline; hard cancellation; accounting that survives agent
  termination.

### T-12 Authority delegation beyond scope

An agent delegates to a sub-agent, tool, or integration with broader authority than
it holds, chaining permitted steps into a forbidden outcome.

- **Surface:** delegation, handoff, tool invocation, sub-agent spawning.
- **Candidate controls:** delegation permitted only where explicitly allowed;
  delegated authority can never exceed the delegator's; every hop is recorded.

### T-13 Irreproducible state

An agent leaves the system in a state that cannot be reconstructed or undone — an
undeclared dependency, a mutated artifact, a side effect outside the transaction.

- **Surface:** anything outside the transaction workspace.
- **Candidate controls:** immutable base state, declared writable scope, full
  reversibility as a design requirement, receipts sufficient to reconstruct the
  change.

### T-14 Supply-chain compromise

An agent introduces a malicious or vulnerable dependency, or tampers with the
provenance chain.

- **Surface:** dependency manifests, lockfiles, build and release infrastructure.
- **Candidate controls:** compositional use of SLSA/in-toto provenance; dependency
  changes classified as higher risk; require human approval for dependency changes
  that cross a configured boundary.

## Trusted computing boundary

The boundary is deliberately small, and — per
[ADR-0043](../decisions/0043-core-posture-and-integration-quarantine.md) —
entirely deterministic. It contains no model-dependent logic:

```text
schema and protocol parsing

Evolution state machine

capability enforcement

evidence binding

transaction isolation

verification dispatch

ledger integrity

constitutional authority evaluation
```

Everything else is less trusted, explicitly including sophisticated AI. A control
outside this boundary is not a control; it is a suggestion.

## Trust strata

Recursive improvement introduces a circular trust problem: the machinery that
certifies changes can itself be changed. The layers are:

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

A lower layer must not be able to silently weaken a higher layer that certifies it.
Meta-evolution requires stronger evidence than ordinary application evolution, and
is explicitly out of scope for the initial design phase.

## Standing constraints inherited from the current posture

- The deterministic core makes no network calls, no LLM calls, and requires no API
  keys or credentials, in any phase. The core must be buildable, importable, and
  testable with no network stack present.
- Network-facing integrations are quarantined, one-way dependent on the core, and
  each requires its own design ADR, dependency audit, offline fallback, and
  fail-closed behavior.
- Zero-config, zero-API-key remains the default for every shipped command.

## Honest status

| Question                                                      | Answer                                       |
| ------------------------------------------------------------- | -------------------------------------------- |
| Which of T-01 through T-14 are mitigated today?               | None                                         |
| Which can be partially mitigated with existing v1 primitives? | T-04 and T-13, in limited local forms only   |
| Is a conformance suite planned?                               | Yes, but not before an implementation exists |
| Has an external security review happened?                     | No                                           |
| Would this design survive a red team today?                   | Untested; the design is not built            |

The last row is the important one. This is a threat model for a system that does
not exist, written early on purpose. It should be treated as a list of obligations
for whoever builds it, not as a claim of safety.
