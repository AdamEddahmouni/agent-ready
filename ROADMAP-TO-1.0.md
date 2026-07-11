# Roadmap to 1.0

This document is the **forward-looking release plan** for Agent-Ready,
covering every release from v0.4.0 through v1.0.0. It supersedes the
"Recommended next phase" and "Long-term open-source direction" sections
of [ROADMAP.md](ROADMAP.md) for planning purposes — the completed-phase
history in that document remains the authoritative record of what has
shipped.

[ROADMAP.md](ROADMAP.md)'s "Strict non-goals for the current phase" list
remains authoritative unless a specific ADR in this roadmap formally
reopens a non-goal. Where this happens, the ADR's acceptance must update
ROADMAP.md's non-goals list in the same PR — otherwise the two documents
contradict each other. The ADRs that reopen existing non-goals are:
ADR-0027 (npm publication), ADR-0035 (per-command timeout),
ADR-0037 (architecture-dependency analysis), and ADR-0039 (external
adapter registration).

The plan is organized into five milestones, each with a target version,
a unifying theme, the concrete deliverables (commands, schema fields,
infrastructure, documentation), the ADRs required, and the exit
criteria that must be met before the next milestone begins.

---

## Guiding principles for the path to 1.0

1. **One ADR per consequential change.** Every new command, schema
   field, diagnostic code, or architectural shift gets its own ADR
   before implementation begins. No exceptions.
2. **Additive-only schema evolution within `version: 1`.** Per
   [ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md), no
   existing field is removed, retyped, or made required without a
   contract `version: 2` bump. New fields are optional and additive.
3. **Safe by default.** Every new command is read-only unless it
   explicitly writes, and writing commands follow the dry-run →
   `--write`/`--execute` opt-in pattern already established by
   `generate` and `verify`.
4. **No network, no LLM, no telemetry — ever.** The local-first,
   zero-cost, zero-API-key posture is a permanent commitment, not a
   pre-1.0 limitation. The commercial direction (Agent-Ready Cloud)
   is a separate, optional layer that must never break local operation.
5. **Evidence over claims.** Every capability shipped must be backed by
   tests (unit + integration), golden fixtures where applicable, and
   documentation that matches the implementation.
6. **Adoption before ambition.** Each milestone reduces a concrete
   adoption barrier before adding new capability. The project reaches
   1.0 only when a maintainer can go from zero to a fully enforced,
   verified, agent-guided repository in under 10 minutes.

---

## Milestone 1 — Adoption & Polish (v0.4.0)

**Theme:** Remove the remaining friction between a maintainer and their
first fully working Agent-Ready repository. Publish to npm. Harden the
known limitations documented in the threat model.

### v0.4.0 deliverables

#### 1. npm publication

- [x] **ADR-0027: npm package publication strategy.** Justifies the
      publish-on-tag workflow (already in `publish.yml`), the `files` allowlist
      in `package.json`, provenance attestation via OIDC trusted publishing,
      and the decision to publish `@adameddahmouni/agent-ready` as a scoped package
      after npm rejected the unscoped name for similarity. **This ADR formally reopens
      the "automated package publication or release" non-goal from ROADMAP.md**
      — the existing non-goal was scoped to the composite action not requiring
      npm publish (ADR-0016); this ADR broadens the project to support
      publication as a first-class distribution channel, while the composite
      action remains build-from-source.

- [ ] Configure npm Trusted Publishing on npmjs.com (link the
      `@adameddahmouni/agent-ready` package to this GitHub repo + `publish.yml` workflow).
- [ ] Tag `v0.4.0` and publish. Update `README.md` and
      `docs/adoption-guide.md` installation instructions to show
      `npm install -D @adameddahmouni/agent-ready` / `npx agent-ready` as the primary path,
      with from-source as the fallback.
- [x] Add a `postpublish` smoke verification step to `publish.yml`
      that installs the just-published version in a clean temp directory
      and runs `agent-ready --version` + `agent-ready validate --config
examples/minimal/agent-ready.yaml`.

#### 2. `agent-ready upgrade` command

