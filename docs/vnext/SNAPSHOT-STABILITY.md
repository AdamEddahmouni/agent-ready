# Discovery Snapshot Format 1 — stability contract

This document is the **consumer-facing** compatibility contract for the JSON
written to stdout by `agent-ready discover --json`. It does not govern the npm
package version, `agent-ready.yaml` contract version 1, human-readable discover
output, or any other surface.

The decision record is
[ADR-0048](../decisions/0048-discovery-snapshot-stability-and-conformance.md).
Empirical evidence for classifications lives in
[the corpus study](../research/snapshot-v1-corpus-study.md).

## Three tiers

| Tier                                   | Meaning                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stable**                             | A consumer may rely on presence, type, meaning, and canonical ordering where stated. Changing a stable field requires a new `snapshotVersion`.                                                    |
| **Provisional**                        | Deterministic and schema-valid today, but **compatibility is not promised**. Heuristics, counts, and vocabulary may change within Format 1 only when this document says they are open/extensible. |
| **Not part of snapshot compatibility** | Deliberately outside this contract (human CLI text, diagnostic prose, npm SemVer, contract v1 schema).                                                                                            |

**Do not read “Discovery Snapshot Format 1” as “everything in the document is stable.”**
Stability is **field-specific**. Any field not listed as stable below is provisional
by omission.

## Snapshot envelope

| Surface             | Status | Guarantee                                                               | Bump when                        |
| ------------------- | ------ | ----------------------------------------------------------------------- | -------------------------------- |
| `snapshotVersion`   | Stable | Required integer; Format 1 is always `1`.                               | Any semantic format change.      |
| `ok`                | Stable | Always `true` in a snapshot; fatal failures use the CLI error envelope. | Never within v1.                 |
| `root`              | Stable | Always `"."`; anchor for repository-relative paths.                     | Never within v1.                 |
| `facts`             | Stable | Object keyed by fact id; each entry’s `id` equals its key.              | Key set or id vocabulary change. |
| `graph`             | Stable | Present; `null` only when the graph could not be built at all.          | Container semantics change.      |
| `summary`           | Stable | Present.                                                                | Required fields change.          |
| `diagnostics`       | Stable | Present (may be empty).                                                 | Container removed.               |
| Top-level field set | Stable | No undeclared top-level fields in v1 output.                            | New required top-level field.    |

## Fact model

| Surface                       | Status               | Guarantee                                                                       | Bump when                           |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Fact `id`                     | Stable               | Fixed vocabulary + `repository.packageManager.<scope>` template.                | Id scheme change.                   |
| `kind`                        | Stable (closed enum) | `declared`, `derived`, `author-declared`, `unknown`.                            | New kind value.                     |
| `reason`                      | Stable (closed enum) | Present iff `unknown`; values `no-evidence`, `probe-failed`, `not-probed`.      | New reason value.                   |
| `value`                       | Stable               | Present iff the fact asserts one; absent on `unknown` and on conflict.          | Meaning of presence changes.        |
| `claims[]`                    | Stable               | Every claim retained verbatim.                                                  | Claims dropped or merged.           |
| `corroboration`               | Stable               | `kinds`, `authorDeclared`, `corroborated` meaning per ADR-0045.                 | Semantics of `corroborated` change. |
| `contradictedBy`              | Stable               | Present iff **incomplete**; absent on conflict.                                 | Discriminator rules change.         |
| Claim `evidence[]`            | Stable               | `source` repository-relative; optional `pointer`, `detail`.                     | Path rules change.                  |
| Epistemic discriminated union | Stable               | Unknown → no value; conflict → no value; incomplete → value + `contradictedBy`. | Shapes merged or collapsed.         |

## Package, workspace, commands

