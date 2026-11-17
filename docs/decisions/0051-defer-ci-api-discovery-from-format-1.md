# ADR-0051: Defer CI and API discovery from Discovery Snapshot Format 1

- **Status:** Accepted
- **Date:** 2026-11-17
- **Related:** ADR-0044, ADR-0045, ADR-0046, ADR-0047, ADR-0048, ADR-0049,
  ADR-0050; [RFC-0001](../vnext/RFC-0001-autonomous-software-evolution.md);
  GitHub #63 (decision), #54 (protocol freeze), #64 (v0.7.0 release)

## Context

### What Phase 1 promised, and what exists

[VISION.md §50](../../VISION.md) lists API discovery and CI discovery in the
Phase 1 build, beside repository discovery, the repository graph, command and
test discovery, ownership discovery, and the machine-readable snapshot.
[RFC-0001](../vnext/RFC-0001-autonomous-software-evolution.md) frames Phase 1
as one falsifiable question: whether a deterministic repository model
materially improves an agent over raw filesystem and shell access.

Part of that build is on `main` today:

- `agent-ready discover`, with a fact model built on twelve fixed fact ids plus
  the scoped `repository.packageManager.<path>` identity;
- the provenance-carrying module, dependency, and ownership graph, published as
  a top-level `graph` field (ADR-0047);
- Discovery Snapshot Format 1, with a hand-authored schema, a field-level
  stability contract, and an eight-case conformance corpus (ADR-0048);
- experimental `agent-ready twin build` and `agent-ready twin query`, which
  write and read that snapshot without rescanning the repository (ADR-0049).

Two Phase 1 items are not implemented: **CI discovery** (workflow files, jobs,
triggers, and the commands they declare) and **API discovery** (the exported or
public surface of a package). The published npm `latest` remains `0.6.1`; the
discovery and twin surfaces are on `main` in the Unreleased section, not in that
package.

