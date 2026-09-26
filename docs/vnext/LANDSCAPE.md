# Landscape: what Agent-Ready would own, and what it refuses to rebuild

This document is the [Phase 0 exit condition](../../VISION.md) of
[RFC-0001](RFC-0001-autonomous-software-evolution.md): the project can state what it
owns that adjacent efforts do not, and — just as importantly — which problems it
declines to solve because someone else already owns them.

**Status: design analysis, not implementation.** Nothing described here exists in
code today. The shipped product is the v0.6.x repository-contract CLI described in
[README.md](../../README.md).

## The one-line test

If an adjacent project absorbs Agent-Ready's proposed primitive, Agent-Ready should
delete its implementation and keep the integration. A design that only makes sense
if this project owns a layer is a bad design.

## Adjacent efforts

| Project                                                                   | Owns                                                                                                               | Agent-Ready's position                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](https://agents.md)                                            | Human-readable repository guidance convention, now under the Agentic AI Foundation                                 | **Consume.** Instruction-file generation is demoted to a compatibility feature and keeps working, but it is no longer the product's center.                                                                                 |
| [MCP](https://modelcontextprotocol.io)                                    | Agent-to-tool and context interoperability; expanding toward long-running tasks, authorization, and agent identity | **Consume as transport.** Agent-Ready will not define a competing agent RPC protocol. An MCP surface is a likely integration layer.                                                                                         |
| [SLSA](https://slsa.dev) / [in-toto](https://in-toto.io)                  | Build and source provenance, attestations, actor attribution                                                       | **Consume and extend upward.** SLSA answers "how was this artifact built". Agent-Ready targets the layer above: intent, authority, verification, and observed outcome.                                                      |
| [OpenTelemetry](https://opentelemetry.io)                                 | Vendor-neutral runtime telemetry                                                                                   | **Consume.** No proprietary telemetry universe. Observed facts arrive as OpenTelemetry data.                                                                                                                                |
| Git                                                                       | Content and history substrate                                                                                      | **Consume.** Git is not replaced. Agent-Ready adds semantic evolution above commits, and the Evolution Ledger is a logical record, not a replacement history.                                                               |
| OCI / containers / VMs / sandboxes                                        | Isolation substrates                                                                                               | **Consume.** Change Transactions prefer existing isolation primitives.                                                                                                                                                      |
| Agent orchestrators (issue-tracker-driven dispatch, coding-agent fleets)  | Deciding which task receives an agent, and keeping task state reconciled                                           | **Adjacent, not competing.** Orchestrators answer "which task gets an agent". Agent-Ready answers "under what authority may this work occur, what evidence is required, and is the resulting system transition acceptable". |
| Policy-as-code engines                                                    | Evaluating policy against infrastructure                                                                           | **Adjacent.** A Constitution is one input to the system, not the system. Policy without transactions, evidence, and observation is a linter.                                                                                |
| Security scanners, SAST/DAST, fuzzers, mutation testing, formal verifiers | Producing verification signals                                                                                     | **Compose.** They are verifiers registered with the Proof Lab, not products to reimplement.                                                                                                                                 |
| CI systems                                                                | Running checks                                                                                                     | **Consume and produce evidence.** Agent-Ready needs a CI verifier and emits machine-readable evidence; it does not replace the CI vendor.                                                                                   |
| Vending coding agents                                                     | Producing candidate changes                                                                                        | **Consume.** No core abstraction may depend on a model provider.                                                                                                                                                            |

## Where the overlap actually is

Most of the table above is consumption, which raises a fair question: if the design
is mostly integration, is there anything left to own?

Three places remain genuinely uncovered, and they are uncovered for the same
structural reason — they require authority to sit _between_ an agent and a change,
and no existing artifact is positioned to do that.

### 1. Authority as a first-class, inspectable object

Existing systems authenticate the human or process holding a credential. Agent
infrastructure is adding agent identity and authorization, mostly so that tools
can be called safely. Neither is the same as a task-scoped authority record that
answers: who delegated this, for which objective, against which system, with which
capabilities, until when, revocably, and what happens on expiry or violation.

The proposal is deliberately modest: explicit, minimal, time-bounded, auditable,
revocable capabilities attached to a change, not a proprietary identity scheme.
[VISION.md §12](../../VISION.md) and §13 are the long-term ambition; Phase 5 is
where this becomes real.

### 2. Independence as a structural property of evidence

Verification exists everywhere. _Independent_ verification, recorded as such, with
the producer and verifier distinguished and both bound to the exact artifacts
examined, exists mostly as informal practice. The interesting property is not "a
test ran" but "this verdict was produced by something that did not author the
change, at assurance level N, over inputs with these hashes".

The shipped v0.6.1 evidence model is the honest starting point. It records executed
verification. It does not yet distinguish self-verification from independent
verification, and it does not bind evidence to a revision. That gap is the Phase 3
work.

### 3. Causal history linking intent to outcome

Git records what the code was. It does not record why a change was made, what
authority existed, which alternatives were tried, what evidence was produced, what
deployed, or what reality said afterwards. Supply-chain provenance captures part of
this for builds, not for engineering intent and outcomes.

The Evolution Ledger and the Software Evolution Graph are the proposal
([VISION.md §25](../../VISION.md), §26). The honest assessment is that this is the
most speculative part of the thesis: its value compounds slowly, it is invisible in
the first phase, and it is the part most likely to be judged as over-engineering
before it has paid for itself.

## What Agent-Ready will not do

- Not a general-purpose agent-to-agent protocol.
- Not a new configuration standard. `agent-ready.yaml` should shrink to what cannot
  be derived; the Twin and existing authoritative sources supply the rest.
- Not a hosted service in the design phase.
- Not a model, an agent runtime, or a prompt store.
- Not a global certificate authority. Federation is interoperable evidence that
  consumers choose to trust on their own terms.
- Not a replacement for Git, CI, or the deployment platform.

## Exit condition for Phase 0

Phase 0 is complete when this document can be read by someone from the MCP, SLSA,
and orchestrator communities without them finding a claim they must dispute, and
when the answer to "what would you delete if someone else built this first?" is
written down for each proposed primitive.

Answered so far: delete the Evolution Receipt and reuse in-toto attestations
enriched with a custom predicate; delete the telemetry export and use
OpenTelemetry; delete the agent transport and use MCP; delete the transaction
workspace and use a container or worktree. Keep the Evolution object, the
capability record, and the causal ledger — because those are the three things with
no existing home, and each is cheap to drop later if a standard absorbs it.

## How this document is falsified

If a major adjacent project ships task-scoped delegated authority, independent
verification records, and a causal change history with adoption, this document is
wrong and the project should integrate rather than compete. That is a legitimate
outcome, recorded in advance so it is not relitigated later.