- [x] **ADR-0028: `agent-ready upgrade` command.** A read-only-by-default
      command that inspects an existing `agent-ready.yaml`, compares it
      against the current schema version, and reports any deprecated
      fields, renamed fields, or fields that have become recommended since
      the contract was authored. With `--write`, it applies safe,
      non-breaking transformations (e.g. adding a newly-recommended
      `paths.ignored` entry, updating a stale `environment.runtimes.node`
      range). Never removes fields the user explicitly declared.

  This is a **third, distinct write pattern** — unlike `generate --write`
  (which writes managed files and refuses to overwrite unmanaged ones)
  or `init --write` (which refuses to overwrite an existing file
  entirely), `upgrade --write` selectively modifies an existing
  hand-authored file in place. The safety model is: dry-run by default,
  every proposed change is shown as a diff, `--write` applies only
  non-breaking additions or value updates, and no user-declared field is
  ever removed. The ADR defines this pattern independently rather than
  claiming it mirrors `generate`.

  | Flag              | Behavior                                         |
  | ----------------- | ------------------------------------------------ |
  | (none)            | Dry run: print a diff of proposed changes        |
  | `--write`         | Apply safe transformations to `agent-ready.yaml` |
  | `--json`          | Machine-readable output                          |
  | `--config <path>` | Explicit contract path                           |

  New diagnostics: `UPGRADE_NO_CHANGES_NEEDED`, `UPGRADE_MANUAL_REVIEW_REQUIRED`
  (for transformations that are ambiguous and should not be auto-applied).

#### 3. Threat model hardening — documented limitations

- [x] **ADR-0029: YAML depth guard.** Add a configurable nesting-depth
      limit (default 100) to `parseYaml.ts`, complementing the existing
      1 MB size cap and `maxAliasCount`. Closes the "deep, non-aliased YAML
      nesting" known limitation in the threat model. New diagnostic:
      `YAML_NESTING_TOO_DEEP`.
- [x] **ADR-0030: SHA-pinned GitHub Actions.** Pin all third-party
      Actions in `ci.yml` and `publish.yml` to immutable commit SHAs
      (with a comment showing the version tag for readability) instead of
      major-version floating tags. Closes the "GitHub Actions pinned to
      major version tags" known limitation. Add a Dependabot config for
      github-actions ecosystem (already present) and a CI check that
      fails if any `uses:` references a tag rather than a SHA.
- [x] **ADR-0031: Instruction-source size cap.** Add a per-source
      file size limit (default 5 MB) to `agent-ready analyze`, preventing
      a pathological instruction source from consuming unbounded memory.
      New diagnostic: `INSTRUCTION_SOURCE_TOO_LARGE`. Closes the
      "instruction sources have no dedicated size cap" known limitation.

#### 4. GitHub Release automation

- [x] Add a `release.yml` workflow triggered on tag push that creates
      a GitHub Release with auto-generated release notes (from
      `CHANGELOG.md`), attaches the build artifact, and links the
      compatibility corpus.

### v0.4.0 exit criteria

- [ ] `npm install -D @adameddahmouni/agent-ready` works and produces a working CLI. Requires
      the external public-repository, npm-bootstrap, and tag-publication steps.
- [x] `agent-ready upgrade --write` safely modernizes a v0.1.0-era contract.
- [x] All three threat-model known limitations addressed above are closed.
- [x] All GitHub Actions are SHA-pinned and checked in CI.
- [ ] 500+ tests pass; CI is green on Ubuntu, Windows, and macOS. Local test
      count is verified during the final preflight; the cross-platform CI run
      occurs after the branch is pushed.

---

## Milestone 2 — Richer Contract (v0.5.0 – v0.6.0)

**Theme:** Expand what the contract can _say_ so it can guide agents
beyond "run these commands" and "don't touch these files." Each new
schema block ships behind its own ADR, is additive within `version: 1`,
and flows through `generate` into adapter output with full
Markdown-escaping discipline.

### v0.5.0 — Architecture & agent-guidance blocks

#### 1. `architecture` block

