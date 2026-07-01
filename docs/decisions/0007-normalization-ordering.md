# ADR-0007: Normalization ordering policy

## Status

Accepted

## Context

Determinism requires that two contracts an author would consider
"the same" (e.g. commands listed in a different order in the YAML file)
normalize to identical output, while contracts where order is
semantically meaningful (e.g. the sequence of verification steps) must
preserve that order.

## Alternatives considered

- Sort everything alphabetically (simplest rule, but destroys meaningful
  ordering in `verification.required`).
- Preserve declaration order everywhere (simplest to implement, but two
  equivalent contracts with commands declared in different order would
  normalize differently, failing the "remain stable for equivalent
  contracts" requirement).
- A field-by-field policy based on whether order is semantically
  meaningful for that field.

## Decision

Per-field policy, chosen by asking "does the author's declared order mean
anything beyond happening to be the order they typed it in?":

| Field                               | Policy                        | Rationale                                                                                                                    |
| ----------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `commands`                          | Sorted alphabetically by name | An unordered set of named commands; declaration order is incidental to how YAML mappings happen to preserve insertion order. |
| `environment.runtimes`              | Sorted alphabetically by name | Same reasoning as `commands`.                                                                                                |
| `paths.protected/generated/ignored` | Sorted alphabetically         | Each category is a set of patterns; order does not affect matching semantics.                                                |
| `adapters`                          | Sorted alphabetically by name | An unordered set of declarations.                                                                                            |
| `verification.required`             | Declaration order preserved   | Represents an ordered sequence of verification steps; a future verification-execution phase would run these in this order.   |
| `instructions.sources`              | Declaration order preserved   | Represents documents that may later be concatenated or referenced in order when generating downstream instructions.          |

## Consequences

- Two contracts that declare the same commands, paths, runtimes, or
  adapters in a different order produce byte-identical normalized output
  (verified by `tests/unit/normalize.test.ts`).
- Reordering `verification.required` or `instructions.sources` is a
  meaningful change and is preserved as such.

## Reconsideration trigger

If a future phase gives `paths` categories or `adapters` an
order-sensitive meaning (e.g. precedence between overlapping patterns),
this table must be revisited for that field specifically.
