# ADR-0023: `agent-ready doctor` command — environment and tooling fitness check

## Status

Accepted.

## Context

[ADR-0021](0021-cli-package-maturity-direction.md) named `agent-ready doctor`
as the second Path A command to ship, sequenced `doctor` → `explain` →
`init` after `agent-ready schema` (ADR-0022 — now shipped). ADR-0021's
prompt-text sketched the role:

> read-only environment inspection (Node/runtime versions, `git` on `PATH`,
> declared `environment.runtimes`/`environment.packageManager`) reusing the
> `GitClient`/ext-`execFile` pattern ADR-0013 established. Agent-Ready-
> hardcoded argv only — exactly like `check`'s `git` invocations.

This ADR scopes that into a concrete command: its contract-loading
behavior, the specific checks it performs, the per-check vs diagnostic
shape, exit-code policy, and the new `BinaryClient` abstraction
required to (a) test fake-friendly and (b) keep probe argv Agent-Ready-
hardcoded per ADR-0013.

The motivation is the same adoption-friction reduction ADR-0021 calls
out: a contributor on a fresh machine, a CI job on a clean runner, and
a maintainer returning to an old branch all want a single command that
answers "is my local environment fit to run the rest of Agent-Ready
against this contract?" without reading the spec or shelling out
`node --version && git --version && pnpm --version` by hand.

## Alternatives considered

- **Should `agent-ready doctor` load a contract?**
  - _Skip contract loading_: doctor would just report "Node v20.10.0;
    git 2.43 on PATH; pnpm 10.0.0 installable." Useful, but it answers
    "what is installed?" rather than "is this repo's environment fit?"
    Doctor is also the only post-`schema` Path A command whose purpose
    is comparison against contract-declared values; without a baseline
    the comparison cannot happen.
  - _Load contract_: doctor can compare detected values against
    `environment.runtimes` and `environment.packageManager`. The
    contract is what makes doctor load-bearing.
  - **Selected: load contract.** Same `loadContract(...)` pattern
    `check`/`analyze`/`verify` already use. Without a contract
    doctor's "fitness" claim has no fixed reference, and the command
    collapses to a wrapper around three `execcp` calls.

- **Reuse existing `GitClient`, extend `GitClient`, or introduce a
  parallel `BinaryClient` for binary probes?**
  - _Inline `execFile`_: works for production, but tests cannot
    substitute a fake for the `git --version` probe without intercepting
    process spawning. Doctor unit tests would shell out to real
    binaries on the test runner, and the same problem recurs for
    `pnpm --version` / `npm --version` / `yarn --version`.
  - _Extend `GitClient` with `getBinaryInfo(root)`_: same boundary
    shape as the existing `isRepository` and `getChangedFiles`. The
    production implementation uses hardcoded argv (`git --version`)
    per [ADR-0013](0013-protected-path-enforcement-and-git-invocation.md);
    `FakeGitClient` is extended to control availability and version.
    Conflates git-version with git-repository operations on the same
    surface.
  - _Introduce a separate `BinaryClient` interface (parallel to
    [`src/git/`](../../src/git/))* with a single
    `probe(target, root)` method covering `git`, `pnpm`, `npm`,
    and `yarn`. One fake-friendly boundary for every binary probe;
    future ADRs (e.g. for `rust`, `python`) extend the `target` enum
    without growing any other boundary.
  - **Selected: introduce a new `BinaryClient`**. Two reasons
    extending `GitClient` is wrong: (a) git-version is no more
    git-specific than pnpm-version is git-specific, so git's
    interface shouldn't grow a generic binary probe; (b) the
    `FakeGitClient` would end up carrying a `package-manager`-shaped
    field, leaking unrelated semantics onto the git boundary.
    ADR-0013's invariants (no shell, no caller-supplied argv, every
    argv pair is hardcoded) extend verbatim to `BinaryClient.probe`.

