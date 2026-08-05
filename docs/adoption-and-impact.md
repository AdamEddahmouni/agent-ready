# Adoption and Ecosystem Impact

This page records **verifiable** adoption and impact evidence for
Agent-Ready. It does not treat download counts or maintainer-owned
integrations as confirmed external adoption, and it does not make
unsupported claims about ecosystem position.

Every fact here carries one of these classifications:

- **Verified** — directly supported by public evidence (a link, a live
  registry query, or a reproducible command).
- **Derived** — calculated from verified evidence.
- **Maintainer-reported** — stated by the maintainer but not
  independently established.
- **Planned** — intended future work.
- **Unknown** — not yet established.
- **Not applicable** — the metric does not apply.
- **Not claimed** — deliberately excluded because evidence is
  insufficient.

## Status

Agent-Ready is an **early-stage open-source developer tool under active
development** by a single maintainer. The contract schema and CLI are
stable enough for evaluation and daily use (pre-1.0; current stable
release `0.6.1`, published with a GitHub-verified signed tag), but the
project has **no confirmed external
adopters** yet and makes no claim otherwise.

This page exists so that anyone evaluating Agent-Ready — a potential
adopter, contributor, or funder — can see exactly what is and is not
demonstrated today.

## Project Purpose

**The problem.** AI coding agents are becoming part of everyday software
development, but most repositories still have no standard way to explain
how agents should work:

- Agent instructions are fragmented across READMEs, contributor docs,
  tool-specific rule files (`.cursorrules`, `CLAUDE.md`, `AGENTS.md`,
  Copilot/Gemini files), hidden prompts, and repeated chat messages.
- Repository commands and restrictions are repeated in each of those
  places and drift apart.
- Verification is inconsistent: there is no durable record that work was
  actually done.
- Maintainers lack a durable, machine-checkable contract for what agents
  may and may not do in their repository.
- Vendor-specific instruction files can drift apart from each other and
  from the repository's real state.

**Agent-Ready's response** is one schema-validated repository contract
(`agent-ready.yaml`) plus a deterministic CLI that:

- Provides a single source of truth for commands, environment,
  restrictions, instructions, and verification requirements.
- Validates the contract deterministically against a strict JSON Schema.
- Enforces protected-path rules against real Git changes.
- Generates agent instruction files (AGENTS.md, CLAUDE.md,
  .cursorrules, Copilot instructions, Gemini instructions) from one
  contract.
- Executes the declared verification pipeline and records completion
  evidence.
- Makes **no required LLM calls**, requires **no API keys**, and needs
  **no network access** for normal validation.

## Public Distribution