- [ ] **ADR-0032: `architecture` schema block.** Adds an optional
      `architecture` top-level block to the contract, letting a repository
      declare structured architectural invariants that flow into generated
      agent instructions:

  ```yaml
  architecture:
    boundaries:
      - "src/contract/ must not import from src/cli/"
      - "Adapters must not depend on FileSystem"
    invariants:
      - "All pipeline stages return DiagnosticResult<T>"
      - "No module depends on an AI model or hosted service"
    key_decisions:
      - file: "docs/decisions/0001-runtime-and-distribution.md"
        summary: "ESM-only, single npm package, Node >=20"
  ```

  Validation rules:
  - `boundaries` and `invariants` are arrays of non-empty strings
    (1–500 chars each), Markdown-escaped in adapter output.
  - `key_decisions` is an array of `{ file, summary }` objects; `file`
    must be a literal repo-relative path that exists
    (`ARCHITECTURE_DECISION_FILE_NOT_FOUND`), `summary` is 1–300 chars.
  - `agent-ready analyze` gains a check: each `key_decisions[].file`
    must exist and be a valid Markdown file (extends the existing
    link-analysis pipeline, not a new one).

  Adapter output: all five adapters gain an "## Architecture" section
  rendering `boundaries` as a bulleted "Must not" list, `invariants` as
  a bulleted "Always" list, and `key_decisions` as a linked list. Golden
  fixtures updated for `examples/complete-phase-1/`.

#### 2. `agents` block (refined from config-evolution draft)

- [ ] **ADR-0033: `agents` schema block.** Adds an optional `agents`
      top-level block for agent-operating constraints that are
      _enforceable_ (unlike free-form instruction documents):

  ```yaml
  agents:
    disallowed_actions:
      - "Do not install packages without explicit approval"
      - "Do not modify files matching paths.protected"
    approval_required_for:
      - "Database migrations"
      - "Changes to CI configuration"
    context_files:
      - "docs/architecture/overview.md"
      - "docs/decisions/README.md"
  ```

  Design decisions justified in the ADR:
  - `disallowed_actions` and `approval_required_for` are arrays of
    non-empty strings (1–300 chars), Markdown-escaped in output. They
    are _declarations_ the agent reads — Agent-Ready does not enforce
    them at runtime (that would require an agent runtime integration,
    a non-goal). Their value is in being generated, versioned, and
    consistent across all agent instruction files.
  - `context_files` is an array of literal repo-relative paths (same
    validation as `instructions.sources`). `agent-ready analyze`
    extends to check these too.
  - `allowed_tools` from the config-evolution draft is **dropped** —
    it overlaps too heavily with agent-vendor-specific configuration
    and has no deterministic enforcement path. The ADR explains this
    rejection explicitly.
  - `default_instructions` from the draft is **dropped** —
    `instructions.content` ([ADR-0026](docs/decisions/0026-instructions-content-field.md))
    already serves this purpose.
  - The `quality_gates` block from the config-evolution draft is
    **not included** in this roadmap — it substantially overlaps with
    the existing `verification.required` field, and no use case has
    emerged that justifies a second, parallel mechanism. It remains
    explicitly out of scope (see the out-of-scope section below).

  Adapter output: all five adapters gain an "## Agent Constraints"
  section.

### v0.5.0 exit criteria

- `architecture` and `agents` blocks are valid schema fields, fully
  validated, and flow through `generate` into all five adapters.
- `agent-ready analyze` checks `architecture.key_decisions[].file` and
  `agents.context_files[]` paths.
- Golden fixtures updated; compatibility corpus bumped to reflect new
  output sections.
- Existing contracts without these blocks validate identically to v0.4.0
  (additive-only proof).

### v0.6.0 — Handoff evidence & verification enhancements

#### 1. Structured handoff evidence

- [ ] **ADR-0034: Structured handoff evidence model.** Extends
      `verify --execute --record` to produce a richer evidence file that
      includes the structured fields proposed in
      [docs/specification/evidence.md](docs/specification/evidence.md):

  ```json
  {
    "contractPath": "agent-ready.yaml",
    "repoRoot": "/path/to/repo",
    "mode": "execute",
    "recordedAt": "2026-08-01T12:00:00.000Z",
    "commands": [/* existing per-command results */],
    "handoff": {
      "summary": "Added input validation to parseYaml.ts",
      "filesChanged": ["src/contract/parseYaml.ts", "tests/unit/parseYaml.test.ts"],
      "commandsRun": ["pnpm lint", "pnpm test", "pnpm build"],
      "assumptions": ["Assumed the 1MB size cap is sufficient for all real-world contracts"],
      "knownIssues": ["Depth guard not yet tested with pathological 500-level nesting"],
      "requiresManualReview": false
    },
    "diagnostics": []
  }
  ```

  Design decisions:
  - The `handoff` block is **optional** — `verify --execute --record`
    without a `--handoff` flag produces the same output as today (no
    `handoff` key). With `--handoff <path>`, Agent-Ready reads a
    handoff JSON file the agent/user wrote, validates its _shape_
    (not truth), and merges it into the evidence record.
  - `--handoff` is a separate flag from `--record` because a user may
    want to validate a handoff structure without recording the full
    evidence file.
  - Agent-Ready validates shape, never correctness — a syntactically
    valid handoff with a false summary still passes (documented).
  - New diagnostic: `HANDOFF_FILE_INVALID` (malformed JSON or missing
    required fields), `HANDOFF_FIELD_TOO_LONG` (summary > 2000 chars,
    any array entry > 500 chars).

