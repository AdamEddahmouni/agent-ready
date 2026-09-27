# Changelog

All notable changes to Agent-Ready are documented here. The project follows
[Semantic Versioning](https://semver.org/) while remaining pre-1.0.

## Unreleased

Adds `agent-ready discover` as the twelfth command, on the parallel vNext
track. It ships the discovery _substrate_ — provenance, explicit uncertainty,
the absence-versus-failure distinction, contradiction preservation, and a
read-only capability boundary — and now its third domain on top: a
provenance-carrying **module and dependency graph**.

The v1 contract, the eleven v1 commands, the adapter-output corpus, and the
public JSON Schema are unchanged. The shared `FileSystem` interface gained a
read-only `listDirectory`; it is additive, no v1 command calls it, and the
existing v1 behaviour is covered by the unchanged suites. `createProbeContext`,
the JSON position index, and the manifest parser gained purely additive
internals: a `"."` relative path now resolves to the repository root rather than
to a `.` appended to it, one line-count helper is now shared by the three call
sites that previously each had their own copy, and manifests additionally carry
dependency declarations with pointer-anchored positions. No v1 command reaches
any of them.

### Added

- A **`graph` field on the discovery snapshot** in which every node and every
  edge cites a repository-relative file and a 1-based line. Four node kinds
  (`package`, `module`, `external-dependency`, `owner`) and three edge kinds
  (`imports`, `package-depends-on`, `owned-by`) with readable, deterministic ids.
  A fact that cannot be traced to a file and a line does not enter the graph. The
  graph is a top-level snapshot field rather than a fact, so `FACT_IDS` is
  unchanged — a graph's evidence is one entry per node and per edge, which is
  what the fact evidence budget exists to prevent. See
  [ADR-0047](docs/decisions/0047-provenance-carrying-repository-graph.md).
- **Import resolution that is fenced and honest.** Relative specifiers resolve
  through TypeScript's own resolver against a host that cannot see outside the
  repository root and cannot see `node_modules`; workspace packages are
  identified from the discovered manifests, not from installed symlinks; Node
  built-ins are a `platform` answer with no node. Two checkouts of one commit —
  one with dependencies installed, one without — produce identical bytes.
  **Unresolved imports are surfaced, not swallowed**: the edge stays, carrying
  its specifier, a structured reason, and the file and line of the declaration,
  and one `DISCOVERY_IMPORT_UNRESOLVED` warning reports the run's total.
- **Dependency edges that keep declared and resolved apart.** `declarations[]`
  is what a manifest wrote, verbatim and cited by JSON Pointer; `resolution` is
  what a lockfile established, cited to the lockfile line, in one of four
  distinct states (`resolved` / `no-evidence` / `unsupported` / `unresolved`)
  that are never collapsed into "unknown". A name in two dependency fields
  produces two declarations rather than one picked by object order.
- **Ownership from `CODEOWNERS`, with an explicit `unowned` state.** First
  location wins and files are never merged; the last matching rule wins and every
  owner on it is kept; an unsupported pattern is skipped and reported with its
  file, line, and reason while the rules beside it keep applying. A subject is
  `owned` with owners or `unowned` with the policy that decided it — there is no
  sentinel owner node, no default team, and no Git-history inference, because any
  of those would put a person or a group in the graph that no repository file
  declares.
- **Every bound declared and every truncation published**: source depth `12`,
  directory entries `2000`, source files `2000`, `1 MB` per source file, `32 MB`
  of source in total, `500` imports per file, `5000` graph nodes, `20000` graph
  edges, `8 MB` per lockfile. When one fires, `graph.truncatedBy` names it and
  `graph.complete` is `false`.
- A `Graph` section in the human rendering, carrying counts the JSON already
  reports and nothing it does not.
- `agent-ready discover [--root <path>] [--json]` builds a deterministic,
  evidence-bearing model of a repository, and works **with or without** an
  `agent-ready.yaml`: a missing contract is reported as a fact rather than as
  `CONTRACT_NOT_FOUND`. Strictly read-only — the only capability a probe
  receives is repository-relative reading, stat-ing, and directory listing, so
  there is no `--write`, no process execution, no Git, and no network path. A
  declared package script is a fact about a string and is never an instruction
  to run it. See [ADR-0044](docs/decisions/0044-repository-discovery-model.md).
- A discovery fact model with an explicit epistemic boundary: every fact is a
  record carrying `declared` / `derived` / `author-declared` / `unknown`, and
  every known fact cites the evidence behind it. `unknown` is a first-class
  value with a reason, so an honest gap stays distinguishable from an absent
  field. Contradictory sources produce a fact with no value and both claims
  retained, never a ranked winner.
- A four-fact substrate vocabulary — repository root, contract presence, contract
  validity, and declaration-surface presence — later grown additively by
  package/workspace discovery and by command/verification discovery. Every id is
  a conceptual property a repository has, never a property of one entity inside
  it, so `FACT_IDS` stays a list a contributor can read in full. Contradiction
  preservation, corroboration, and the `author-declared` channel are built and
  tested against injected probes, so the substrate is demonstrable without a
  repository domain.
- Five `DISCOVERY_*` diagnostic codes in the shared registry
  (`DISCOVERY_ROOT_UNREADABLE`, `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_CONFLICT`,
  `DISCOVERY_NO_SIGNALS`, and `DISCOVERY_FACT_UNSUPPORTED`), reusing the
  existing diagnostic shape, renderers, `explain` registry, and exit-code
  mapping. The full contract is in
  [docs/specification/diagnostics.md](docs/specification/diagnostics.md#repository-discovery-diagnostics).
- Package and workspace discovery in the experimental `discover` snapshot, with
  provenance-preserving package-manager evidence: a `packageManager`
  declaration, the supported lockfile artifacts, and a contract's
  `environment.packageManager` claim are each reported as their own claim, and a
  repository with none is `unknown`/`no-evidence` — never `npm` by default. A
  root manifest and a nested manifest own separate package-manager facts, so
  heterogeneous managers are two true statements rather than one contradiction.
- A new **incomplete** fact outcome, distinct from a conflict: a declaration
  contradicted by another tool's artifact keeps the declaration, retains every
  claim, and publishes the disagreement in `contradictedBy` with
  `DISCOVERY_FACT_INCOMPLETE`. No winner is chosen in either shape.
- Workspace discovery that keeps five things apart — declaration, pattern,
  candidate, member, and the declaring manifest. Supported forms are
  `package.json` `workspaces` as an array or as an object with a `packages`
  array, plus `packages:` in `pnpm-workspace.yaml`, parsed through the existing
  bounded YAML reader. An unrecognised form or a pattern that escapes the
  repository root is reported, never coerced.
- Bounded, fenced workspace traversal: a code-constant depth and entry ceiling,
  a repository-root fence that refuses `..` and absolute patterns before any read
  and declines to follow symbolic links out of the root, `node_modules` and
  `.git` never entered, and explicit truncation reporting that never leaves
  `summary.complete: true` behind. Discovery stays read-only, and no package
  manager is ever executed.
- ADR-0045 (package and workspace discovery semantics), which amends ADR-0044's
  corroboration rule, splits contradiction into conflict-versus-incomplete, and
  makes `DISCOVERY_FACT_UNSUPPORTED` reachable.
- Command and verification discovery, so `discover` answers **"how do I verify
  this package?"** from repository-declared interfaces. `repository.commands`
  reports every declared package script, scoped to the package that declares it,
  with its exact body and a `source`/`pointer` citation;
  `repository.verificationEntrypoints` reports the subset whose **name** matches
  a narrow role grammar, with a structured `cwd`/`executable`/`args` invocation
  wherever the package-manager evidence is strong enough; and
  `repository.contract.verification` publishes the contract's
  `verification.required` as `author-declared`, in declared order, and never
  lets it overwrite or become a repository finding. See
  [ADR-0046](docs/decisions/0046-command-and-verification-discovery-semantics.md).
- Semantic roles come from script **names** only — an anchored
  `ROOT` or `ROOT:SUFFIX` grammar over `test`, `build`, `lint`, and `typecheck` —
  and script bodies are stored verbatim and never parsed. A script named `deploy`
  whose body is `vitest run` is a command with no role, not a test entrypoint:
  classifying from a body cannot be made trustworthy, since commands wrap other
  scripts, tools span several roles, and `"npm test && ship"` contains the token
  `npm test` while being nothing of the kind.
- Four honest invocation outcomes instead of one guessed one. A structured
  invocation requires an **agreed** package manager; unknown, conflicted, and
  contested each resolve to an invocation that is absent with a named reason,
  while the script, its role, and its body stay known. There is no `npm`
  default, a package-local manager always wins over the root's, a contested
  declaration is never promoted to a canonical executable, and a package
  manager named only in `agent-ready.yaml` never selects one.
- A `scriptsStatus` of `declared`, `absent`, `unsupported`, or `unobservable`, so
  "this package declares no scripts" stays distinguishable from "this manifest
  could not be read". An unknown semantic role is not an unknown command: a
  script named `abc` is still reported, in full, with its exact body.
- ADR-0046 (command and verification discovery semantics), which defines the
  role grammar, the body-opacity rule, the invocation derivation rule, and the
  meaning of a verification surface.
- `WARNING_DIAGNOSTIC_CODES` as the single source of truth for which codes are
  emitted as `severity: "warning"`. `agent-ready explain` now derives the
  severity it reports from it instead of restating a hardcoded list.
- `discover` in the reusable composite action's accepted subcommands and in the
  CI `dogfood-action` matrix, plus a CLI smoke step that exercises determinism,
  path-independence, the empty-repository case, the fatal-root exit code, and
  explainability of every discovery code.
- ADR-0041 (vNext direction), ADR-0042 (v1 freeze and parallel vNext surface),
  ADR-0043 (deterministic core and quarantined integrations), and ADR-0044 (the
  repository discovery model and its fact boundary).
- [LANDSCAPE.md](docs/vnext/LANDSCAPE.md), positioning the direction against
  AGENTS.md, MCP, SLSA/in-toto, OpenTelemetry, Git, isolation substrates, and
  agent orchestrators, including what Agent-Ready would decline to rebuild.
- [docs/security/threat-model-vnext.md](docs/security/threat-model-vnext.md),
  enumerating fourteen threat classes created by the vNext direction, the
  proposed trusted computing boundary, and the trust strata. None are mitigated
  today.
- [docs/vnext/PHASE-1-ISSUES.md](docs/vnext/PHASE-1-ISSUES.md), draft issue text
  for the repository-intelligence phase. Drafts only; nothing is filed.

### Changed

- Select a vNext direction: Agent-Ready becomes an open control plane for
  constitutionally governed autonomous software evolution, documented rather than
  implemented. See [VISION.md](VISION.md) and
  [RFC-0001](docs/vnext/RFC-0001-autonomous-software-evolution.md).
- Reposition the project from "the missing contract between repositories and
  coding agents" to "open infrastructure for constitutionally governed autonomous
  software evolution", with an explicit statement that no control-plane capability
  exists in code today.
- Archive the v0.7-to-v1.0 release plan as
  [docs/archive/roadmap-v1.md](docs/archive/roadmap-v1.md). Its planned
  ADR-0037 through ADR-0039 will not be written.
- Amend the no-network, no-LLM posture: the ban is permanent for the deterministic
  core, and networked integrations are quarantined behind individual design ADRs.

### Fixed

- **The discovery probe context could not list the repository root.** Every
  repository-relative path was joined onto the root, and the root's own relative
  path is `"."` — so listing it asked for `/repo/.`. A real `readdir` tolerates
  the trailing `/.` and a strict boundary does not, and the two cases are
  indistinguishable through a thrown error alone. The consequence was that the
  graph's source walk returned **nothing** for any repository without a usable
  `tsconfig.json` and without workspaces, silently, producing a complete and
  empty graph. All relative paths now go through one `absoluteFor` helper. The
  same class of defect as the relative-`--root` handling fixed earlier in this
  release: a root that is nominally correct and operationally wrong.
- **`.d.mts` and `.d.cts` were not recognised as declaration extensions.** The
  compound extension was sliced with a fixed five-character offset, which is only
  correct for a two-character extension, so a three-character one lost its
  leading dot and matched no exclusion list. The effect would have been to put
  declaration files into the module universe as though they were code.
- **A file ending in a newline was counted as having one more line than it
  does**, contradicting its own documentation. That count is the upper bound the
  graph's validator range-checks every citation against, so the phantom line
  admitted a citation onto a line that exists in the arithmetic and not on disk.
  Three call sites had three copies of the rule; they now share one.
- `module.builtinModules` omits documented, available modules — `node:test` most
  importantly — so `import … from "node:test/reporters"` was classified as an
  external dependency and would have minted a graph node for something no
  manifest declares. The built-in list is now supplemented explicitly rather
  than sourced from the runtime alone.
- An unresolved import produced one warning per import. A repository whose
  dependencies are simply not installed would emit thousands of warnings and
  train every consumer to ignore the code, so the warning is now one per run
  carrying the total, with a bounded sample that says it is a sample. The edges
  remain the complete per-item record.
- The human `Graph` rendering printed `moduleResolution` with nothing after it
  for a repository with no declared resolution mode, which read as a value that
  failed to render. The clause is now omitted.
- `agent-ready explain --code <CODE> --json` reported `severity: "error"` for
  every code outside a hardcoded list of three, so a newly registered
  informational code was described as an error. It now derives the severity
  from the shared registry.
- `DISCOVERY_NO_SIGNALS` could be emitted alongside `DISCOVERY_PARTIAL`, which
  made a single snapshot both claim that every probe completed and report that
  one could not. It is now emitted only when no probe failed.
- `corroboration.corroborated` was true for a fact supported by a single
  source, which read as independent verification. It is now true only when at
  least two claims support the value from different evidence; the weaker
  question is answered by `corroboration.kinds`.
- `hasEvidence` returned `false` for a fact whose probe failed — a legitimate
  state, since a failed probe is precisely how nothing gets cited. The
  predicate now matches its documented contract, and a separate
  `isSelfDescribing` expresses the observability question.
- A value-shaped probe reporting `found` with no value was recorded as `true`,
  fabricating a value the probe never observed. It is downgraded to a failed
  probe, for the same reason a thrown probe is.
- A value the probe _did_ report could be rewritten on its way into the
  snapshot: the orchestrator defaulted on nullishness, so an observed `null`
  became `true`. The default now applies only when a probe reported no value at
  all, leaving an observed `false` or `null` exactly as reported.
- `DISCOVERY_PARTIAL` did not set `sourcePath`, so its own remediation text
  pointed at a field that was never populated.
- `DISCOVERY_ROOT_UNREADABLE` resolved to the generic validation-failure exit
  code. It now resolves to exit `2`, alongside `CONTRACT_READ_FAILED` and
  `GIT_REPOSITORY_NOT_FOUND`.

## 0.6.1 - 2026-07-12

### Security

- Refuse symbolic-link write targets and repository-root escapes across every
  CLI write path; discovery now uses `lstat` semantics.
- Escalate timed-out POSIX process groups from `SIGTERM` to `SIGKILL`, confirm
  termination, and report a distinct failure when cleanup cannot be proven.
- Require bounded CLI timeouts from 1 through 3600 seconds.
- Gate releases on a main-reachable, GitHub-verified signed tag and protected
  deployment environments; make high-severity production audits blocking.
- Resolve the transitive `fast-uri` production dependency (reached through
  `ajv`) to 3.1.5, addressing GHSA-7p8r-x3mc-p8w7 / CVE-2026-18446, which
  affects the v3 line before 3.1.5.

### Changed

- Harden public Action examples and dependency installation against mutable
  references and lifecycle-script execution.

## 0.6.0 - 2026-07-11

### Added

- Optional `commands.<name>.timeout` with per-command precedence and recorded
  execution bounds.
- Validated structured handoff evidence through `verify --execute --handoff`.
- `verify --execute --check-generate`, a generated-instruction drift preflight
  that skips every repository command on failure.
- Stable handoff and generated-drift diagnostics with `explain` entries.

## 0.5.0 - 2026-07-11

### Added

- Optional, additive `architecture` contract guidance: ordered boundaries,
  invariants, and linked Markdown decision summaries.
- Optional, additive `agents` guidance: disallowed actions, approval points,
  and linked Markdown context files.
- Analysis of declared architecture-decision and agent-context file existence,
  with stable diagnostics and `--json` declared-file results.
- Adapter-output compatibility corpus v2, including architecture-only,
  agents-only, and combined adversarial rendering cases while retaining v1.

### Changed

- Every generated adapter now renders Architecture and Agent Constraints
  sections when the corresponding contract blocks are declared.
- The release asset now bundles every adapter compatibility corpus version.

## 0.4.0 - 2026-07-11

### Added

- The public `@adameddahmouni/agent-ready` npm package, GitHub Releases with
  package and compatibility-corpus assets, provenance attestations, and
  OIDC-only Trusted Publishing.
- `agent-ready init` and `agent-ready upgrade`, plus hand-authored
  `instructions.content` rendered consistently by all adapters.
- Threat-model hardening for YAML nesting, instruction-source size, immutable
  Action pins, and post-publish clean-install verification.

### Changed

- Established a release taxonomy that distinguishes package releases, npm
  channels, contract-schema versions, compatibility-corpus versions,
  roadmap milestones, ADRs, and GitHub issues.
- Removed the completed first-publication token fallback; all future npm
  releases use GitHub Actions OIDC Trusted Publishing only.

### Fixed

- Corrected release automation so every GitHub Release contains both the npm
  package and the adapter compatibility corpus.
- Replaced a polynomial-ReDoS-prone path-separator expression with a bounded
  linear scan.

## 0.4.0-rc.1 - 2026-07-11

### Changed

- Prepared the feature-frozen stable release candidate and validated it through
  CI, CodeQL, OIDC publication, and clean-install verification.

## 0.4.0-beta.4 - 2026-07-11

### Fixed

- Attach the adapter compatibility corpus to each GitHub Release, alongside
  the npm tarball as documented.

## 0.4.0-beta.3 - 2026-07-11

### Fixed

- Replaced a backtracking path-separator regular expression in the generation
  containment guard with a bounded linear scan, resolving CodeQL's
  polynomial-ReDoS finding.
- Extended the post-publish npm visibility wait to five minutes so registry
  propagation does not incorrectly fail an otherwise successful release.

## 0.4.0-beta.2 - 2026-07-11

### Added

- `agent-ready init`, a dry-run-first command that inspects a repository and
  scaffolds a starter `agent-ready.yaml` only when `--write` is supplied.
- Hand-authored `instructions.content` support across the schema,
  normalization pipeline, adapters, compatibility corpus, and documentation.
- Public-project branding and community files, a roadmap to 1.0, CodeQL, and
  tag-triggered npm publication infrastructure.
- `agent-ready upgrade`, a dry-run-first, evidence-backed contract
  modernization command with `--write` opt-in, field-level diffs, and
  pre-write validation.
- Five ADRs covering package publication, contract upgrades, YAML depth,
  immutable Action pins, and instruction-source size limits.
- GitHub Release automation that attaches the npm tarball and the adapter
  compatibility corpus, plus post-publish clean-install verification.

### Changed

- Expanded generated adapter output with grouped commands, verification,
  path rules, and completion guidance.
- Pinned third-party GitHub Actions to immutable commit SHAs and tightened
  Dependabot configuration.
- Prepared package metadata and documentation for the scoped
  `@adameddahmouni/agent-ready` `0.4.0-beta.2` public preview rather than
  presenting post-`v0.3.0` work as version `0.3.0`.
- Added an immutable Action-pin check to the local and CI quality gates.

### Fixed

- Corrected composite-action setup and CI expression failures discovered
  after the `v0.3.0` tag.
- Made integration-test temporary-directory cleanup retry bounded Windows
  `EBUSY`/`EPERM` release races.
- Reject deeply nested YAML before conversion and oversized instruction sources
  before they are read into memory.

## 0.3.0 - 2026-07-06

### Added

- `agent-ready schema`, a read-only CLI command that prints the bundled
  Agent-Ready contract JSON Schema (path, contract version, JSON Schema
  `$schema`/`$id`/`title`, byte count) and optionally (`--content`)
  the parsed schema body. Requires no contract, repository, or Git
  working tree. See
  [ADR-0022](docs/decisions/0022-agent-ready-schema-command.md);
  selected as the first Path A increment by
  [ADR-0021](docs/decisions/0021-cli-package-maturity-direction.md).
- `agent-ready doctor`, a read-only CLI command that inspects the host
  environment for fitness to run Agent-Ready against the contract:
  declared Node range (`runtime-node`), declared package manager
  (`package-manager`), each declared non-`node` runtime
  (`runtime-other-<name>`, warn-only), Git on `PATH` (`git-on-path`,
  required iff `paths.protected` is non-empty), and Git working-tree
  membership (`git-repository`, informational). Loads and validates
  through the same contract pipeline as `agent-ready validate`; emits a
  `{ ok, contractPath, repoRoot, checks, diagnostics }` envelope with a
  uniform per-check row shape. Read-only: never executes
  contract-declared commands, never invokes Git for state-changing
  operations, never modifies the repository. See
  [ADR-0023](docs/decisions/0023-agent-ready-doctor-command.md),
  [ADR-0021](docs/decisions/0021-cli-package-maturity-direction.md).
- New [`src/binary/`](src/binary/) module exporting the `BinaryClient`
  boundary (`probe(target, root)` over the `git | pnpm | npm | yarn`
  target union), the real
  [NodeBinaryClient](src/binary/nodeBinaryClient.ts) (execFile-backed,
  ADR-0013 invariant: hardcoded `[<target>, "--version"]` argv; ENOENT
  resolves to `undefined`), and the
  [FakeBinaryClient](src/binary/fakeBinaryClient.ts) test double. Mirrors
  [`src/git/`](src/git/) in shape, so a future ADR adding a new probed
  runtime (e.g. `python`, `rust`) extends the `BinaryTarget` union and
  one probe mapping rather than introducing a parallel abstraction.
- Five new doctor-raised diagnostic codes
  (`RUNTIME_VERSION_MISMATCH`,
  `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`,
  `PACKAGE_MANAGER_UNAVAILABLE`,
  `PACKAGE_MANAGER_VERSION_MISMATCH`,
  `GIT_REQUIRED_BUT_UNAVAILABLE`) added to
  [src/diagnostics/codes.ts](src/diagnostics/codes.ts), additive per
  [ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md).
- Vitest unit ([`tests/unit/doctor.test.ts`](tests/unit/doctor.test.ts))
  and integration
  ([`tests/integration/doctorCli.test.ts`](tests/integration/doctorCli.test.ts))
  suites exercising the ADR-0023 §Tests matrix: all-pass happy path,
  node-version mismatch, declared-but-unsupported non-Node runtimes,
  package-manager absent / version mismatch / probe throw, Git missing
  with `paths.protected` empty vs declared (warn vs fail), `git --version`
  unexpected throw surfaces as `GIT_UNAVAILABLE` and exit 10.
- `agent-ready explain`, a read-only CLI command that prints extended
  human-readable explanations for Agent-Ready diagnostic codes (`--code`),
  with structured `what` / `why` / `fix` / `related` fields, optional
  contract-field context (`--config`), and machine-readable JSON output
  (`--json`). Requires no contract or repository without `--config`; uses
  the same `loadContract` pipeline as `validate`/`doctor` when `--config`
  is given. See
  [ADR-0024](docs/decisions/0024-agent-ready-explain-command.md).
- [`src/cli/commands/explainRegistry.ts`](src/cli/commands/explainRegistry.ts)
  with extended explanations for all 40 diagnostic codes, each carrying
  `what` / `why` / `fix` / `fields` / `related` properties. Includes a
  registry-invariant test ensuring every `DiagnosticCode` has an entry.
- Vitest unit ([`tests/unit/explain.test.ts`](tests/unit/explain.test.ts))
  and integration
  ([`tests/integration/explainCli.test.ts`](tests/integration/explainCli.test.ts))
  suites exercising the ADR-0024 acceptance criteria: recognized-code
  human/JSON output, unknown-code exit 1, contract-field context when
  `--config` loads successfully, missing-field '(not declared)' note,
  contract-load failure short-circuits.
- Vitest integration test
  [`tests/integration/actionSubcommands.test.ts`](tests/integration/actionSubcommands.test.ts)
  asserting that every CLI subcommand wired in
  [`src/cli/index.ts`](src/cli/index.ts) is listed in
  [`action.yml`](action.yml)'s `inputs.command.description`, and
  vice versa. Locks the action's accepted-subcommand allowlist in
  lockstep with the wired CLI surface so a future Path A ship widens
  both in one PR.

### Changed

- Widened the composite action's [`action.yml`](action.yml) `command`
  input to accept `schema`, `doctor`, and `explain`, fulfilling the
  follow-up ADR requirements. The action's typed inputs (`command:` /
  `config:` / `json:` / …) stay data-driven — no shell-quoting or
  string interpolation into the bash step. The
  [`ci-integration.md`](docs/specification/ci-integration.md) reference
  mirrors the accepted list and adds a `command: schema` example; the
  [`.github/workflows/ci.yml`](.github/workflows/ci.yml) `dogfood-action`
  matrix now exercises `schema` through the action as well, with
  `config:` intentionally empty for that one entry
  (`agent-ready schema` does not accept `--config` —
  [ADR-0022](docs/decisions/0022-agent-ready-schema-command.md)).
  Future Path A commands (`init`) will widen this action's `command`
  input in the same PR that adds the command, so the composite action
  supports every shipped CLI subcommand without lag.
- New [`action-fail-fast`](.github/workflows/ci.yml) CI smoke job
  asserts `action.yml`'s bash `case` block rejects an unknown
  subcommand (`command: bogus`) with exit 3 and a `::error::`
  annotation. Guards against regression of the action-subcommand
  allowlist.
- De-duplicated the accepted-subcommands list in
  [`docs/specification/ci-integration.md`](docs/specification/ci-integration.md)'s
  Inputs section into a single "Accepted subcommands" subsection,
  referenced by the Inputs table's `command` row. Fixed a
  prettier-spacing sentence-join bug in the closing Path A prose.

### Documentation

- Selected Path A (CLI/package maturity) as the next increment via
  [ADR-0021](docs/decisions/0021-cli-package-maturity-direction.md)
  and updated ROADMAP.md's "Recommended next phase" and "CLI/package
  maturity direction" sections accordingly; the first command to ship
  is `agent-ready schema` (read-only, no contract-schema changes, no
  new diagnostic codes).
- Drafted [ADR-0023](docs/decisions/0023-agent-ready-doctor-command.md)
  and [ADR-0024](docs/decisions/0024-agent-ready-explain-command.md)
  — per-command designs for `agent-ready doctor` (second Path A ship)
  and `agent-ready explain` (third Path A ship). Sequenced `doctor` →
  `explain` → `init` from ADR-0021. Doctor is the first contract-loading
  Path A command (compares detected tooling against declared
  `environment.runtimes`/`environment.packageManager` and
  required-`paths.protected` git); explain is the first documentation/
  rendering-only command (no new diagnostic codes, no new abstractions).
  Both ADRs were accepted and implemented in this release.

## 0.2.0 - 2026-07-03

### Added

- `agent-ready analyze`, a read-only documentation drift check for local
  Markdown links in declared `instructions.sources`, with human and structured
  JSON output.
- Stable documentation-analysis diagnostics for unreadable sources, target
  inspection failures, broken links, and repository-escaping links.

### Fixed

- Enforced LF working-tree line endings across platforms so formatting checks
  and the byte-exact adapter compatibility corpus remain deterministic on
  Windows.

### Documentation

- Corrected stale architecture and threat-model claims and selected local
  architecture/documentation drift analysis as the Phase 10 direction.
- Added ADR-0020 and full CLI, CI-action, security, and architecture
  documentation for Phase 10's bounded link-analysis design.

### Security

- Documentation analysis rejects lexical traversal above the repository root
  and never follows remote or root-relative link destinations.

## 0.1.0 - 2026-07-03

### Added

- Contract discovery, safe YAML parsing, JSON Schema validation, semantic
  validation, deterministic normalization, and structured diagnostics.
- `validate`, `inspect`, `generate`, `check`, and `verify` CLI commands.
- Generated instructions for AGENTS.md, Claude, Cursor, GitHub Copilot, and
  Gemini, including managed-file protection and Markdown-safe rendering.
- Git-based protected-path enforcement.
- Opt-in verification execution, timeouts, and local JSON evidence recording.
- A reusable GitHub composite action.
- A versioned adapter-output compatibility corpus for downstream consumers.

### Security

- Contract-declared commands remain inert except for the explicit
  `verify --execute` path.
- Generated Markdown escapes contract-supplied text, code spans, and links.
