# ADR-0027: npm package publication and release strategy

## Status

Accepted. Implemented for the v0.4 line by `package.json`,
`.github/workflows/publish.yml`, `.github/workflows/release.yml`,
`scripts/package-smoke.mjs`, and `scripts/extract-release-notes.mjs`.
The external first-publication and Trusted Publisher setup steps remain
release-time operations.

## Context

ADR-0016 deliberately made the composite GitHub Action build from source so
adopters did not depend on an npm release. That decision did not prohibit npm
as an additional distribution channel, but ROADMAP.md retained automated
publication as a phase non-goal. Path A is complete and the CLI is now mature
enough that `npm install -D agent-ready` should be the primary onboarding path.

Publishing creates a supply-chain boundary: a tag, source commit, package
contents, registry identity, and generated artifact must agree. The first
publication also cannot use npm Trusted Publishing because npm requires the
package to exist before a publisher relationship can be configured.

## Decision

- Publish the unscoped public package `agent-ready`; the name was verified
  available on 2026-07-10.
- Keep `package.json#files` as the package-content allowlist. Build and run the
  package smoke test before every publish.
- Publish only from immutable `v*` tags whose name exactly matches
  `package.json#version`.
- Use npm Trusted Publishing with GitHub Actions OIDC for normal releases,
  provenance enabled, Node 24, and npm 11.5.1 or newer.
- Bootstrap the package once with a short-lived granular `NPM_TOKEN`, then
  configure the Trusted Publisher and immediately delete and revoke the token.
- Publish prereleases under the `next` dist-tag and stable versions under
  `latest`.
- After publication, wait for registry propagation, install the exact version
  in a clean directory, verify `--version`, and validate the minimal example.
- Create a GitHub Release from the same tag. Release notes come from the exact
  CHANGELOG section; assets include the npm tarball and a standalone adapter
  compatibility-corpus archive.
- Keep the composite action build-from-source. npm publication is additive,
  not a new runtime dependency for action consumers.

This ADR explicitly reopens the earlier automated-publication non-goal for the
package and release workflows while preserving ADR-0016's independence.

## Alternatives considered

- **Manual local publishing for every release:** rejected because it weakens
  reproducibility, provenance, and tag/package consistency.
- **A permanent npm automation token:** rejected because a long-lived secret
  has broader compromise and rotation risk than OIDC.
- **Scoped package name:** rejected for the preview because the unscoped name
  matches the CLI and is available; reconsider if namespace ownership changes.
- **Make npm mandatory for the composite action:** rejected; source builds are
  a useful independent distribution path.

## Consequences

Release tags become operationally significant and must never be moved.
Publishing requires the repository to be public for provenance. The first
release has a documented one-time token bootstrap; later releases contain no
stored publish credential. A failed post-publish smoke test cannot retract an
immutable npm version, but it blocks treating the release as successful and
forces a patch release.

## Reconsideration trigger

Revisit if npm supports Trusted Publisher configuration before first publish,
if staged publishing becomes the default release path, or if the package moves
to an organization scope.