#### 2. Per-command timeout & environment declarations

- [ ] **ADR-0035: Per-command metadata fields.** Adds optional fields
      to each command declaration for verification-relevant metadata:

  ```yaml
  commands:
    test:
      run: pnpm test
      timeout: 120 # seconds; overrides --timeout for this command
      description: Runs the unit test suite.
    build:
      run: pnpm build
      timeout: 300
      description: Compiles the project into dist/.
  ```

  - `timeout` is an optional integer (1–3600 seconds). If absent, the
    CLI-level `--timeout` default (900s) applies. If present, it
    overrides the CLI default for this command only.
  - No `env` or `workingDirectory` fields — these were considered and
    rejected in [ADR-0006](docs/decisions/0006-command-representation.md)'s
    "Alternatives" and remain non-goals (environment interpolation is a
    security boundary; working directory is always the repo root).
  - Schema-additive; existing contracts without `timeout` validate
    identically. **This ADR formally reopens the "per-command
    timeout/environment/working-directory declarations" non-goal from
    ROADMAP.md** — only `timeout` is reintroduced; `env` and
    `workingDirectory` remain permanently rejected.

#### 3. `generate --check` integration with `verify`

- [ ] **ADR-0036: `verify --execute --check-generate` flag.** When
      passed, `verify` runs `generate --check` as an implicit first
      verification step — if generated instruction files have drifted from
      what the contract would produce, verification fails before any
      declared command runs. This closes the gap where a contract change
      (e.g. adding a command) doesn't update `AGENTS.md` until someone
      manually runs `generate --write`, leaving agents working from stale
      instructions.

### v0.6.0 exit criteria

- `verify --execute --record --handoff` produces a complete evidence
  file with structured handoff data.
- Per-command `timeout` works in `verify --execute`.
- `verify --execute --check-generate` catches instruction-file drift.
- Evidence model documented in `evidence.md` matches the implementation.
- All existing tests pass; new tests cover the handoff validation
  surface and timeout override behavior.

---

## Milestone 3 — Broader Analysis & Ecosystem (v0.7.0 – v0.8.0)

**Theme:** Extend `analyze` beyond Markdown links into architecture-
dependency detection, add framework-specific example repositories, and
introduce the first adapter plugin mechanism — all behind ADRs.

### v0.7.0 — Architecture-dependency analysis

#### 1. `agent-ready analyze --architecture`- [ ] **ADR-0037: Architecture-dependency drift analysis.** Extends

`agent-ready analyze` with an optional `--architecture` flag that
checks the `architecture.boundaries` declarations (from v0.5.0)
against the actual import graph of the repository's TypeScript/JavaScript
source files. **This ADR formally reopens the "architecture-dependency
analysis beyond declared documentation links" non-goal from
ROADMAP.md** — the v0.7.0 scope is bounded to JS/TS import-graph
checking against declared `architecture.boundaries`, not open-ended
architecture analysis.

Scope:

- Parses `import`/`export`/`require` statements in `.ts`/`.js`/`.mjs`/
  `.cjs` files using a bounded, dependency-free scanner (no AST
  framework — regex-based extraction with strict line-level parsing,
  same discipline as the Markdown link scanner).
- For each `boundaries` entry, evaluates whether any import crosses
  the declared boundary. Boundary entries use a simple
  `from → to` or `must not import` syntax validated at contract-load
  time.
