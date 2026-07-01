# ADR-0001: Runtime, module format, and package shape

## Status

Accepted

## Context

Agent-Ready needs a Node.js version policy, a module format (ESM vs
CommonJS vs dual), and a decision on whether the initial implementation
needs a multi-package workspace.

## Alternatives considered

- **Node version**: support back to Node 18 (previous LTS) vs. Node 20+
  only.
- **Module format**: ESM-only, CommonJS-only, or dual-publish (both,
  via conditional exports and two build outputs).
- **Package shape**: a pnpm workspace with separate `core`, `cli`, and
  `schema` packages, vs. a single package.

## Decision

- **Minimum supported Node.js version: 20.0.0** (current active/maintenance
  LTS at time of writing). Node 18 reached its LTS timeline boundary close
  to this project's start and offers no compelling reason to support given
  no existing user base constrains us. `engines.node` in `package.json` is
  set to `>=20.0.0`.
- **ESM-only.** `package.json` sets `"type": "module"`. Dual CJS/ESM
  publishing roughly doubles build and test surface (two output trees, two
  sets of module-resolution edge cases) for a pre-1.0 project with no
  existing CommonJS consumers to support. All dependencies used
  (`ajv`, `yaml`, `commander`, `semver`) have usable ESM
  entry points or CJS interop that Node's ESM loader handles transparently.
- **Single package, no workspace.** The implementation is one cohesive
  library plus a thin CLI wrapper around it; there is no current
  requirement (e.g. independently versioned sub-packages, or genuinely
  separable deployment units) that justifies workspace overhead. A
  `pnpm-workspace.yaml` file exists only to hold the `onlyBuiltDependencies`
  setting (pnpm moved this out of `package.json` in newer releases); it
  declares a single package at `.` and is not a multi-package workspace.

## Consequences

- Consumers on Node 18 or CommonJS-only projects cannot use the package
  as a dependency (they can still use the CLI as a standalone binary via
  `npx`/global install on a supported Node version).
- If a future phase needs independently publishable sub-packages (e.g. a
  standalone `@agent-ready/schema` package with zero JS dependencies),
  splitting a single well-organized package is straightforward.

## Reconsideration trigger

Revisit dual-publishing if a significant CommonJS-only consumer base
emerges before 1.0. Revisit the workspace decision if a sub-package
genuinely needs independent versioning or a separate dependency graph
(e.g. a zero-dependency schema-only package for non-Node consumers).
