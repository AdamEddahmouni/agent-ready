# ADR-0043: Deterministic-core posture and quarantined integrations

## Status

Accepted

## Context

Agent-Ready's founding posture is absolute, and deliberately so. It is recorded in
`agent-ready.yaml` as an architecture invariant, stated in the now-archived
[roadmap-v1.md](../archive/roadmap-v1.md) as guiding principle 4 ("No
network, no LLM, no telemetry — ever ... a permanent commitment, not a
[temporary constraint]"), and advertised in the README badges: zero LLM calls, no
network required, zero cost. That posture is a genuine differentiator and the
reason a v0.6.1 run is reproducible, auditable, and free.

The vNext direction in
[ADR-0041](0041-vnext-autonomous-software-evolution.md) requires
capabilities that posture forbids outright: an MCP surface so agents can read
system state, adapters that invoke external agents, OpenTelemetry export so
deployment outcomes can be observed, and canary or rollback hooks that coordinate
staged rollout. There is no way to build phases 6 through 9 of the vNext direction
while holding a total ban on network access.

The choice is not simply "ban or allow". Three options exist:

1. **Keep the absolute ban and defer every networked feature indefinitely.** The
   control plane then cannot serve, observe, or deploy, and the direction stalls at
   the repository-intelligence phase. It also defers the decision rather than
   making it, and would force an amendment later under worse conditions.
2. **Retire the ban entirely.** The deterministic-reproducibility property is
   abandoned, the zero-cost default is lost, and every command becomes a candidate
   for hidden network behavior. This trades a real, verified asset for convenience.
3. **Amend the ban structurally**: keep it absolute for the trusted core, and
   define a clearly separated integration layer where networked capability may
   eventually live, under rules strict enough that the core's guarantees survive.

Option 3 preserves the property that matters and accepts only the cost that is
actually necessary. The trusted computing boundary is already drawn in
[docs/security/threat-model.md](../security/threat-model.md); this decision makes
the network boundary part of the same discipline rather than a new exception.

## Decision

Amend the posture: the ban becomes permanent for the deterministic core, and
networked capability is permitted only in a separately named, quarantined
integration layer.

The deterministic core keeps the ban permanently, in every phase, with no
exceptions for convenience:

- schema and protocol parsing and validation;
- the Evolution state machine and reconciliation bookkeeping;
- capability enforcement and authority checks;
- evidence binding and receipt construction;
- transaction isolation and workspace management;
- verification dispatch and the Proof Lab harness;
- ledger integrity;
- constitutional authority evaluation.

The core must make no network calls, no LLM calls, and require no API keys,
credentials, or hosted service. It must remain importable, buildable, and testable
with no network stack present, and it must be fully exercisable offline.

A separately named integration layer may eventually hold network-facing
capabilities: MCP transport, external agent adapters, telemetry export, and
deployment or canary hooks. Rules for that layer:

- **Dependency direction is one-way.** Integrations may depend on the core. The
  core must never depend on an integration. This mirrors the existing
  `src/contract/` boundary rule and is what makes the quarantine testable rather
  than aspirational.
- **No blanket approval is granted here.** Each individual networked capability
  requires its own design ADR, an explicit dependency audit, a stated offline
  fallback, and a fail-closed failure mode. This ADR ratifies the rule; it does not
  authorize any capability.
- **Zero-config remains the default.** Every shipped command stays local-first,
  free, and API-key-free unless the user explicitly opts in. A networked feature
  that cannot run offline without degrading its stated guarantees does not ship.
- **The core's guarantees are testable in CI.** A check that fails when a core
  module acquires a network-capable dependency is a required part of adopting any
  integration, not a follow-up task.

## Consequences

- The v0.6.x line is unaffected: no shipped command gains a network call, and the
  README badges stay true.
- The README's "no network, no LLM calls" claims must be qualified once
  integrations exist, so the wording is corrected at that time rather than left to
  drift into a falsehood.
- The design phase has a defined answer to "how do we ever call an agent?", which
  prevents that question from being answered ad hoc inside an individual feature.
- Amending a founding invariant is a visible act. Recording it as an ADR with a
  narrow scope is the honest alternative to quietly relaxing the claim and hoping
  nobody checks.
- Some vNext phases remain buildable entirely offline, and those should be built
  first, so the networked surface stays as small as the project can make it.

## Reconsideration trigger

Reconsider if an integration turns out to be required for core correctness or
testability, which would mean the separation has failed and the deterministic
guarantees are already compromised. Also reconsider if the quarantine check cannot
be implemented reliably in CI, because an unenforced boundary is an aspiration
rather than a control.