- Read-only; never modifies source files.
- False-positive policy: boundary declarations are _assertions_, and
  a violation is always reported — the user adjusts either the code
  or the declaration. No heuristic suppression.
- New diagnostics: `ARCHITECTURE_BOUNDARY_VIOLATED`,
  `ARCHITECTURE_ANALYSIS_SCAN_FAILED`.
- Limited to JS/TS initially; a `--language` flag or auto-detection
  for Python/Go/Rust is a future enhancement, not in this release.

#### 2. Framework-specific example repositories

- [ ] Add `examples/python-fastapi/` — a minimal FastAPI repository
      with `agent-ready.yaml` declaring `runtimes.python`, `pip` as
      package manager (requires `doctor` to gain Python probing — see
      v0.8.0), `pytest` as the test command, and all five adapters enabled.
      Note: `doctor` will warn `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` for
      these runtimes until v0.8.0 ships multi-language probing; the examples
      are valid contracts, but a fully clean `doctor` run requires v0.8.0.
- [ ] Add `examples/rust-cli/` — a minimal Rust CLI repository with
      `agent-ready.yaml` declaring `runtimes.rust`, `cargo` commands, and
      adapter output.
- [ ] Add `examples/go-service/` — a minimal Go microservice with
      `agent-ready.yaml` declaring `runtimes.go`, `go test`/`go build`,
      and adapter output.
- [ ] Each example gets golden fixtures in the compatibility corpus
      and is exercised in CI's "valid examples pass" smoke test.

### v0.7.0 exit criteria

- `agent-ready analyze --architecture` detects import-graph boundary
  violations with zero false positives on the project's own
  `architecture.boundaries` declarations (dogfooded).
- Three framework-specific examples pass validation and generate
  correct adapter output.
- Analysis remains local, read-only, deterministic, and LLM-free.

### v0.8.0 — Multi-language doctor & adapter extensibility

#### 1. Extended `doctor` runtime probing

- [ ] **ADR-0038: Multi-language runtime probing in `doctor`.** Extends
      the `BinaryClient` boundary (from [ADR-0023](docs/decisions/0023-agent-ready-doctor-command.md))
      to probe `python`,
      `rust`/`cargo`, and `go` in addition to `node`/`pnpm`/`npm`/`yarn`.
      Each new runtime gets the same `--version` probe pattern. The
      `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` diagnostic is retired for
      these runtimes (they become fully supported); it remains for any
      runtime not yet probed.
  - Doctor's `--json` output gains a `probedRuntimes` array listing
    which runtimes were checked and their detected versions.
  - The v0.7.0 framework examples' `doctor` runs now pass instead of
    warning.

#### 2. Adapter extensibility (first step)

- [ ] **ADR-0039: External adapter registration.** Introduces a
      _minimal_ mechanism for registering a custom adapter renderer
      without modifying Agent-Ready's source code:

  ```yaml
  adapters:
    custom:
      enabled: true
      renderer: "./agent-ready-adapters/my-adapter.js"
      output: "MY-AGENT.md"
  ```

  Design constraints:
  - `renderer` is a literal repo-relative path to an ES module that
    exports a `render(contract: NormalizedContract): string` function.
  - `output` is a literal filename (no path traversal, same validation
    as existing adapter output paths).
  - The module is loaded via dynamic `import()` at generation time.
    If the module fails to load or doesn't export the expected
    function, generation fails with `CUSTOM_ADAPTER_LOAD_FAILED` —
    no silent fallback.
  - This is _not_ a plugin system: no lifecycle hooks, no middleware,
    no event system. It's a single function call per adapter, matching
    the existing pure-function adapter pattern. The ADR explicitly
    bounds the scope and names what is _not_ included.
  - Markdown-escaping is the custom renderer's responsibility
    (documented); Agent-Ready provides the `escapeMarkdownText`/
    `wrapCodeSpan`/`renderMarkdownLink` helpers as public API exports
    for custom renderers to use.
  - Security: the renderer module is local code the repository already
    contains — loading it is the same trust boundary as any dev
    dependency. The threat model is updated to document this.
  - **This ADR formally reopens the "plugin/adapter loading" non-goal
    from ROADMAP.md** — only the narrow single-function render-call
    mechanism is reintroduced; full plugin architecture with lifecycle
    hooks remains permanently out of scope (see below).

