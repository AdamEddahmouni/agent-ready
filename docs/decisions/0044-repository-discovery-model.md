# ADR-0044: The repository discovery model and its fact boundary

## Status

Accepted. Partially amended by
[ADR-0045](0045-package-and-workspace-discovery-semantics.md), which supersedes
three specific rules below; the amendments are marked inline and ADR-0045 governs
where they conflict.

## Context

[ADR-0041](0041-vnext-autonomous-software-evolution.md) set the vNext direction, and
the Phase 1 thesis recorded in
[PHASE-1-ISSUES.md](../vnext/PHASE-1-ISSUES.md) is one question:

> Can Agent-Ready construct a useful, deterministic machine model of an arbitrary
> TypeScript/Node repository without requiring the maintainer to manually describe
> that repository?

Every existing command answers a question about a contract that a human already
wrote. `agent-ready inspect`, `generate`, `check`, and `analyze` all begin by finding
`agent-ready.yaml` and fail with `CONTRACT_NOT_FOUND` when it is absent. They are
excellent instruments for a repository that has been described, and useless for one
that has not. Discovery is the first capability that has to work _before_ any of that,
on a repository nobody has written a contract for.

The design risk is not writing the probes. It is writing a snapshot that is
**confidently wrong**. A repository model that says `packageManager: npm` when the
lockfile says otherwise is worse than one that says `unknown`, because an agent
consuming the snapshot cannot tell a wrong answer from a right one. A wrong fact
propagates into every downstream decision; an honest gap is merely inconvenient.

There is a second, subtler risk. If `agent-ready.yaml` may contribute facts, then a
maintainer description can silently become a discovered fact, and the benchmark
planned in [PHASE-1-ISSUES.md](../vnext/PHASE-1-ISSUES.md) Issue #7 would end up
measuring "a human wrote the contract" rather than "the repository was
discovered". The evaluation would flatter the model for the wrong reason.

The decision boundary that must be settled before any code is written:

- what the repository model _is_, in the smallest form that is still useful;
- how a reader distinguishes what the repository **states** from what Agent-Ready
  **inferred**;
- whether a human-authored contract may contribute, and with what status;
- the false-positive policy;
- the CLI surface and the diagnostic codes it implies.

## Alternatives considered

- **Emit plain values, document the distinction in prose.** `{"packageManager":
"pnpm"}` with a spec paragraph explaining which fields are inferred. Cheapest to
  implement, and the distinction survives only as long as every consumer reads the
  prose. Nothing in the artifact itself prevents a later field from silently
  changing epistemic status, and nothing lets a consumer filter on it.
- **Separate arrays per epistemic kind** — `declared: {...}`, `derived: {...}`,
  `contradictions: [...]`. Explicit and easy to read, but it does not solve the
  "what do I do about this field" problem, because a consumer still has to look in
  several places and reconcile absence, which is exactly where the ambiguity lives.
- **Every fact carries a kind tag, and `unknown` is a first-class value.** Costs more
  bytes per fact and makes the schema less pleasant to consume by hand. Makes the
  boundary structural instead of documentary, keeps absence and uncertainty
  distinguishable, and lets a consumer ask "give me only what the repository
  asserted" without a second document.
- **Let the contract supply facts directly, marked only as such.** Simpler, and
  arguably more useful. Rejected because it contaminates the Phase 1 evaluation: the
  whole point of Issue #7 is to compare _raw filesystem_ against _the model_, and a
  hand-maintained description appearing inside the model arm makes the comparison
  meaningless.
- **A separate `confidence` number per fact.** Explicitly rejected. It invites
  shipping a heuristic behind a disclaimer, which is the failure mode this issue
  exists to prevent. A heuristic that cannot be made accurate enough to be
  trustworthy is removed, not scored.

## Decision

### A fact is a record, not a value

The repository model is a map of **facts**. A fact is never a bare value. It has a
shape:

```text
{
  kind: "declared" | "derived" | "author-declared" | "unknown",
  value: <the fact's value> | absent,
  reason?: "no-evidence" | "probe-failed" | "conflict" | "not-probed",
  evidence: [{ path, line?, detail }],
  corroboration?: { authorDeclared: bool, corroborated: bool }
}
```