| Surface                              | Status          | Guarantee                                                              | Bump when                         |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------- | --------------------------------- |
| Package `path`                       | Stable          | Canonical repository-relative identity.                                | Identity rule changes.            |
| `nameStatus`, `manifestStatus`       | Stable (closed) | As in ADR-0048 §5.                                                     | New enum value.                   |
| `scriptsStatus`                      | Stable (closed) | Includes `unobservable` vs `absent` distinction.                       | Enum or meaning change.           |
| `repository.commands` inventory      | Stable          | Every declared script, verbatim body, declaring package.               | Inventory filtered or altered.    |
| `PackageCommandsEntry` shape         | Stable          | Fields per ADR-0048 §5.                                                | Required field change.            |
| Package/workspace **value** payloads | Provisional     | Correct today; extra fields may appear.                                | N/A (provisional).                |
| Workspace scope completeness         | Provisional     | Manifests outside declarations are invisible (see #37 / nestjs study). | N/A until bump if boundary moves. |

## Graph structure and provenance

| Surface                                                            | Status             | Guarantee                                                                                         | Bump when                            |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `graph.nodes` / `graph.edges`                                      | Stable             | Each entry has `id`, `kind`, `provenance`.                                                        | Container rule change.               |
| `provenance.source`                                                | Stable             | Repository-relative, `/`-separated, never absolute.                                               | Path rules change.                   |
| `provenance.line`                                                  | Stable             | Required integer, **1-based**, within cited file.                                                 | Line basis change.                   |
| `provenance.column`, `endLine`, `endColumn`, `pointer`             | Provisional        | Optional; absence is meaningful.                                                                  | N/A.                                 |
| `graph.sourceUniverse` container                                   | Stable             | Present with `strategy`, `files`, `truncated`.                                                    | Container removed.                   |
| `sourceUniverse.files`, `strategy`, `resolutionMode`, `extensions` | Provisional        | **Lower bound** on source; may include committed build output (see known-inaccurate corpus case). | N/A.                                 |
| `graph.ownership` container + `status`                             | Stable             | Policy surface present.                                                                           | Shape change.                        |
| CODEOWNERS pattern subset / `unsupportedPatterns`                  | Provisional        | Unsupported rules surfaced, not approximated.                                                     | N/A.                                 |
| Node `ownership.status`                                            | Stable (closed)    | `owned` / `unowned`; unowned carries no owners.                                                   | Enum or shape change.                |
| Resolved import edge                                               | Stable             | Resolved → has target; unresolved → `reason`, no target.                                          | Invariant change.                    |
| `graph.nodes[].kind`, `graph.edges[].kind`                         | Open vocabulary    | Documented values today; new kinds allowed without bump if only adding kind strings.              | Consumer must not exhaustive-switch. |
| Graph node / edge `id` spelling                                    | Provisional        | Deterministic today; scheme may gain prefixes.                                                    | N/A.                                 |
| Import `resolution.status`, `UnresolvedReason`                     | Open / provisional | Vocabulary grows (e.g. `target-not-readable`).                                                    | N/A.                                 |
| `graph.complete`, `graph.truncatedBy`                              | Stable             | Present; incomplete graph has diagnostics.                                                        | Meaning change.                      |

## Dependencies

| Surface                                          | Status          | Guarantee                             | Bump when        |
| ------------------------------------------------ | --------------- | ------------------------------------- | ---------------- |
| Declaration shape (class, specifier, provenance) | Stable          | Declared vs resolved split preserved. | Shape change.    |
| `resolution.status`, `resolvedVersion`           | Provisional     | Per adapter (pnpm/npm/Yarn/v1).       | N/A.             |
| `DependencyClass`                                | Stable (closed) | `runtime`, `dev`, `peer`, `optional`. | New class value. |

## Summary and diagnostics

| Surface                                              | Status                  | Guarantee                                                                     | Bump when        |
| ---------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- | ---------------- |
| `summary.complete`                                   | Stable                  | Present; semantics per ADR-0044.                                              | Meaning change.  |
| `summary.facts`, `known`, `unknown`, `conflicts`     | Provisional             | Derivable counts.                                                             | N/A.             |
| `diagnostics[].code`                                 | Stable (open tolerance) | `DISCOVERY_*` registry; codes not renamed/renumbered; tolerate unknown codes. | Rename/renumber. |
| `diagnostics[].severity`                             | Stable (closed)         | `error`, `warning`, `info`.                                                   | New severity.    |
| `diagnostics[].detail`, `metadata`, ordering, volume | Provisional             | Prose and volume unbounded.                                                   | N/A.             |

## Command roles and verification

| Surface                                                   | Status             | Guarantee                                                                                          | Bump when                |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------ |
| Command inventory (`repository.commands`)                 | Stable             | See above.                                                                                         | —                        |
| `verificationEntrypoints[].script`, `body`, `packagePath` | Stable             | Verbatim declaration linkage.                                                                      | Shape change.            |
| `verificationEntrypoints[].role`                          | Provisional (open) | Four-role grammar; real repos use `check`, `format`, etc.                                          | N/A (#38).               |
| `CommandRole` enum in schema                              | Closed today       | `test`, `build`, `lint`, `typecheck` only in schema; extension needs bump if closed list enforced. | New role in closed list. |

## Enum policy

| Vocabulary                                                                                                                                                                    | Policy                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `FactKind`, `UnknownReason`, `ScriptsStatus`, `PackageNameStatus`, `ManifestStatus`, `DependencyClass`, `ImportSyntax`, ownership surface status, graph item epistemic        | **Closed** — new value → consider `snapshotVersion` bump.                                              |
| `GraphNodeKind`, `GraphEdgeKind`, import/dependency resolution status, `UnresolvedReason`, `CommandRole` (practical use), `resolutionMode` (string, not enumerated in schema) | **Open / extensible** — consumers must default-branch.                                                 |
| `sourceUniverse.strategy`                                                                                                                                                     | Closed in schema (`tsconfig`, `bounded-traversal`, `mixed`); selection **contents** still provisional. |

`resolutionMode` is intentionally a **plain string** in the schema so TypeScript
module-resolution labels are not frozen as a closed list.

## Array ordering

| Arrays                                                                                               | Ordering guarantee                                                   |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `graph.nodes`, `graph.edges`, fact map keys, evidence, `sourceUniverse.files`, tsconfigs, extensions | **Canonical** — code-unit sort by stated key; byte comparison valid. |
| `workspace.declarations[].patterns`                                                                  | **Declaration order** — not sorted.                                  |
| Other arrays (e.g. claims when kinds overlap)                                                        | Deterministic but **unspecified** for compatibility.                 |

## Identity

| Identity      | Status               | Rule                                          |
| ------------- | -------------------- | --------------------------------------------- |
| Fact id       | Stable               | `FACT_IDS` + scoped package-manager template. |
| Package       | Stable               | Repository-relative path.                     |
| Graph node id | Provisional spelling | Deterministic, no UUID/hash/absolute path.    |
| Edge id       | Provisional          | Declaration-site identity.                    |

## Schema vs semantics

| Enforced by JSON Schema                                                                                                                | Enforced by implementation tests / corpus                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshotVersion === 1`, discriminated fact unions, graph edge target rules, provenance path shape, 1-based line type, ownership shape | Byte-identical conformance corpus, checkout-independent output, merge semantics (conflict vs incomplete), graph provenance “file was read”, stable projection in `stableProjection()` |

A document that validates but fabricates citations is **not** conforming; the corpus
checks behaviour.

## Reconsideration triggers (#37–#39)

| Topic                            | Evidence                                                      | Classification                                                         |
| -------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Closed-world package scope (#37) | nestjs: many `sample/*` manifests invisible                   | Boundary **stable** as documented; **extent provisional**.             |
| Verification role grammar (#38)  | 20–73% scripts without role; real `check`/`format` surfaces   | Role projection **provisional**; inventory **stable**.                 |
| Fallback source universe (#39)   | lodash `dist/`, webpack committed `lib/` via tsconfig default | Universe **provisional**; known-inaccurate corpus case pins behaviour. |
| Lockfile adapters                | Yarn unsupported, npm v1 unsupported — honest                 | Resolution **provisional**; declarations **stable**.                   |

## Changing the format

1. Any change to **stable** fields → new `snapshotVersion` and new schema directory.
2. Regenerating `conformance/discovery/v1/*/expected.json` → review against this document; see [conformance README](../../conformance/discovery/README.md).
3. Editorial schema description-only edits that do not change accepted documents do not require a snapshot bump (ADR-0048 §11).

## Related artifacts

- Schema: [`schemas/discovery/snapshot-v1.schema.json`](../../schemas/discovery/snapshot-v1.schema.json)
- Conformance corpus: [`conformance/discovery/v1/`](../../conformance/discovery/v1/)
- Commands: `pnpm conformance:check` (CI), `pnpm conformance:update` (maintainer only)
