# ADR-0030: Immutable GitHub Action dependency pins

## Status

Accepted. All third-party `uses:` references in `action.yml` and
`.github/workflows/` are SHA-pinned. `scripts/check-action-pins.mjs` enforces
the rule in CI, and Dependabot tracks GitHub Actions updates.

## Context

Major-version action tags are mutable. A compromised upstream tag could alter
the code executed by CI or by downstream repositories using Agent-Ready's
composite action. Before encouraging public reuse, dependencies must resolve to
reviewed immutable commits.

## Decision

- Pin every third-party action to a full lowercase 40-character commit SHA.
- Retain a trailing version comment for human readability and Dependabot
  context.
- Permit local `uses: ./...` and `docker://` references without a SHA.
- Scan `action.yml` and every YAML file in `.github/workflows/` on CI. Any
  mutable external reference fails the quality gate.
- Keep Dependabot's `github-actions` ecosystem enabled so pin updates arrive as
  reviewable pull requests.

## Alternatives considered

- **Major tags plus Dependabot:** rejected because update convenience does not
  remove mutability between reviews.
- **Allowlist trusted publishers:** rejected; publisher identity does not make
  a mutable ref immutable.
- **Third-party pinning linter:** rejected for now because the required rule is
  small and a local zero-dependency checker is auditable.

## Consequences

Action upgrades require explicit SHA changes, usually via Dependabot. Reviewers
can associate each pin with the version comment. CI prevents accidental
reintroduction of floating tags.

## Reconsideration trigger

Revisit if GitHub provides repository-native immutable action policies that
fully cover composite actions and workflow files.