The four kinds are the boundary, and they are not interchangeable:

- **`declared`** — read verbatim from a file that _asserts_ the fact. The repository
  states it. Example: `packageManager: pnpm@10.0.0` from the `packageManager` field
  of `package.json`.
- **`derived`** — computed by a fixed rule from repository content. The repository
  implies it, and the rule is part of the code. Example: a `pnpm-lock.yaml` at the
  root yields a derived package-manager fact. The rule is stated in the
  implementation, not in a config file, so it cannot be tuned per repository.
- **`author-declared`** — asserted by a human in `agent-ready.yaml`. This is a
  _claim about_ the repository, not a fact _of_ it. It is never promoted to
  `declared` or `derived`.
- **`unknown`** — discovery ran and could not determine the fact. `unknown` is a
  real value with a real `reason`, not an absent field and not an empty list.

### The contract may contribute, but only as a claim

`agent-ready.yaml`, when present, contributes facts marked `author-declared`, with
`corroboration` recording whether a `declared` or `derived` fact independently
supports the same value. Three rules follow, and they are the point of the
decision:

1. An `author-declared` fact never overwrites a `declared` or `derived` fact. Both
   are retained, and a disagreement becomes `DISCOVERY_FACT_CONFLICT`.
2. A fact whose kind is `author-declared` and whose `corroborated` is `false` is
   visibly uncorroborated in the snapshot, not silently accepted.
3. `discover` runs identically with and without a contract. The contract changes
   which facts become _available_, never which facts become _true_.

Rule 3 is what keeps the Phase 1 benchmark honest, and it is why the contract is
allowed to contribute at all: an existing user's contract is real signal, and
discarding it would make `discover` artificially weak.

### False positives: unknown beats wrong

The governing rule is _unknown beats wrong_, stated in a form that can fail a test:

- A fact may only be emitted if its derivation is a pure function of a bounded,
  enumerated set of filesystem reads. No unbounded traversal, no recursion, no
  content-based inference over source files.
- **No probabilistic, ranked, or best-guess values.** There is no confidence score
  and no "most likely" value anywhere in the snapshot. A heuristic that cannot be
  made accurate enough to be trustworthy is removed rather than shipped with a
  disclaimer.
- **A fact with an empty evidence set is `unknown`, never a default value.** There
  is no fallback to `"npm"`, no default runtime, no assumed layout.
- **Contradiction is itself a fact.** When a `declared` fact and a `derived` fact
  disagree — a `packageManager` field naming one tool beside another tool's
  lockfile — the snapshot retains both values with their evidence and raises
  `DISCOVERY_FACT_CONFLICT`. It does not pick a winner. Choosing is precisely the
  confidently-wrong failure this decision exists to prevent.

  > **Amended by
  > [ADR-0045](0045-package-and-workspace-discovery-semantics.md).** The rule above
  > models contradiction as a single outcome, and the real package domain showed it
  > has two. Two sources of the _same_ kind that disagree remain a conflict with no
  > value. A `declared` claim contradicted by `derived` evidence is instead an
  > _incomplete_ fact: the declaration is carried forward, every contradicting
  > artifact is retained beside it, and no winner is chosen. A conflict model built
  > only on peer comparison cannot express that without either dropping a true claim
  > or promoting an artifact to a declaration. ADR-0045 also amends the corroboration
  > rule that follows, and makes `DISCOVERY_FACT_UNSUPPORTED` reachable. Read it as
  > governing; the rules above are retained because each amendment narrows them.

- **A probe that fails is not a probe that finds nothing.** An unreadable path
  yields `unknown` with `reason: "probe-failed"` and raises `DISCOVERY_PARTIAL`. It
  is never reported as absence, because absence and inaccessibility are different
  claims and conflating them is a false negative of the most dangerous kind.

### Determinism is a property of the output, not an aspiration

Two runs against an unchanged tree must produce byte-identical output. The
implementation is bound by:

- every path in the snapshot is repository-relative; no absolute paths, no host
  names, no user names;
- no timestamps, no durations, no run identifiers, no process IDs;
- every collection is sorted by code-unit order — never `localeCompare`, never
  filesystem iteration order;