### v0.8.0 exit criteria

- `doctor` probes Python, Rust, and Go runtimes; the v0.7.0 framework
  examples' `doctor` output is clean.
- A custom adapter can be declared, loaded, and rendered through
  `generate --write`.
- The adapter extensibility mechanism is documented, tested with a
  custom-adapter fixture, and the threat model reflects it.
- The five built-in adapters remain unchanged — the new mechanism is
  purely additive.

---

## Milestone 4 — Stabilization & Hardening (v0.9.0)

**Theme:** Freeze the surfaces that will become 1.0-stable. Close every
remaining threat-model limitation. Audit every ADR's reconsideration
trigger. Make the public API something we can stand behind with full
SemVer guarantees.

### v0.9.0 deliverables

#### 1. Public API stabilization

- [ ] **ADR-0040: Public API freeze for 1.0.** Reviews everything
      exported from `src/index.ts` and categorizes each export as:
  - **Stable for 1.0** — the export's shape is frozen; breaking
    changes require a major version bump.
  - **Removed before 1.0** — the export was experimental, is not used
    by external consumers, and is dropped from the public surface to
    reduce maintenance burden.
  - **Moved to a subpath export** — the export is useful but niche
    (e.g. `escapeMarkdownText` for custom adapters) and moves to
    `agent-ready/markdown` or similar.
    The ADR documents the final 1.0 public API surface explicitly. After
    this ADR, the "experimental" qualifier from ADR-0009 is removed for
    all Stable exports.
- [ ] Add a `api-audit.test.ts` that asserts the exact set of exports
      from `src/index.ts` matches the ADR-0040 manifest, preventing
      accidental public-surface drift.

#### 2. Pre-1.0 audit — ADR reconsideration triggers

- [ ] Review every ADR's "Reconsideration trigger" section. For each
      trigger that has been satisfied (by subsequent work), add a
      "Resolution" note. For triggers that remain open, confirm they are
      still relevant or mark them as addressed.
- [ ] **ADR-0041: Pre-1.0 audit and ADR reconciliation.** Documents
      the audit results, any ADRs being superseded, and any triggers being
      formally closed.

#### 3. Remaining threat-model hardening

- [ ] **ADR-0042: Case-insensitive path conflict detection.** Adds an
      optional `--case-insensitive` flag to path-category conflict
      detection (defaulting to the host OS's behavior: on on Windows/macOS,
      case-insensitive; on Linux, case-sensitive). Closes the
      "case-insensitive file systems" known limitation. The flag is
      contract-level (`paths` block gains an optional `caseSensitive:
boolean` field, default `false` on Windows/macOS, `true` on Linux),
      not just CLI-level, so CI on Linux can enforce the repo's intended
      semantics.
- [ ] **ADR-0043: Symlink boundary enforcement for `generate --write`.**
      Adds an `lstat` check before writing generated files: if the target
      path is a symlink, generation refuses with `GENERATE_TARGET_SYMLINK`
      unless `--allow-symlinks` is explicitly passed. Closes the
      "symlinked contract files" and "generate --write follows symlinks"
      known limitations.
- [ ] **ADR-0044: `verify --execute` SIGKILL escalation.** On POSIX,
      if a timed-out process group does not exit within 5 seconds of
      `SIGTERM`, escalate to `SIGKILL`. On Windows, `taskkill /t /f` is
      already a force-kill. Closes the "timeout kill is best-effort"
      known limitation.

#### 4. CI hardening

- [ ] Add `pnpm audit --audit-level=high` as a **blocking** CI step
      (remove `continue-on-error: true`). Closes the "pnpm audit is
      informational" known limitation.
- [ ] Add a `license-check` CI step that verifies all dependencies are
      compatible with Apache-2.0 (using a tool like `license-checker`).
- [ ] Add cross-platform verification that `generate --write` produces
      byte-identical output on all three OS matrices (extending the
      existing `.gitattributes` LF enforcement with a CI-level diff check).

#### 5. Documentation completeness audit

- [ ] Verify every CLI command has a complete `cli-reference.md`
      section (flags, examples, exit codes, JSON output, safety notes).
- [ ] Verify every diagnostic code is documented in `diagnostics.md`
      with a `what`/`why`/`fix` entry in the `explain` registry.