| Fact                      | Value                                                                                      | Classification                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| GitHub repository         | [AdamEddahmouni/agent-ready](https://github.com/AdamEddahmouni/agent-ready)                | Verified (public, queried 2026-08-04)                                            |
| npm package               | [`@adameddahmouni/agent-ready`](https://www.npmjs.com/package/@adameddahmouni/agent-ready) | Verified (npm registry `latest` = `0.6.1`, queried 2026-08-05)                   |
| Current published version | `0.6.1`                                                                                    | Verified (npm `latest` dist-tag and GitHub release `v0.6.1`, checked 2026-08-05) |
| Repository source version | `0.6.1`                                                                                    | Verified (package.json on `main`, checked 2026-08-05)                            |
| Signed release tag        | `v0.6.1`, GitHub-verified SSH signature                                                    | Verified (GitHub tag object `verification.verified = true`, 2026-08-05)          |
| License                   | Apache-2.0                                                                                 | Verified (LICENSE file, GitHub metadata)                                         |
| First public release      | `v0.1.0` (2026-07-06)                                                                      | Verified (GitHub release date)                                                   |
| Latest public release     | `v0.6.1` (2026-08-05)                                                                      | Verified (GitHub release date)                                                   |
| Supported runtime         | Node.js `>=20.0.0`                                                                         | Verified (package.json `engines`)                                                |     | Installation command | `npm install --save-dev @adameddahmouni/agent-ready` | Verified (package exists on npm; command matches README and adoption guide) |

## Current Metrics

**Verification date: 2026-08-05.**

All values below were read directly from the GitHub REST API, the npm
registry API, or reproducible local commands on that date. They change
over time; re-verify before quoting them anywhere.

| Metric                                     | Value                                     | Classification | Notes                                                                |
| ------------------------------------------ | ----------------------------------------- | -------------- | -------------------------------------------------------------------- |
| GitHub stars                               | 1                                         | Verified       | —                                                                    |
| GitHub forks                               | 0                                         | Verified       | —                                                                    |
| Listed contributors                        | 2 (`AdamEddahmouni`, `dependabot[bot]`)   | Verified       | `dependabot[bot]` is automation, not a person                        |
| GitHub releases                            | 11                                        | Verified       | `v0.1.0` through `v0.6.1`, including prereleases                     |
| npm weekly downloads                       | 12 (rolling 7 days, queried 2026-08-05)   | Verified       | See download-count warning below                                     |
| npm monthly downloads                      | 955 (rolling 30 days, queried 2026-08-05) | Verified       | See download-count warning below                                     |
| GitHub dependent repositories              | Unknown                                   | Unknown        | GitHub code-search API requires authentication for this query        |
| npm dependent packages                     | Unknown                                   | Unknown        | No reliable public API for reverse dependencies was verified         |
| Externally owned public integrations       | None                                      | Not claimed    | No third-party repository using Agent-Ready has been identified      |
| Externally submitted merged pull requests  | None                                      | Not claimed    | All merged PRs are maintainer-authored or automated dependency bumps |
| Externally submitted issues or discussions | None                                      | Not claimed    | All open GitHub items are PRs, not issues                            |

> **Warning about download counts.** Registry download counts include
> CI pipelines, automated installation scripts, caching and mirroring
> infrastructure, local development activity, and repeated downloads of
> the same package. They do **not** equal unique users and are **not**
> evidence of adoption. Agent-Ready does not report downloads as users.

## Implementations

This section separates canonical, maintainer-owned, and external
implementations. Maintainer-owned projects are **never** presented as
external adoption.

### Canonical implementation

| Repository                                                                                    | Owner classification     | Integration scope                                                                                       | Evidence                                                                                                                                                                                                                       | Last verified |
| --------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| [AdamEddahmouni/agent-ready](https://github.com/AdamEddahmouni/agent-ready) (this repository) | Canonical (self-hosting) | Full: `agent-ready.yaml` contract, validate, analyze, verify dry-run, composite-action dogfooding in CI | `agent-ready validate --config agent-ready.yaml` passes; `agent-ready analyze` checks 4 declared instruction sources with no findings; `agent-ready verify` dry-run lists 6 verification steps. Reproduced locally 2026-08-04. | 2026-08-04    |

### Maintainer-owned implementations

| Repository      | Owner classification | Integration scope | Evidence                                                                              | Last verified |
| --------------- | -------------------- | ----------------- | ------------------------------------------------------------------------------------- | ------------- |
| None documented | Maintainer-owned     | —                 | No public repository owned by the maintainer is currently known to adopt Agent-Ready. | 2026-08-04    |

### External implementations

| Repository | Owner classification | Integration scope | Evidence                                                                                                                                         | Last verified |
| ---------- | -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| None       | External             | —                 | No independently owned repository with public evidence of Agent-Ready adoption has been identified. This is a statement of absence, not a claim. | 2026-08-04    |

## External Validation

No external validation is currently claimed. Specifically, as of
2026-08-05 there are:

- No externally submitted issues or bug reports.
- No externally submitted feature requests.
- No externally submitted pull requests.
- No public technical discussions referencing Agent-Ready.
- No third-party implementation reports.
- No testimonials with source links.
- No independent package dependents verified.

All 8 open items in the repository's GitHub issue tracker are open pull
requests (mostly automated dependency bumps), not issues.

## Maintainer Responsibilities

Adam Eddahmouni is currently the sole maintainer and is responsible for:

- **Specification design** — the `agent-ready.yaml` contract shape and
  evolution policy.
- **Schema maintenance** — `schemas/v1/agent-ready.schema.json`.
- **CLI development** — all eleven commands and the public API.
- **Adapter development** — the five agent-instruction renderers.
- **Documentation** — specification docs, ADRs, roadmap, threat model.
- **Testing** — 557 passing unit/integration tests across 41 files (plus 2 skipped).
- **Release management** — npm publication, GitHub Releases, changelog.
- **Issue triage** — currently minimal by volume; no external issue
  traffic yet.
- **Compatibility maintenance** — the versioned adapter-output
  compatibility corpus.
- **Security response** — privately reported vulnerabilities via
  GitHub's private vulnerability reporting.

## Ecosystem Relevance

Agent-Ready proposes a **vendor-neutral repository contract**: a single
source of truth that any coding agent can consume, instead of separate
instruction files maintained per tool. This is the project's core value
proposition.

It is important to distinguish:

- **Current demonstrated value** — the contract validates, generates
  consistent instruction files across five adapter formats, enforces
  protected paths, executes and records verification, and does all of
  this locally with no LLM calls, API keys, or network access. This is
  demonstrated by the working CLI and this repository's own contract.
- **Emerging potential** — a standard is only as useful as its adoption.
  If repositories adopt `agent-ready.yaml`, maintainers gain a single
  place to express agent constraints, and agent vendors gain a
  structured contract to consume. This potential is real but
  **unproven**: no external adoption exists yet.
- **Future goals** — reaching v1.0 with real external adopters (see
  [ROADMAP-TO-1.0.md](../ROADMAP-TO-1.0.md)), framework-specific example
  repositories, and ecosystem tooling. These are goals, not current
  facts.

Agent-Ready does **not** claim that the ecosystem already depends on it.

## Evidence Log

| Date       | Evidence                                            | Classification                     | Source                                                   | Notes / limitations                                                                                                                                         |
| ---------- | --------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-04 | npm `latest` dist-tag = `0.6.0`                     | Verified                           | `npm view @adameddahmouni/agent-ready dist-tags --json`  | Matches `package.json` and git tag `v0.6.0`                                                                                                                 |
| 2026-08-04 | GitHub repo public; 1 star; 0 forks                 | Verified                           | GitHub REST API (`/repos/AdamEddahmouni/agent-ready`)    | Snapshot; changes over time                                                                                                                                 |
| 2026-08-04 | 2 listed contributors                               | Verified                           | GitHub REST API (`/contributors`)                        | One is `dependabot[bot]` automation                                                                                                                         |
| 2026-08-04 | 10 releases, latest `v0.6.0` (2026-07-12)           | Verified                           | GitHub REST API (`/releases`)                            | Includes prereleases                                                                                                                                        |
| 2026-08-04 | npm downloads: 12 weekly / 955 monthly              | Verified                           | npm downloads API                                        | Not users; see warning above                                                                                                                                |
| 2026-08-04 | No externally submitted issues/PRs                  | Verified                           | GitHub REST API (`/issues?state=open`)                   | All 8 items are PRs                                                                                                                                         |
| 2026-08-04 | Self-hosting works (validate/analyze/verify)        | Verified                           | Local commands on `main` @ `286286a`                     | `doctor` reports `PACKAGE_MANAGER_UNAVAILABLE` for pnpm in this local shell only; CI runs `doctor` via the dogfood-action matrix, which was not re-run here |
| 2026-08-05 | Published signed `v0.6.1` release to npm and GitHub | Distribution and release integrity | GitHub Release, npm registry and workflow evidence       | Signed tag GitHub-verified; npm provenance present (2 attestations); clean consumer installation verified                                                   |
| 2026-08-05 | npm `latest` dist-tag = `0.6.1`                     | Verified                           | `npm view @adameddahmouni/agent-ready dist-tags --json`  | Published via `npm publish --provenance` from the tag-triggered workflow                                                                                    |
| 2026-08-05 | 11 releases, latest `v0.6.1` (2026-08-05)           | Verified                           | GitHub REST API (`/releases`)                            | Includes prereleases                                                                                                                                        |
| 2026-08-04 | 557 tests passing / 2 skipped across 41 files       | Verified                           | `pnpm test` on `sprint/claude-oss-readiness` @ `f220702` | Re-measured after rebasing onto `origin/main` (v0.6.1)                                                                                                      |