- no environment variable influences a value; no network, no clock, no randomness;
- the probe list is a fixed, enumerable, versioned set of paths. Discovery in this
  issue reads a bounded number of root-level paths and does not walk the tree.
  Traversal arrives with package discovery, not before.

### The read budget of this issue

This issue is deliberately the narrow wedge. `discover` probes repository identity,
languages and runtime signals, package-manager signals, and the presence or absence
of a declaration surface (CI workflows, agent instruction files). It does not
enumerate packages, workspaces, commands, module graphs, or ownership. Those are
[#37](https://github.com/AdamEddahmouni/agent-ready/issues/37) through
[#39](https://github.com/AdamEddahmouni/agent-ready/issues/39).

It never writes. It never executes a repository command. It never reads
`node_modules`.

### CLI surface

```text
agent-ready discover [--root <path>] [--json]
```

Three consequences of that surface are decisions, not details:

- **There is no `--write` and no `--force`.** The command is read-only, and the
  absence of a write path is the guarantee rather than a promise. Adding one is a
  separate decision with its own ADR.
- **`discover` requires no contract.** Every shipped command treats
  `CONTRACT_NOT_FOUND` as an error. Here it is a _reported fact_: the snapshot
  states that no contract was found and continues. This inverts an established
  error semantic, which is why it is recorded here rather than left to the
  implementation.
- **`--json` is the primary interface.** The human-readable form is a rendering of
  the same snapshot, not an independent code path, so the two can never disagree.

Warnings do not change the process exit status, consistent with the existing
informational codes `VERIFICATION_NOT_DECLARED` and
`ADAPTER_NOT_YET_IMPLEMENTED`. Exit-code resolution follows the existing
`resolveExitCode` mapping in `src/diagnostics/codes.ts` rather than introducing a
new scheme.

### The three outcomes are distinct

Issue #36 requires that "found nothing", "partially discovered", and "could not
determine" are distinguishable. They are, by construction:

| Situation                                    | `kind`    | `reason`       | Diagnostic                  |
| -------------------------------------------- | --------- | -------------- | --------------------------- |
| Probes ran, no evidence exists               | `unknown` | `no-evidence`  | `DISCOVERY_NO_SIGNALS`      |
| Some probes ran, some could not              | mixed     | `probe-failed` | `DISCOVERY_PARTIAL`         |
| Two sources disagree                         | both kept | `conflict`     | `DISCOVERY_FACT_CONFLICT`   |
| Root missing, unreadable, or not a directory | —         | —              | `DISCOVERY_ROOT_UNREADABLE` |

A repository that genuinely contains none of the probed signals is a valid,
complete, successful snapshot. The diagnostic is informational and the exit status
is success. What is forbidden is a snapshot that is silent about _why_ it is empty.

### Diagnostic codes

New codes use a `DISCOVERY_` prefix, which is a reserved namespace for this command
family. The registry is `src/diagnostics/codes.ts`; the reference is
`docs/specification/diagnostics.md`; both are updated in the implementation, and
[GOVERNANCE.md](../../GOVERNANCE.md) requires the ADR you are reading first.

| Code                         | Severity | Meaning                                                                                                                                                                         |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCOVERY_ROOT_UNREADABLE`  | error    | The root path is missing, is not a directory, or cannot be read. The only fatal condition.                                                                                      |
| `DISCOVERY_PARTIAL`          | warning  | At least one probe could not run. The snapshot is usable but incomplete.                                                                                                        |
| `DISCOVERY_FACT_CONFLICT`    | warning  | A declared fact and a derived fact disagree. Both are retained with evidence.                                                                                                   |
| `DISCOVERY_NO_SIGNALS`       | warning  | Every probe ran and none found evidence. A valid, complete, empty result. Does not fail the command.                                                                            |
| `DISCOVERY_FACT_UNSUPPORTED` | warning  | **Reserved, not currently reachable.** Held for a fact kind outside the four kinds defined here, following the `ADAPTER_NOT_YET_IMPLEMENTED` and `COMMAND_DUPLICATE` precedent. |

[ADR-0045](0045-package-and-workspace-discovery-semantics.md) makes
`DISCOVERY_FACT_UNSUPPORTED` reachable — for a fact whose _shape_ this
implementation does not support, rather than a kind outside the four — and adds
`DISCOVERY_FACT_INCOMPLETE`, `DISCOVERY_WORKSPACE_UNSUPPORTED`, and
`DISCOVERY_LOCKFILE_UNREADABLE`. The four epistemic kinds are unchanged.

> **Corrected in place, not amended.** The `info` entries in the table above
> are not severities the codebase can express. [ADR-0008](0008-diagnostics-and-exit-codes.md)
> fixes `Severity` at `"error" | "warning"`, and the codes emitted as warnings
> are listed once in `WARNING_DIAGNOSTIC_CODES`, which is also what
> `agent-ready explain` reads. Both `DISCOVERY_NO_SIGNALS` and
> `DISCOVERY_FACT_UNSUPPORTED` are therefore emitted as `warning`, and this
> table now says so. "Informational" below always meant _does not fail the
> command_, which remains exactly true: `resolveExitCode` keys on `error`
> severity alone, so a warning is not a non-zero exit. The rows are left
> otherwise as written because the distinction a reader needs is _warning_,
> not _error_ — and that is what the registry, the renderer, and `explain` all
> agree on.

### Snapshot versioning

The snapshot carries its own `schemaVersion`, independent of the v1 contract
`version` field, per the version-taxonomy rule in
[ADR-0040](0040-release-and-version-taxonomy.md). In this issue it is `0`, which by
convention means _unstable and not covered by the pre-1.0 stability promise_ in
[ADR-0009](0009-pre-1.0-stability-policy.md). No field is stable. The published
field-stability statement and the conformance corpus are
[#40](https://github.com/AdamEddahmouni/agent-ready/issues/40), and the benchmark
protocol that will judge whether any of this was worth building is
[#42](https://github.com/AdamEddahmouni/agent-ready/issues/42).

## Consequences

- The declared/derived/author-declared/unknown boundary is enforced by the shape of
  the data, so a later contributor cannot quietly change a field's epistemic status
  without changing a type.
- `unknown` is representable, which is what makes "silence is not an acceptable
  answer" testable instead of aspirational.
- The Phase 1 benchmark compares like with like, because a hand-written contract
  cannot enter the model arm as a discovered fact.
- The snapshot is larger and less pleasant to read by hand than a plain object. That
  is the accepted cost, and it is paid once rather than by every future consumer.
- The read budget is small enough that discovery cannot become a slow, unbounded
  repository scan — and small enough that its determinism is easy to test.
- `discover` is a twelfth command. Per
  [ADR-0042](0042-v1-freeze-and-parallel-vnext-surface.md) this is additive surface
  on a parallel vNext track; the v1 contract, the eleven shipped commands, and the
  adapter-output corpus are untouched. Per
  [ADR-0043](0043-core-posture-and-integration-quarantine.md) it is entirely
  offline: no network, no API key, and it must work with no `agent-ready.yaml`
  present.
- Rejecting confidence scores means some real signals will not ship in this issue.
  That is intended. A wrong value with a disclaimer attached is still a wrong value.

## Reconsideration trigger

Reconsider the four-kind boundary if a future probe genuinely cannot be expressed as
`declared`, `derived`, or `unknown` — in which case the honest fix is a new kind with
its own semantics, not a confidence score bolted onto `derived`.

Reconsider the read budget when package discovery lands, since the bounded
root-level probe set must then become a bounded but recursive walk. That change
alters the determinism argument and needs its own decision. **Done** — see
[ADR-0045](0045-package-and-workspace-discovery-semantics.md) §7 and §8, which
bounds the walk, fences it to the repository root, and adds one read-only
`listDirectory` capability to the shared `FileSystem` boundary.

Reconsider the no-write rule if a consumer needs discovery persisted. Persistence is
[#41](https://github.com/AdamEddahmouni/agent-ready/issues/41) and will be decided on
its own terms, not inherited from here.

Reconsider the contract-contribution rule if the Phase 1 benchmark shows the
`author-declared` channel materially distorts results. Until it does, the
conservative reading — a claim is a claim — holds.
