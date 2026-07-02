# Architecture Decision Records

This directory records consequential technical decisions made during the
Phase 0/1/2 foundation of Agent-Ready, in lightweight MADR-style format
(context, alternatives, decision, consequences, reconsideration trigger).

An ADR is warranted for a decision that is hard to reverse, affects the
public contract or CLI surface, or would otherwise not be obvious to a
new contributor reading the code. Trivial formatting or naming choices do
not need one — see `GOVERNANCE.md` for the full criteria.

| ADR                                               | Title                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| [0001](0001-runtime-and-distribution.md)          | Runtime, module format, and package shape             |
| [0002](0002-json-schema-design.md)                | JSON Schema draft, identity, and compatibility policy |
| [0003](0003-yaml-parsing-safety.md)               | YAML parser selection and safety configuration        |
| [0004](0004-repository-and-contract-discovery.md) | Repository root and contract discovery                |
| [0005](0005-path-and-glob-semantics.md)           | Path and glob semantics                               |
| [0006](0006-command-representation.md)            | Command representation and safety boundary            |
| [0007](0007-normalization-ordering.md)            | Normalization ordering policy                         |
| [0008](0008-diagnostics-and-exit-codes.md)        | Diagnostic shape, error codes, and exit-code mapping  |
| [0009](0009-pre-1.0-stability-policy.md)          | Pre-1.0 stability and compatibility policy            |
| [0010](0010-generate-write-boundary.md)           | Write boundary for `agent-ready generate`             |
| [0011](0011-adapter-rendering-design.md)          | Adapter rendering and generated-content design        |
