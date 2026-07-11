# ADR-0040: Release and version taxonomy

## Status

Accepted

## Context

Agent-Ready uses several independent identifiers: npm package releases,
Git tags, npm dist-tags, the `agent-ready.yaml` contract schema version, the
adapter-output compatibility corpus version, roadmap milestones, ADRs, and
GitHub issues. Treating these as one "version" made release documentation
ambiguous and left published previews described as "Unreleased."

## Decision

- Package versions follow Semantic Versioning and Git tags use the same value
  with a leading `v`.
- Public feature previews use `alpha.N`, public stabilization previews use
  `beta.N`, feature-frozen candidates use `rc.N`, and stable releases have no
  prerelease suffix.
- npm's `next` tag points to the current prerelease; `latest` points only to
  stable releases.
- Contract schema versions (`version: 1`) and adapter corpus versions
  (`adapter-output/v1`) remain independent compatibility identifiers.
- Roadmap milestones (for example `M1`), ADR identifiers, and GitHub issue
  numbers are planning and decision records, never package-release versions.
- Every published release receives a dated CHANGELOG heading. The next
  unreleased package version alone may use the `Unreleased` label.

## Consequences

Maintainers can state precisely whether they mean a package, installation
channel, contract format, fixture format, planning milestone, or work item.
Consumers can select a stable release through `latest` or opt into previews
through `next` without relying on ambiguous prose.

## Reconsideration trigger

Revisit if Agent-Ready becomes a multi-package workspace, introduces a second
published compatibility corpus, or adopts a staged npm release flow.
