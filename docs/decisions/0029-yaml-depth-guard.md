# ADR-0029: YAML nesting-depth guard

## Status

Accepted. Implemented in `src/contract/parseYaml.ts` with diagnostic
`YAML_NESTING_TOO_DEEP` and adversarial unit coverage.

## Context

ADR-0003 bounded contract bytes and YAML alias expansion, but a small,
non-aliased document can still contain enough nested mappings/sequences to
stress parser conversion or the JavaScript call stack.

## Decision

- Measure YAML AST depth after syntax/duplicate-key parsing and before `toJS`.
- Use an iterative stack rather than recursion so the guard cannot itself
  overflow on adversarial input.
- Default to a maximum depth of 100. Expose `ParseYamlOptions.maxDepth` for
  embedding/tests while the CLI uses the default.
- Count the root node as depth 1; pair wrappers do not add a level.
- Reject excess depth with `YAML_NESTING_TOO_DEEP`, including observed and
  configured depths as non-sensitive metadata.

## Alternatives considered

- **Rely on the 1 MB byte cap:** rejected because depth and byte size are
  different resource dimensions.
- **Traverse the converted JS value:** rejected because conversion is the
  operation the guard must protect.
- **Recursive AST walk:** rejected because adversarial depth can overflow the
  guard itself.

## Consequences

Ordinary contracts are far below the limit. Pathological contracts now fail
deterministically before conversion. Embedders may choose a lower bound but
should not raise it without accepting the resource risk.

## Reconsideration trigger

Revisit if the YAML library gains a native pre-conversion depth limit or valid
real-world contracts approach depth 100.