- [ ] Verify every schema field is documented in `contract-reference.md`.
- [ ] Verify every ADR is listed in `docs/decisions/README.md`.
- [ ] Add a `docs/specification/upgrade-guide.md` for users migrating
      from pre-0.4.0 contracts (documenting the `upgrade` command and any
      field additions since v0.1.0).

### v0.9.0 exit criteria

- The public API surface is frozen and tested against drift.
- Every ADR's reconsideration trigger is resolved or explicitly
  documented as still-open.
- Every threat-model known limitation is closed or explicitly accepted
  with a documented rationale for 1.0.
- `pnpm audit` is blocking; license check passes.
- Documentation audit is complete; zero gaps between implementation
  and docs.
- 550+ tests pass.

---

## Milestone 5 — 1.0.0 Release (v1.0.0)

**Theme:** The contract, CLI, adapters, evidence model, and public API
are stable, documented, tested, and adopted. 1.0.0 is a _commitment_,
not just a version number.

### v1.0.0 deliverables

#### 1. Final ADR sweep

- [ ] **ADR-0045: 1.0.0 release decision.** Documents that all
      Milestone 1–4 exit criteria are met, the pre-1.0 stability policy
      ([ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md))
      is superseded by full SemVer guarantees, and the
      "experimental" qualifier is removed from all public API exports.
      This ADR is the formal sign-off that the project is ready for 1.0.

#### 2. SemVer commitment

- [ ] Update `docs/specification/api-stability.md` to reflect full
      SemVer guarantees: breaking changes require a major version bump.
      The pre-1.0 tiered policy is preserved as a historical reference.
- [ ] Update `GOVERNANCE.md` to note that post-1.0, specification
      changes (schema shape, diagnostic code semantics, exit codes) require
      a major version bump and a public RFC process (as described in
      GOVERNANCE.md's "When a broader RFC may eventually be required"
      section — 1.0 triggers that escalation).

#### 3. Release artifacts

- [ ] Tag `v1.0.0`. Publish to npm with provenance.
- [ ] Create a GitHub Release with a comprehensive changelog covering
      all changes from v0.3.0 → v1.0.0.
- [ ] Publish the v1 compatibility corpus as a standalone artifact.
- [ ] Update README.md to remove the "pre-1.0" qualifier and update
      the project status section.

#### 4. Adoption validation

- [ ] At least 3 external repositories (not owned by the project
      author) have adopted Agent-Ready and reported successful usage.
      These serve as real-world validation that the contract, CLI, and
      adapter output are fit for purpose.
- [ ] At least 1 external repository uses `verify --execute --record`
      in CI as a blocking step.

### v1.0.0 exit criteria

- All Milestone 1–4 exit criteria remain met.
- Full SemVer guarantees are in effect.
- External adoption validation is documented.
- The project standing document (`docs/project-standing.md`) reflects
  1.0 status with no "pre-1.0" caveats.

---

## Summary: version → milestone → key deliverables

| Version    | Milestone             | Key deliverables                                                                                                                                                                                                                 |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.4.0** | Adoption & Polish     | npm publication, `upgrade` command, threat-model hardening (depth guard, SHA-pinned Actions, source size cap), GitHub Release automation                                                                                         |
| **v0.5.0** | Richer Contract (1/2) | `architecture` block, `agents` block, extended `analyze` for architecture decisions, updated adapter output & golden fixtures                                                                                                    |
| **v0.6.0** | Richer Contract (2/2) | Structured handoff evidence (`--handoff`), per-command `timeout`, `verify --execute --check-generate` drift detection                                                                                                            |
| **v0.7.0** | Broader Analysis      | `analyze --architecture` import-graph boundary checking, framework-specific examples (Python, Rust, Go)                                                                                                                          |
| **v0.8.0** | Ecosystem             | Multi-language `doctor` probing (Python/Rust/Go), external adapter registration mechanism                                                                                                                                        |
| **v0.9.0** | Stabilization         | Public API freeze, ADR reconsideration audit, remaining threat-model hardening (case-insensitive paths, symlink enforcement, SIGKILL escalation), CI hardening (blocking audit, license check), documentation completeness audit |
| **v1.0.0** | 1.0 Release           | Full SemVer commitment, external adoption validation, final ADR sweep, release artifacts                                                                                                                                         |

---