The next Phase 1 milestone is not more discovery. It is evaluation: freeze
protocol v1 (#54), build the harness (#59), run the pilot (#57), execute the 78
predeclared trials (#61), and publish the result and Phase 2 go/no-go (#62).
The protocol's five repositories and thirteen tasks are already fixed, and none
of those tasks asks for a CI or API fact.

### Why Format 1 cannot absorb CI/API now

Discovery Snapshot Format 1 is no longer an experimental shape. ADR-0048 makes
`facts` a stable object **keyed by fact id**, makes the fact id vocabulary part
of that guarantee, and makes the top-level field set stable. The schema closes
the envelope with `additionalProperties: false`.

That gives two possible representations, and both are breaking changes:

- **A fact id per CI/API domain** changes the stable `facts` key set, which
  ADR-0048 §13 classifies as requiring a new `snapshotVersion`.
- **A new top-level `ci` or `api` section** changes the stable top-level field
  set and the closed envelope, which is the same classification. ADR-0047 could
  add `graph` as a top-level field only because that happened **before** Format 1
  promised stability; the same move after Format 1 is a v2 change.

Representation is not the only cost. CI discovery must interpret workflow
syntax, matrices, reusable workflows, and third-party actions. API discovery
must resolve package entrypoints and exported TypeScript symbols, including
conditional exports and internal-only exports. Both are heuristic domains that
would need their own false-positive policy, provenance rules, corpus cases, and
known-inaccurate fixtures. Adding either in the same window as the benchmark
would invalidate the Format 1 baseline and confound the comparison the
benchmark exists to make.

The pressure to add them is real, and it is exactly the pressure Phase 1 was
designed to resist: building more model before measuring whether the model
helps. A negative or null benchmark result is a legitimate Phase 1 outcome, and
it is cheaper to learn that on the current surface than after two more domains
have been folded into it.

## Decision

1. **Discovery Snapshot Format 1 stays as shipped.** No CI or API fact ids and
   no CI or API top-level sections are added to `snapshotVersion: 1`.
   `FACT_IDS` remains the twelve fixed ids plus the scoped package-manager
   template, and the ADR-0048 stability contract continues to govern the
   format unchanged.
2. **CI and API discovery are deferred, not rejected.** They are removed from
   the Phase 1 exit and from the benchmark artifact. They remain part of the
   longer-term VISION direction; this record does not delete them from the
   roadmap.
3. **The Phase 1 evaluation proceeds on Format 1 as it exists.** Freezing the
   benchmark protocol, building the harness, and running the 78 trials are not
   blocked by CI/API discovery. The research question is evaluated against the
   model that was actually built.
4. **Any future CI/API discovery needs a new format decision.** It must land as
   `snapshotVersion: 2` with a new schema directory and conformance corpus, or
   as a separately versioned artifact with its own schema and stability
   contract. It may not be added to v1 as a provisional field, an open enum, or
   an undocumented extension. v1 remains immutable and its corpus remains
   valid.
5. **Public Phase 1 status is reconciled to the code.** The canonical statement
   is [docs/project-standing.md](../project-standing.md). The documents that
   previously contradicted it — `project-standing.md`,
   `docs/vnext/PHASE-1-ISSUES.md`, `README.md`, and
   `docs/specification/cli-reference.md` — are corrected in the same change as
   this record.

### Public status at acceptance

| Surface                                                                          | State on `main` (2026-11-17)                       | In npm `0.6.1`? |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | --------------- |
| `agent-ready.yaml` v1 contract and eleven v1 commands                            | Frozen and released                                | Yes             |
| `agent-ready discover`                                                           | Implemented; twelfth top-level command             | No              |
| Discovery Snapshot Format 1                                                      | Implemented; stable per ADR-0048                   | No              |
| Repository graph                                                                 | Implemented; top-level `graph`, no `graph` command | No              |
| `agent-ready twin build` / `twin query`                                          | Implemented; experimental; snapshot-only query     | No              |
| CI discovery                                                                     | Not implemented; deferred by this record           | No              |
| API discovery                                                                    | Not implemented; deferred by this record           | No              |
| Benchmark protocol v1                                                            | Draft; not frozen; no evaluation run               | No              |
| Evolution, transactions, proof, Constitution, capabilities, MCP, hosted services | Not implemented                                    | No              |

`discover` and `twin` are code on `main`, not documentation placeholders. They
are also not a released capability until v0.7.0 (#64); public text must say
which of those two things it means.

## Alternatives considered

### Add CI/API facts now and bump to `snapshotVersion: 2` before the benchmark

Rejected. It would invalidate the Format 1 corpus that the conformance suite and
the benchmark baseline depend on, and require a second schema, corpus, and
stability review before Phase 1 has produced any result. The benchmark should
measure the model that exists, not a model rebuilt to include the features under
debate.

### Add CI/API as top-level sections, leaving `FACT_IDS` untouched

Rejected for the same versioning reason. ADR-0047's top-level `graph` is not a
precedent for extending a **stable** envelope: the graph landed before Format 1
promised anything. A new stable top-level section after Format 1 is a v2 change,
and a new **provisional** section would still have to be declared in a schema
that currently closes the envelope.

### Build a separate CI/API command or artifact now

Rejected for Phase 1 exit. It adds a new CLI surface, a new schema, and a new
set of heuristics without benchmark evidence that agents need them. A separate
artifact is a reasonable **future** shape, which is why decision 4 permits it,
but it is not a way to smuggle the work past the format decision.

### Remove CI/API from VISION and Phase 1 permanently

Rejected. The evidence for or against these domains is exactly what the
benchmark and later phases can produce. A deferral with a reconsideration
trigger is honest; a permanent deletion would be a decision made without
evidence.

### Emit v1 and v2 concurrently during a transition

Rejected. There is exactly one stable version and no content negotiation by
design (ADR-0048 §16). With no external consumer of CI/API facts yet, there is
nothing to migrate; adding dual emission would create a maintenance burden and
a second compatibility promise for no user.

## Consequences

- Format 1, its eight-case corpus, and the benchmark baseline remain stable.
  The 78-trial run can proceed without a format migration.
- Phase 1's delivered scope is narrower than the VISION §50 build list. Public
  documents must say that CI and API discovery are deferred, not that Phase 1
  shipped them.
- A user who needs CI or API facts gets an explicit absence from Format 1 rather
  than a guessed fact. That is consistent with the project's "unknown beats
  wrong" rule.
- If the deferred work is pursued later, it pays the v2 cost: a new schema, a new
  conformance corpus, a migration note, and a new ADR. That cost is accepted
  now rather than paid implicitly by breaking v1.
- The benchmark result may show that CI/API facts would have helped. That is a
  finding for Phase 2 planning, not a reason to reopen v1 after the run.

## Reconsideration trigger

Revisit this decision only after the Phase 1 result is published, or earlier if
the pilot produces a concrete failure that cannot be explained without a CI or
API fact. A revisit requires all of the following:

1. a named benchmark task or external consumer that needs the fact;
2. a proposed representation and provenance rule, including what is `unknown`
   rather than guessed;
3. at least one positive and one known-inaccurate corpus case for the new
   domain;
4. a new ADR that versions the change as `snapshotVersion: 2`, or as a separate
   artifact with its own version and stability contract.

Wanting the feature is not a trigger. A benchmark result that identifies the
gap is.