- **JSON envelope shape: per-check pass/fail/warn array, or pure
  diagnostics?**
  - _Pure diagnostics_: doctor emits one or more `Diagnostic` records
    and uses the existing `--json` shape.
  - _Per-check results array **plus** diagnostics_: each individual
    check (runtime, package manager, git) gets a structured
    `{ check, declared, detected, status, summary }` record. Tools
    that want to inspect each axis independently don't have to parse
    human-readable diagnostic text.
  - **Selected: per-check array + diagnostics**, both. The shape is
    `{ ok, contractPath, repoRoot, checks, diagnostics }` —
    `analyze`'s `{ ok, contractPath, repoRoot, sources, findings,
diagnostics }` and `check`'s `{ ok, contractPath, repoRoot,
changedFiles, violations, diagnostics }` already established this
    pattern; doctor extends it with a `checks` array since doctor
    has more independent axes than those commands.

- **Exit-code strategy: per-check or aggregated?**
  - _Per-check_: failing checks emit non-zero immediately; CI scripts
    cannot tell "at least one failed" from "one failed but I'm done".
  - _Aggregated_: `ok: false` whenever any check has a fatal outcome;
    single non-zero exit code mapped through the existing
    `resolveExitCode(diagnostics)`.
  - **Selected: aggregated.** Matches `check`/`verify`/`validate`/
    `analyze` — every other command converges to a single exit code
    per invocation, and CI scripts can read `checks` for granularity.

- **What exactly should doctor probe?**
  - _Only Node version_: misses git/package-manager; not "the four
    signals" ADR-0021 named.
  - _Everything reachable_: maximal but unfocused.
  - **Selected: the four signals the path-A proposal anticipates**
    — Node (via `process.version`); declared
    `environment.runtimes` (with `node` compared; non-`node` runtimes
    produce an `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` warning rather
    than a probe this ADR); declared `environment.packageManager`;
    `git --version`. Future ADRs may extend the runtime probe set.

- **Severity model for checks?**
  - _Binary pass/fail only_: loses the distinction between "git is
    missing but not required" and "git is missing and required."
  - _Three states: pass, warn, fail_: distinguishes required-but-missing
    from "available, but unexpected" from "all clear."
  - **Selected: three states.** Doctor's value comes from that
    distinction ("you declared `paths.protected` but git isn't here"
    vs "you didn't declare `paths.protected` so git not being here
    is fine").

## Decision

- **New `src/cli/commands/doctor.ts`** exporting
  `runDoctor(git: GitClient, binary: BinaryClient, args, startDir?)`
  returning `Promise<CliOutcome>`. The `(boundaries, args, startDir)`
  shape extends `runCheck` (`src/cli/commands/check.ts`) — which
  takes only `git` — by accepting a second narrow boundary
  (`binary`) so the unit-test plan can inject `FakeBinaryClient`
  without spawning any process. Both boundaries are constructed in
  [`src/cli/index.ts`](../../src/cli/index.ts) at composition time
  (`NodeGitClient` + `NodeBinaryClient`); unit and integration tests
  substitute `FakeGitClient` + `FakeBinaryClient`. The `FileSystem`
  parameter is implicit via the contract pipeline (no direct
  `FileSystem` argument, matching the project's intent of a narrow
  file-system boundary injected only at the CLI composition layer).
- **Wired into `src/cli/index.ts`** via commander following the
  existing per-command pattern.
- **Add [`src/binary/types.ts`](../../src/binary/types.ts),
  [`src/binary/nodeBinaryClient.ts`](../../src/binary/nodeBinaryClient.ts)**,
  and **[`src/binary/fakeBinaryClient.ts`](../../src/binary/fakeBinaryClient.ts)**,
  parallel in shape and discipline to [`src/git/`](../../src/git/):
  ```ts
  // src/binary/types.ts
  export type BinaryTarget = "git" | "pnpm" | "npm" | "yarn";

  export interface BinaryClient {
    /**
     * Probe whether `target` is on PATH and return its `cmd --version`
     * output. Returns `undefined` if the binary is unavailable. The
     * real implementation always shells the Agent-Ready-hardcoded argv
     * pair `[<target>, "--version"]`; the argv cannot vary. ADR-0013's
     * invariants apply verbatim to this method.
     *
     * `root` mirrors the parameter shape of `GitClient.isRepository(root)`
     * and `GitClient.getChangedFiles(root)`. Call-site signature is
     * intentionally parallel to those methods; the argument is currently
     * unused by the real `NodeBinaryClient` implementation but uniform
     * with the existing `GitClient` boundary.
     *
     * Output shape: `pnpm --version` / `npm --version` / `yarn --version`
     * return `MAJOR.MINOR.PATCH` (no `v` prefix); `git --version` returns
     * `git version MAJOR.MINOR.PATCH`. Both are fed to `semver.satisfies`
     * directly — no `semver.major` extraction, no `v`-prepending.
     */
    probe(
      target: BinaryTarget,
      root: string,
    ): Promise<{ version: string; path: string } | undefined>;
  }
  ```
  `FakeBinaryClient` exposes a constructor option like
  `{ git: { version, path }, pnpm: undefined, npm: ... }` mapping
  each `BinaryTarget` to either its detected version/path or
  `undefined` to mean "unavailable." Doctor unit tests exercise
  every check without spawning any process.
- **No contract schema change.** No new public API surface exported
  from [`src/index.ts`](../../src/index.ts). `runDoctor` is internal.

**Contract loading**: same as `check`/`analyze`/`verify` —
`loadContract({ fs, startDir, ... })`; on failure return
`CliOutcome` with `ExitCode.CONTRACT_NOT_FOUND` (2) and the load
diagnostics, mirroring how `check` handles contract load failure.

**Checks performed (always, in this order)**:

1. **node** — detected via `process.version`. Declared value comes
   from `contract.environment.runtimes["node"]` if present. Pass if
   `semver.satisfies(process.version, declaredRange)` returns true.
   Fail (`RUNTIME_VERSION_MISMATCH`) otherwise. When `node` is not
   declared in `environment.runtimes` the `runtime-node` row carries
   `status: "warn"`, no `declared`, no diagnostic, and a `summary`
   explaining doctor has no declared baseline to compare against.

2. **runtime-other** — for every non-`node` key in
   `contract.environment.runtimes` (`python`, `ruby`, `go`, etc.),
   doctor emits **one row per declared runtime, named
   `runtime-other-<name>`** (e.g. `runtime-other-python`,
   `runtime-other-ruby`). Every such row has `status: "warn"`,
   `declared: <declared-range>`, `detected: null` (no probe in this
   ADR), a `summary` explaining the limitation, and the
   `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` diagnostic. The
   `runtime-other` keys are not the focus of this ADR; future ADRs
   may graduate specific runtimes (e.g. `python`) to first-class
   `BinaryClient.probe` targets.

3. **package-manager** — detected by
   `binaryClient.probe(target, root)` where `target` is `pnpm` |
   `npm` | `yarn` derived from
   `contract.environment.packageManager.name`. Pass if
   `semver.satisfies(detected.version, contract.environment.packageManager.version)`
   returns true. Fail (`PACKAGE_MANAGER_UNAVAILABLE`) if the
   package-manager is declared but `probe` returns `undefined`. Fail
   on version mismatch with `PACKAGE_MANAGER_VERSION_MISMATCH`. The
   `probe` output (`pnpm --version` → `MAJOR.MINOR.PATCH` no
   `v`-prefix; `npm`/`yarn` analogously) is fed to
   `semver.satisfies` directly — no `semver.major` extraction, no
   `v`-prepending.

4. **git-on-path** — `binaryClient.probe('git', root)`. Required iff
   `contract.paths.protected.length > 0` (since `agent-ready check` is
   the only Agent-Ready command whose existence `paths.protected`
   makes load-bearing). Warn if git is missing and `paths.protected`
   is empty. Fail (`GIT_REQUIRED_BUT_UNAVAILABLE`) if git is missing
   and `paths.protected` is declared. If `probe` itself throws (a
   Node-side `execFile` failure distinct from "binary not on PATH"),
   reuse the existing `GIT_UNAVAILABLE` from
   [ADR-0013](0013-protected-path-enforcement-and-git-invocation.md)
   for that specific case — same code, same exit-code bucket.

5. **git-repository** — `gitClient.isRepository(root)`. Warn
   (informational) if not a git repo and `paths.protected` is
   declared. This is separate from `git-on-path` because git can be
   installed while the cwd is not a git working tree.

**Flags**:

- `--json` — structured JSON output (uniform with every other
  command).
- `--config <path>` — same semantics as the rest of
  `cli/commands/*`.

  No new flag invented in this ADR.

**Diagnostics (new codes, additive per
[ADR-0009](0009-pre-1.0-stability-policy.md))**:

| Code                                  | Severity | Meaning                                                                      |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `RUNTIME_VERSION_MISMATCH`            | error    | Declared runtime range does not satisfy detected runtime version.            |
| `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` | warning  | Non-`node` runtime declared; doctor does not probe that runtime in this ADR. |
| `PACKAGE_MANAGER_UNAVAILABLE`         | error    | Declared package manager binary not found on PATH.                           |
| `PACKAGE_MANAGER_VERSION_MISMATCH`    | error    | Detected package-manager version does not satisfy declared range.            |
| `GIT_REQUIRED_BUT_UNAVAILABLE`        | error    | `paths.protected` is declared but `git` is not on PATH.                      |

(All five added to `src/diagnostics/codes.ts`.)

**JSON output**: the same envelope as `validate` / `inspect` /
`generate` / `check` / `analyze` / `verify` —
`{ ok, contractPath, repoRoot, checks, diagnostics }` — with a
**uniform per-check row shape** so programmatic consumers do not
have to dispatch on `check` type. Every check row carries at least:

- `check` (string, the canonical axis name: `runtime-node`,
  `runtime-other-<name>` (one row per declared non-`node` runtime,
  e.g. `runtime-other-python`), `package-manager`, `git-on-path`,
  `git-repository`).
- `status` (one of `"pass" | "warn" | "fail"`).

Conditionally present per row:

- `declared` (string or object) — the contract-supplied value this
  check is comparing against, when one exists.
- `detected` (string, object, boolean, or `null`) — what doctor
  found on the host. Shape mirrors `declared` for binary probes;
  `null` means "not found on PATH." Boolean for `git-repository`'s
  cwd-is-git-work-tree assertion.
- `required` (boolean) — present for `git-on-path` and
  `git-repository` checks; true iff `paths.protected` is non-empty.
- `summary` (string, optional) — a human-readable one-liner used by
  the human renderer; `--json` consumers can ignore it. Present
  whenever the row's status is `"fail"` or `"warn"`.

`diagnostics` follows the existing
[ADR-0008](0008-diagnostics-and-exit-codes.md) shape — `code`,
`severity`, `summary`, `field`, `remediation`. The five codes in
this ADR are additive per [ADR-0009](0009-pre-1.0-stability-policy.md);
nothing existing is renamed or repurposed.

Example (default, mixed-pass-fail):

```json
{
  "ok": false,
  "contractPath": "/path/to/agent-ready.yaml",
  "repoRoot": "/path",
  "checks": [
    {
      "check": "runtime-node",
      "status": "pass",
      "declared": ">=20 <23",
      "detected": "v20.10.0"
    },
    {
      "check": "runtime-other-python",
      "status": "warn",
      "declared": ">=3.10",
      "detected": null,
      "summary": "doctor does not probe python in this ADR."
    },
    {
      "check": "package-manager",
      "status": "fail",
      "declared": { "name": "pnpm", "version": "10" },
      "detected": null,
      "summary": "Declared package manager pnpm is not on PATH."
    },
    {
      "check": "git-on-path",
      "status": "pass",
      "required": true,
      "detected": { "version": "git version 2.43.0", "path": "/usr/bin/git" }
    },
    {
      "check": "git-repository",
      "status": "pass",
      "required": false,
      "detected": true
    }
  ],
  "diagnostics": [
    {
      "code": "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
      "severity": "warning",
      "summary": "Declared runtime python is not probed by doctor in this ADR.",
      "field": "/environment/runtimes/python",
      "remediation": "Track ADR-0023 follow-ups; future ADRs may graduate python to a first-class BinaryClient.probe target."
    },
    {
      "code": "PACKAGE_MANAGER_UNAVAILABLE",
      "severity": "error",
      "summary": "Declared package manager pnpm is not on PATH.",
      "field": "/environment/packageManager",
      "remediation": "Install pnpm or update environment.packageManager to match an installed manager."
    }
  ]
}
```

**Human output** (default, success):

```text
Agent-Ready doctor - repoRoot: /path

  [pass] runtime-node: detected v20.10.0 satisfies declared ">=20 <23"
  [pass] package-manager: detected pnpm 10.0.0 satisfies declared "10"
  [pass] git-on-path: detected git 2.43.0
  [pass] git-repository: cwd is inside a Git working tree

All 4 checks pass.
```

**Human output** (failure):

```text
Agent-Ready doctor - repoRoot: /path

  [pass] runtime-node: detected v20.10.0 satisfies declared ">=20 <23"
  [fail] package-manager: declared pnpm 10 but no pnpm found on PATH
  [pass] git-on-path: detected git 2.43.0
  [pass] git-repository: cwd is inside a Git working tree

error[PACKAGE_MANAGER_UNAVAILABLE]: Declared package manager pnpm is not on PATH.
  field: /environment/packageManager
  suggestion: Install pnpm or update environment.packageManager to match an installed manager.
```

**Exit codes** (existing 5-value scheme per
[ADR-0009](0009-pre-1.0-stability-policy.md) and
[ADR-0008](0008-diagnostics-and-exit-codes.md)):

- `0` — every check passes or warns.
- `1` — at least one check failed (a diagnostic with severity `error`
  surfaced through `resolveExitCode`).
- `2` — contract load failed (matches `check`/`analyze`/`verify`'s
  existing behavior).
- `10` — `binaryClient.probe('git', root)` throws unexpectedly
  (existing `GIT_UNAVAILABLE` from
  [ADR-0013](0013-protected-path-enforcement-and-git-invocation.md)).

  The new diagnostic codes map to `1` via `resolveExitCode`'s
  default-error branch.

**Tests**:

- **Unit** — `tests/unit/doctor.test.ts`. Use `FakeGitClient`
  (existing) for `isRepository`; `FakeBinaryClient` (new) with
  per-target availability/version control; `InMemoryFileSystem`
  with a fixture contract. Cover the matrix:
  - all-pass happy path (`process.version` matches, pnpm matches,
    git available, git repo).
  - `node` declared but `process.version` does not satisfy — emit
    `RUNTIME_VERSION_MISMATCH`, `checks[].status: "fail"`, exit 1.
  - `node` not declared in `environment.runtimes` — `runtime-node`
    row has `status: "warn"`, no `declared`, no diagnostic, exit 0
    (no baseline to compare against; warning is informational, never
    a fail).
  - non-`node` runtime declared — emit one
    `runtime-other-<name>` row per declared key, each with
    `status: "warn"` and `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`,
    exit 0. Multi-key declared (e.g. `python` + `ruby`) yields two
    separate rows.
  - package manager declared but `binaryClient.probe` returns
    `undefined` — emit `PACKAGE_MANAGER_UNAVAILABLE`, exit 1.
  - declared package manager major version mismatch — emit
    `PACKAGE_MANAGER_VERSION_MISMATCH`, exit 1.
  - `paths.protected` declared but `binaryClient.probe('git', ...)`
    returns `undefined` — emit `GIT_REQUIRED_BUT_UNAVAILABLE`, exit 1.
  - `paths.protected` empty and git missing — warn only, exit 0.
  - `paths.protected` declared but cwd is not a git working tree
    while git is installed — warn on `git-repository`, exit 0.
  - `--json` shape exactly matches the documented per-check field
    set (every row carries `check` and `status`; conditional
    fields `declared`, `detected`, `summary`, `required` per check
    type).
  - `BinaryClient.probe` throws (execFile-side error) — emit
    `GIT_UNAVAILABLE` (existing ADR-0013 code, exit 10).

- **Integration** — `tests/integration/doctorCli.test.ts`.
  End-to-end via `runDoctor(...)` against a `mkdtemp` working tree
  containing a fixture contract. Use `FakeGitClient` for git-repo
  checks and `FakeBinaryClient` for binary probes (mirroring the
  unit-test setup); verify exit code, default `--json` shape, and
  human output text content per the
  [`check`](../../tests/integration/checkCli.test.ts) precedent.

## Consequences

- `agent-ready doctor` is the second Path A command shipped. Path A's
  post-`schema` sequence (`doctor` → `explain` → `init`) advances one
  step.
- The contract's `environment` block becomes load-bearing for CI for
  the first time: adopters can gate `agent-ready verify --execute`
  on a preceding `agent-ready doctor` job, and capture environment
  fitness in a single command instead of a hand-rolled `node --version
&& git --version && pnpm --version` script.
- One new `BinaryClient` interface (with `FakeBinaryClient`) makes
  git-version and package-manager-version probes testable through
  one fake-friendly boundary. `GitClient` is unchanged —
  `[ADR-0013](0013-protected-path-enforcement-and-git-invocation.md)`'s
  invariants (no shell, no caller interpolation into argv) extend
  to `BinaryClient.probe` verbatim without amending the git
  surface.
- Five new diagnostic codes (`RUNTIME_VERSION_MISMATCH`,
  `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`, `PACKAGE_MANAGER_UNAVAILABLE`,
  `PACKAGE_MANAGER_VERSION_MISMATCH`, `GIT_REQUIRED_BUT_UNAVAILABLE`)
  are added to `src/diagnostics/codes.ts`. Additive-only per
  [ADR-0009](0009-pre-1.0-stability-policy.md).
- `--json` output gains an additive `checks` field; nothing
  existing is renamed or repurposed.
- `action.yml`'s `command` input does **not** gain `doctor` in this
  ADR's PR. Following the `analyze`/`schema` precedent
  ([ADR-0022](0022-agent-ready-schema-command.md)'s decision), the
  composite-action extension is a separate, future PR.

## Reconsideration trigger

- If `agent-ready check` grows new git-related probes (e.g. LFS
  presence, sparse-checkout status), doctor's `git-on-path` /
  `git-repository` checks should optionally surface those, but only
  via a follow-up ADR.
- If the contract gains new environment fields (per
  [`docs/specification/config-evolution-draft.md`](specification/config-evolution-draft.md)'s
  draft `quality_gates:` etc.), doctor may need to revisit which
  fields it consumes and what counts as "failed fitness."
- If a `BinaryChecker` plugin interface becomes useful — i.e. a
  third-party needs to add a new runtime probe (`python`, `ruby`,
  `rust`, etc.) without a core ADR — extend the existing
  `BinaryClient` interface (e.g. by widening `BinaryTarget` to a
  type union) rather than introducing a parallel boundary. The
  current interface is already shaped for that growth: `probe`
  accepts an enumerated target and adds new entries with a single
  type-union widening.
- If a doctor's `--fix` mode ("auto-install missing requirements")
  is ever requested, that's a write boundary crossing and warrants
  its own ADR with explicit `init`-style `--force` semantics.