## ADRs required for the path to 1.0

| ADR  | Version | Title                                               |
| ---- | ------- | --------------------------------------------------- |
| 0027 | v0.4.0  | npm package publication strategy                    |
| 0028 | v0.4.0  | `agent-ready upgrade` command                       |
| 0029 | v0.4.0  | YAML depth guard                                    |
| 0030 | v0.4.0  | SHA-pinned GitHub Actions                           |
| 0031 | v0.4.0  | Instruction-source size cap                         |
| 0032 | v0.5.0  | `architecture` schema block                         |
| 0033 | v0.5.0  | `agents` schema block                               |
| 0034 | v0.6.0  | Structured handoff evidence model                   |
| 0035 | v0.6.0  | Per-command metadata fields (`timeout`)             |
| 0036 | v0.6.0  | `verify --execute --check-generate`                 |
| 0037 | v0.7.0  | Architecture-dependency drift analysis              |
| 0038 | v0.8.0  | Multi-language runtime probing in `doctor`          |
| 0039 | v0.8.0  | External adapter registration                       |
| 0040 | v0.9.0  | Public API freeze for 1.0                           |
| 0041 | v0.9.0  | Pre-1.0 audit and ADR reconciliation                |
| 0042 | v0.9.0  | Case-insensitive path conflict detection            |
| 0043 | v0.9.0  | Symlink boundary enforcement for `generate --write` |
| 0044 | v0.9.0  | `verify --execute` SIGKILL escalation               |
| 0045 | v1.0.0  | 1.0.0 release decision                              |

---

## What remains explicitly out of scope through 1.0

These items are **not** in this roadmap. They may be revisited post-1.0,
but are excluded from the 1.0 scope by design:

- **Hosted service / Agent-Ready Cloud** — dashboards, cross-repo
  visibility, hosted checks, historical evidence retention, team
  permissions, enterprise auth, compliance exports. These are the
  commercial direction, not the open-source 1.0 scope.
- **LLM calls / AI-generated configuration** — the zero-LLM posture is
  permanent for the local CLI.
- **Telemetry / analytics** — no usage data is collected, ever.
- **IDE extensions** — a future direction, not a 1.0 deliverable.
- **Documentation website** — README + `docs/` Markdown remains the
  documentation surface through 1.0. A marketing/docs website is a
  post-1.0 consideration.
- **Monorepo contract inheritance / nested contracts** — explicitly
  rejected in [ADR-0004](docs/decisions/0004-repository-and-contract-discovery.md);
  revisiting requires a new ADR and is not planned for 1.0.
- **`env` / `workingDirectory` fields on commands** — rejected in
  [ADR-0006](docs/decisions/0006-command-representation.md); the
  security boundary (no environment interpolation, repo root is always
  the working directory) is permanent.
- **`quality_gates` schema block** — overlaps substantially with the
  existing `verification.required` field; no use case has emerged that
  justifies a second, parallel mechanism.
- **Task packets and context manifests** — deferred directions from the
  existing ROADMAP.md; the handoff evidence model in v0.6.0 addresses
  the immediate need. Full task/context packets are post-1.0.
- **`agent-ready audit` / `sync` / `score` subcommands** — `sync` is
  redundant with `generate` (which already compiles a contract into
  adapter output with dry-run/`--check`/`--write` semantics);
  `audit` and `score` have no validated use case yet.
- **GitHub App integration** — a hosted-service feature, not a local
  CLI capability.
- **A GitHub Action product** — the existing composite `action.yml` is
  a reusable CI integration, not a standalone product. A paid/managed
  Action product is commercial direction, not 1.0 scope.
- **Plugin/adapter loading with lifecycle hooks** — the v0.8.0 external
  adapter registration is a single-function render call, not a plugin
  system. Full plugin architecture is post-1.0.
- **Automatic repository modification** — Agent-Ready never modifies
  source code, only declared output files (`generate --write`) and the
  evidence file (`verify --execute --record`). The `upgrade --write`
  command modifies only `agent-ready.yaml` itself.
- **Capturing command stdout/stderr as evidence** — the security
  boundary of never capturing command output is permanent, per
  [ADR-0014](docs/decisions/0014-verification-execution.md) and
  [ADR-0015](docs/decisions/0015-verification-evidence-recording.md).
