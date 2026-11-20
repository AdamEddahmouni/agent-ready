# Master work inventory and evidence-led execution roadmap

> Status: working inventory, 2026-11-20. This document is **not** a new ADR or approval to implement every item below. It is an index of shipped work, blockers, conditional implementation, deferred legacy proposals, and research hypotheses. The authoritative source of technical intent remains [VISION.md](../../VISION.md), [RFC-0001](../vnext/RFC-0001-autonomous-software-evolution.md), accepted [ADRs](../decisions/README.md), and the [current tracker](https://github.com/AdamEddahmouni/agent-ready/issues). A named task is not a claim that it has been implemented.

## Classification and decision authority

- **DONE**: Implementation or document exists on main; completion and production-readiness are different claims.
- **OPEN**: Accepted requirement with outstanding acceptance criteria in an issue or accepted ADR.
- **CONDITIONAL**: Successor research phase; implementation requires both preceding exit and its own design decision.
- **DEFERRED**: Previously considered and deliberately outside the current phase; preserve for later evaluation.
- **HYPOTHESIS**: Research proposal, not an engineering requirement or acceptance criterion.
- **RETIRED**: Superseded historical plan; do not execute as an active roadmap without a fresh decision.

Non-negotiable: the deterministic core has no network, credentials, or model invocation (ADR-0043); compatibility guarantees are version-specific (ADR-0040 and ADR-0048); the actor that proposes a change cannot unilaterally rewrite the criteria that certify it (RFC-0001). Use the governance process before creating new normative interfaces.

## Current product and evidence baseline

- **Version 1 repository contract, validation, instruction adapters, Git protection, verification, CLI** — DONE; [Project standing](../project-standing.md), [CLI reference](../specification/cli-reference.md)
- **Reusable CI action, publish and release workflows** — DONE; `action.yml`, `.github/workflows/`
- **Repository discovery, graph, Snapshot Format 1, experimental twin build/query** — DONE on main, experimental; ADR-0044–0049; CI/API discovery explicitly absent (ADR-0051)
- **Git main version string** — DONE; `package.json` declares 0.7.0 after #77
- **Public v0.7.0 release** — OPEN; [#64](https://github.com/AdamEddahmouni/agent-ready/issues/64); no tag or publication was verified during this inventory
- **Phase 1 transcript capture, fake-runner harness, raw scoring, reporting and pilots** — DONE as tooling; `research/phase1-benchmark/` and pilot evidence under `runs/`; a pilot is not the official benchmark
- **Official full 78-trial result** — OPEN; [#61](https://github.com/AdamEddahmouni/agent-ready/issues/61)
- **Phase 2 go/no-go decision** — OPEN; [#62](https://github.com/AdamEddahmouni/agent-ready/issues/62); ADR-0052 remains pre-registered draft
- **Autonomous Evolution runtime, Constitution, proof, identity and agent fabric** — CONDITIONAL; Vision and RFC only, not implemented
- **Hosted control plane and commercial organization product** — DEFERRED; No hosted system currently exists

Release prep #77 reports 1,145 passing tests, 9 conformance cases, and successful production-only package smoke tests; these are results reported in [#64](https://github.com/AdamEddahmouni/agent-ready/issues/64), not a new test execution by this inventory. Older prose contains obsolete 1,037/1,137 counts. Prefer commit- and date-bound measurements.

## P0 — Finish the current Phase 1 critical path

These steps can be audited and improved in parallel where independent, but **the final decision remains downstream of actual raw evidence**.

### P0-A: release and package [#64](https://github.com/AdamEddahmouni/agent-ready/issues/64)

- [x] Bump source to 0.7.0 and document discovery/twin limitations (#77).
- [x] Verify CI, CodeQL and package smoke gates on main.
- [ ] Confirm tested SHA and source package contents at the intended release ref.
- [ ] Create signed release tag **only after explicit maintainer authorization**.
- [ ] Approve npm and GitHub Release deployments only with authorization; independently verify successful publication.
- [ ] Test the actual installed published artifact on supported Node and operating systems.
- [ ] Update release notes, public project standing, and #64 with exact publication evidence.
- [ ] Close #64 once its complete acceptance criteria pass.

### P0-B: protocol integrity and pilot [#57](https://github.com/AdamEddahmouni/agent-ready/issues/57)

- [x] Frozen protocol v1; corrected frozen v2, raw record schemas, trial manifests and separate pilot captures.
- [ ] **Decide proposal 0002 before official official-run selection.** Ten of 13 v2 tasks have no `command-exit-zero` clause, yet record `verificationSelectionResult: false`. A 10/13 apparent failure-rate floor is not an honest applicability denominator. Preferred _proposed_ v3: `true`/`false`/`null` and an explicit applicable-run count; leave v1/v2 untouched.
- [ ] Select and document one official protocol version and manifest; ensure issue/ADR references are consistent.
- [ ] Ensure the selected version's freeze checksums and rules are immutable before official runs.
- [ ] Validate oracle semantics and genuine tool/condition parity; preserve prior failed pilots and corrected protocol as separate evidence.
- [ ] Audit captured transcripts and pilot raw→derived→report reproduction.
- [ ] Record pilot budget and infrastructure evidence and mark #57 complete only when the final selected protocol's acceptance criteria are satisfied.

### P0-C: full evaluation [#61](https://github.com/AdamEddahmouni/agent-ready/issues/61)

- [ ] Execute **13 tasks total across 5 repositories × 3 repetitions × 2 conditions = 78 trials** (not 5×13×3×2), with fixed repository SHAs, model/client configuration and randomization.
- [ ] Keep raw, agent-ready, pilot, synthetic, and protocol-version records unambiguously separate.
- [ ] Preserve original raw outputs/logs and SHA-256 manifests; classify infrastructure and forbidden-action exclusions.
- [ ] Complete blinded adjudication where required; record any adjudication limitations.
- [ ] Compute per-task and aggregate performance, intervals, sample variance, invalid assumptions, dependency mistakes, applicable verification selection, unnecessary reads, token usage and timing.
- [ ] Publish raw checksums, reproduction command and all denominators; avoid best-of-N, post-hoc favorable task selection or significance claims.

### P0-D: publication and research decision [#62](https://github.com/AdamEddahmouni/agent-ready/issues/62)

- [ ] Publish the same complete report regardless of positive, null or harmful outcome.
- [ ] Apply the **predeclared** decision rule; report one of `helps`, `noDemonstratedBenefit`, `mixed`, `harms`.
- [ ] Finalize and merge ADR-0052 with evidence, exact protocol version and decision; keep immutable earlier versions.
- [ ] Reconcile #36/#41/#42/#57/#61/#62 and [project standing](../project-standing.md) without mistaking an implemented subcomponent for full issue closure.
- [ ] Begin Phase 2 planning only under the consequence selected by ADR-0052, and Phase 2 implementation only under its own ADR.

Dependency order: #64 publication/immutable pin → #57 valid pilot/protocol choice → #61 full run → #62 outcome/decision. Branch hygiene, documentation, independent validation and source quality work can proceed concurrently without unfreezing the study.

## P1 — Discovery accuracy and useful standalone product

**Post-Phase-1 or isolated fixes only where versioning and research fairness are maintained.** Preserve Snapshot Format 1's stable fields and corpus unless a deliberate new snapshot version is approved.

- [ ] Audit CommonJS `require`, dynamic import, re-exports, project aliases, resolution conditions and mixed TS/JS accuracy.
- [ ] Distinguish first-party source from committed `dist/`, generated `lib/` and partial-source trees. Retain the known-inaccurate conformance fixture until a genuine fix is proven.
- [ ] Expand lockfile and package-manager accuracy: pnpm/Yarn/npm, workspaces, aliases, unsupported/unknown states.
- [ ] Strengthen module, package, owner and dependency edge provenance, including line existence and repository-relative path safety.
- [ ] Reduce duplicated diagnostics in large monorepos without discarding underlying evidence.
- [ ] Add validated reverse-dependency, change-impact, ownership and test-mapping queries only when consumer need is demonstrated.
- [ ] Measure accuracy, completeness, deterministic replay, runtime and memory by repository class.
- [ ] Explore incremental updates and snapshot diffs instead of unconditional rescan.
- [ ] Revisit CI/workflow and public API discovery only under ADR-0051's reconsideration conditions and compatibility rules.
- [ ] Expand pinned external corpus, including adversarial/unsupported cases; independently audit source and graph correctness.
- [ ] Validate onboarding on unrelated projects without requiring an existing `agent-ready.yaml`.
- [ ] Obtain external maintainer usage reports and publish correctly scoped case studies; never equate npm downloads to distinct users.

## P1 — Security, packaging and long-term maintainability

- [ ] Review all public exports and define a defensible stabilization path distinct from experimental vNext interfaces.
- [ ] Audit cross-platform path casing, symlinks, protected paths, workspace boundaries and TOCTOU assumptions.
- [ ] Audit process timeouts, termination guarantees, command-execution safety and environment isolation.
- [ ] Audit supply-chain provenance, dependency/license checks, and pinned third-party CI actions.
- [ ] Keep production-only packed-package tests and executable smoke tests in CI.
- [ ] Test contract/schema migration and adapter-output compatibility; review every ADR reconsideration trigger.
- [ ] Reconcile outdated documentation/test counts and scope claims with branch-specific evidence.
- [ ] Review supported Node versions, OS matrix and upcoming end-of-support policies.
- [ ] Define a release-support/deprecation policy once users exist.
- [ ] Maintain a small trusted core; anything using network, models or credentials belongs behind an explicit integration boundary.

## CONDITIONAL — vNext phases defined by RFC-0001

Each successor phase has a research question and exit criterion; completion of a previous phase is not automatic implementation authorization.

- **2 — Evolution + transaction** — Evolution object, isolated Git worktree/container transactions, immutable base, budgets, scopes, checkpoints, receipts; Can changes be portable across agent vendors?
- **3 — Independent proof** — Verification profiles, independent verifiers, hash-bound receipts, public defect dataset; Which evidence predicts actual correctness?
- **4 — Constitution** — Human-ratified policies, risk classes, immutable approval requirements, explicit escalation; What is the minimum enforceable governance model?
- **5 — Identity/capabilities** — Delegated grants, short-lived credentials, expiry, revocation, auditable attenuation; Can agents operate without ambient authority?
- **6 — Agent Fabric** — Adapters, capability negotiation, scheduling, handoff and resource accounting; Which delegation strategies improve outcomes?
- **7 — Verification Arena** — Competing candidates, blind evaluation, Pareto selection; When does multi-agent competition repay its cost?
- **8 — Deployment/observation** — Preview/staging, canaries, rollback, OpenTelemetry and postconditions; Does observing reality improve correctness judgments?
- **9 — Reconciliation** — Observe→compare→open→prove→deploy→observe loop on low-risk work; Can bounded maintenance operate without each-cycle approval?
- **10 — Evolution Memory** — Evidence-linked findings, failure/causal history, retractable claims; Does validated memory help without accumulating drift?
- **11 — Organization Twin** — Cross-repo/service/infrastructure graph and multi-repo Evolutions; Does the model generalize beyond one repository?
- **12 — Meta-Evolution** — Bounded improvements to planners, verifiers, routing and kernel components; Can the system improve itself without circular certification?

Reference details: [Vision phases 49–61](../../VISION.md), [RFC phases](../vnext/RFC-0001-autonomous-software-evolution.md).

## CONDITIONAL — specification and interface families

Candidate specifications: AR-CONSTITUTION, AR-TWIN, AR-EVOLUTION, AR-TX, AR-IDENTITY, AR-CAP, AR-PROOF, AR-OBSERVE, AR-LEDGER, AR-HANDOFF, AR-CONFORMANCE.

Potential user/system surfaces: extended CLI; local `serve` daemon; MCP; CI; GitHub App; SDK; local dashboard; optional hosted organization plane. These are proposals, **not** existing services or guaranteed API names. A future normative spec requires independently tested semantics, versioning, threat model and conformance fixtures.

## CONDITIONAL — research tracks and artifacts

- [ ] Repository representation versus raw tools: task success, token cost, wrong assumptions, invalid edits and real-agent behavior.
- [ ] Verification false-negative/false-positive calibration on known-bug corpora.
- [ ] Portability, isolation, transaction reversibility and authority-violation experiments.
- [ ] Structured cross-agent handoff and resumption against transcript-only continuation.
- [ ] Multi-agent competition versus single strong agent under matched budgets.
- [ ] Pre-deployment scores versus observed staging/production postconditions.
- [ ] Long-running maintenance and evidence-grounded memory ablations.
- [ ] Counterfactual predictions versus real outcomes; adaptive proof portfolio selection.
- [ ] Standards interoperability and non-reference implementations.
- [ ] Bounded meta-improvement under externally fixed evaluation.
- [ ] Publish reproducible data, methods, negative results, limitations, technical reports and peer-review-ready papers where supported.

## DEFERRED — archived v1 roadmap, do not execute by version number

Historical proposals include: `analyze --architecture` boundaries, Python/FastAPI/Rust/Go examples, multi-language `doctor` probes, external adapter registration, public API freeze, case-insensitive path conflict handling, symlink enforcement, process termination hardening, dependency license checks, and three independently owned external users as a former v1.0 exit criterion. The [archived roadmap](../archive/roadmap-v1.md) is historical, **not** the current v0.7 or 1.0 plan.

The surviving [`agent/brain-integration-and-adr-0037`](https://github.com/AdamEddahmouni/agent-ready/tree/agent/brain-integration-and-adr-0037) branch contains possible examples, scripts and Agentic Development Brain documentation. Salvage only compatible parts after checking ownership and current equivalents; do not merge old ADR-0037–0039 into the current ADR namespace. The `docs/vnext-phase-0` branch is superseded by later main documentation; review before archiving. Do not silently delete historical work.

## HYPOTHESES — research exploration, not committed features

- Scoped evidence-based agent routing and task-dependent reputation.
- Adaptive independent verification portfolios based on predicted failure classes.
- Causal and counterfactual dependency modeling, beyond syntax-level imports.
- Safe-abstention thresholds, human escalation and tradeoffs between autonomy and human attention.
- Integrity analysis of benchmark denominators, withheld evidence and adversarial trial selection.
- Bounded cross-agent competition and consensus with explicit correlated-failure controls.
- Privacy-preserving opt-in research commons and cross-project federation.
- Evolution receipts as interoperable attestations atop Git, in-toto/SLSA and OpenTelemetry.
- Cost/resource economics of candidate generation versus independent verification.
- Reversible operation under partial outages, changing tools and long-running workloads.

Never label these as demonstrated originality or existing features without external prior-art and implementation evidence.

## Optional commercial and ecosystem horizon

Potential **optional** hosted organization dashboards, policy coordination, evidence retention, scheduled checks, agent scheduling, audit exports, identity, cloud compute, dedicated deployments and support/SLA agreements. Preserve a usable open, offline, local-first core and do not make a subscription prerequisite for local verification or discovery. A business model requires independent demand validation, not just a technical roadmap.

Potential documentation and outreach: current onboarding tutorial, worked examples, public benchmark results, architecture diagrams, documentation navigation, case studies, research publications, conformance materials and responsible contribution guidelines. Branding/site redesign should remain secondary to measurable external usefulness.

## Completion discipline for every task

For every completed item, record:

1. Repository SHA and affected components.
2. Governing issue/ADR or explicit label **exploratory**.
3. Implemented behavior versus unimplemented ambition.
4. Exact test, conformance and package checks **actually run** and their result.
5. Compatibility and security consequences.
6. Reproduction steps and links to evidence.
7. Remaining limitations, including negative results.

Do not mark a checklist item complete because a PR exists, a prototype looks useful, or an agent self-reports success. Do not alter prior frozen protocol files or earlier raw evidence to fit a desired conclusion.
