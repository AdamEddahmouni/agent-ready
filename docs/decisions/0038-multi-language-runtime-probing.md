# ADR-0038: Multi-language runtime probing in `doctor`

## Status

Accepted. Targeted at v0.8.0.

## Context

[ADR-0023](0023-agent-ready-doctor-command.md) shipped `agent-ready doctor`
probing four signals: Node (`process.version`), the declared package manager
(`pnpm`/`npm`/`yarn`, via `BinaryClient`), `git` on `PATH`, and Git working-tree
membership. Any other declared `environment.runtimes` key — `python`, `rust`,
`go`, or anything else — produces a `runtime-other-<name>` row with
`status: "warn"` and the `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` diagnostic.
ADR-0023's own reconsideration trigger named this expansion explicitly:
"extend the existing `BinaryClient` interface (e.g. by widening `BinaryTarget`
to a type union) rather than introducing a parallel boundary."

This is now load-bearing, not hypothetical: v0.7.0's `examples/python-fastapi/`,
`examples/rust-cli/`, and `examples/go-service/` each declare exactly one
non-`node` runtime, and each one's README explicitly says "a fully clean
`doctor` run requires v0.8.0" — a promise this ADR is what fulfills.

Widening `BinaryTarget` looked at first like it might hit the same kind of
wall the v0.7.0 work found twice (`FileSystem.readDirectory`,
`architecture.boundary_rules`): `BinaryClient.probe`'s docstring and every
call site assume the argv pair is always `[<target>, "--version"]`. Checked
directly rather than assumed: `python --version` and `cargo --version` both
work exactly like `pnpm --version` (confirmed on this machine). `go
--version` does not — Go's CLI rejects `--version` as an undefined flag; the
correct invocation is the bare subcommand `go version` (confirmed via
[go.dev's own version command documentation](https://go.dev/src/cmd/go/internal/version/version.go)
and multiple `golang/go` issue reports describing the `--version` rejection).

This is not actually the wall it first appeared to be. ADR-0013's real
invariant, read precisely, is "every argv pair is either hardcoded or a
validated discrete element — no contract-declared or caller-supplied content
ever reaches an argument list," not "the flag is textually `--version` for
every target." A per-target hardcoded argv lookup satisfies that invariant
exactly as well as a single shared literal did; `go`'s argv being `["version"]`
instead of `["--version"]` is still a compile-time constant no external input
can reach.

## Decision

Widen `BinaryTarget` to `"git" | "pnpm" | "npm" | "yarn" | "python" | "cargo" | "go"`
and graduate `python`, `rust`, and `go` from `runtime-other-<name>`'s warn-only
row to a real, pass/fail-checked probe — the same treatment `node` already
gets, not a new mechanism.

### `BinaryClient` / `NodeBinaryClient`

- `probe`'s argv is now resolved from a hardcoded, per-target lookup rather
  than a single shared `["--version"]` literal:
  `git`/`pnpm`/`npm`/`yarn`/`python`/`cargo` → `["--version"]`;
  `go` → `["version"]`. Still fully Agent-Ready-controlled, per ADR-0013 —
  the lookup key is `BinaryTarget`, an enum value, never contract- or
  CLI-argument-supplied text.
- Version-string extraction: `python --version` (`Python 3.13.14`) and
  `cargo --version` (`cargo 1.96.0 (30a34c682 2026-05-25)`) both already flow
  through the existing generic "skip a leading non-digit token" branch with
  **no code change** — confirmed by running both on the implementation
  machine before writing this ADR, not assumed from documentation.
- `go version` (`go version go1.22.0 linux/amd64`) does not fit that branch:
  the version-bearing token itself carries a literal `go` prefix
  (`go1.22.0`, not `go 1.22.0`), and the generic branch would return the
  literal word `"version"` instead. A `go`-specific branch strips the
  `go version ` preamble, takes the next token, and strips its `go` prefix.
  Go's release versioning has historically shipped an initial `goX.Y`
  two-component release before any `goX.Y.Z` patch exists (e.g. `go1.21`
  before `go1.21.1`); `semver.satisfies` rejects a bare two-component
  string, so a version lacking a patch component has `.0` appended. This is
  a targeted normalization of Go's own versioning convention, in the same
  spirit as `git`'s existing special-cased prefix handling — not a reversal
  of the file's stated "never `semver.clean` or otherwise mangle the version
  text" principle, which is about not silently coercing garbage input, not
  about refusing to understand one ecosystem's well-documented version
  grammar.
- **`rust` maps to the `cargo` binary, not a `rust` binary — there is no
  `rust` executable.** `cargo` is what `examples/rust-cli/`'s declared
  commands actually invoke, and `cargo`/`rustc` version in lockstep under
  the overwhelmingly common `rustup` toolchain-management path, so `cargo`
  is a reasonable single proxy for "is the Rust toolchain here and at the
  right version" — mirroring how `node` itself, not some node-ecosystem
  tool, is what `environment.runtimes.node` is checked against.
- `python` probes the literal `python` binary. Some Linux distributions
  install only `python3`, not `python`; this ADR does not add a
  fallback-candidate chain (`try python, then python3`) — `BinaryClient.probe`
  is a single hardcoded target per call, and turning it into a
  first-match-wins search is new control flow this ADR does not need. Noted
  as a reconsideration trigger below.

### `doctor`

- A new `RUNTIME_PROBE_TARGETS: Readonly<Record<string, BinaryTarget>>` map
  (`{ python: "python", rust: "cargo", go: "go" }`) determines which declared
  runtime names get probed. For a runtime name present in the map, `doctor`
  probes the mapped binary and compares with `semver.satisfies`, exactly
  like the existing `node`/package-manager checks: `status: "pass"` on
  match, `status: "fail"` plus `RUNTIME_PROBE_UNAVAILABLE` if the binary
  isn't on `PATH`, `status: "fail"` plus `RUNTIME_PROBE_VERSION_MISMATCH` on
  a version that doesn't satisfy. The check row is named `runtime-<name>`
  (`runtime-python`, `runtime-rust`, `runtime-go`), parallel to `runtime-node`.
- A declared runtime name **not** in the map keeps today's unchanged
  behavior: `runtime-other-<name>`, `status: "warn"`,
  `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`. `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`
  itself is unchanged — it simply stops firing for `python`/`rust`/`go`
  specifically, since those are no longer unsupported, and continues to
  fire for anything else (`ruby`, `java`, ...).
- Two new diagnostics, mirroring the package-manager check's existing split
  rather than overloading `RUNTIME_VERSION_MISMATCH` (whose `explain` text
  is Node-specific — "Install a Node version... `nvm install 22`" — and
  would be actively wrong advice if reused verbatim for a Python or Go
  mismatch):
  - `RUNTIME_PROBE_UNAVAILABLE` — the mapped binary is not on `PATH`.
  - `RUNTIME_PROBE_VERSION_MISMATCH` — the detected version does not
    satisfy the declared range.

### Contract surface

No schema change. This ADR is entirely CLI-side (probing and reporting);
`environment.runtimes` already accepts any lowercase-alphanumeric key with a
semver-range value, which is all `python`/`rust`/`go` ever needed.

## Alternatives considered

- **A `BinaryChecker` plugin interface**, letting a third party register a
  new runtime probe without a core ADR: this was ADR-0023's own
  longer-term alternative, explicitly deferred there ("if... a third-party
  needs to add a new runtime probe... without a core ADR"). No such need has
  surfaced; three runtimes graduating via a type-union widening is exactly
  the scale ADR-0023 anticipated handling without a plugin mechanism.
- **A fallback-candidate probe chain** (`python` then `python3`; similarly
  for other ecosystems' alternate binary names): rejected for this ADR as
  scope beyond three straightforward graduations — `BinaryClient.probe`
  stays a single hardcoded target per call, consistent with ADR-0013.
- **Reusing `RUNTIME_VERSION_MISMATCH`/`PACKAGE_MANAGER_UNAVAILABLE` for the
  new probes**: rejected. Both diagnostics' `explain` entries name specific
  tools and remediation steps (Node version managers; "Install pnpm or
  update `environment.packageManager`") that would be wrong for a Python or
  Go mismatch. New codes keep every `explain` entry accurate.
- **Coercing Go's two-component version string with `semver.coerce`
  generically**: rejected in favor of a narrow, Go-specific `.0` append,
  to avoid weakening the file's existing "never mangle version text"
  principle into a general policy that could hide a genuinely malformed
  version from any target.

## Consequences

- `examples/python-fastapi/`, `examples/rust-cli/`, and `examples/go-service/`
  now get a fully clean `doctor` run on a machine with the matching toolchain
  installed, instead of one `warn` row each — closing the gap their own
  READMEs and `ROADMAP-TO-1.0.md`'s v0.7.0 section explicitly named as
  requiring v0.8.0.
- `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`'s `explain` entry remains accurate
  without modification: it already says "future ADRs may graduate additional
  runtimes," and this ADR is exactly that for three of them.
- `doctor --json`'s check-row naming changes for `python`/`rust`/`go`
  specifically (`runtime-other-python` → `runtime-python`, etc.). `doctor`'s
  JSON output is not a versioned contract schema surface — it carries the
  same pre-1.0 experimental-API latitude as the rest of the CLI's `--json`
  output per [ADR-0009](0009-pre-1.0-stability-policy.md) — but a consumer
  scripting against the old row name for these three runtimes specifically
  would need to update. Documented here rather than left as a silent
  behavior change.
- `src/binary/types.ts`, `src/binary/nodeBinaryClient.ts` change; `src/binary/fakeBinaryClient.ts`
  needs no change (`FakeBinaryClientOptions` is already generic over
  `BinaryTarget`).
- Five new/changed diagnostics in `src/diagnostics/codes.ts`:
  `RUNTIME_PROBE_UNAVAILABLE`, `RUNTIME_PROBE_VERSION_MISMATCH` (new); no
  existing code is renamed or repurposed. Both get `explain` entries.

## Reconsideration trigger

- If a Linux-only or `python3`-only environment turns out to be common
  enough among adopters that the missing-`python`-binary case causes real
  friction, revisit the "single hardcoded target, no fallback chain"
  decision above.
- If a fourth or fifth runtime needs graduating and each one keeps needing
  its own version-string special case (as `go` did here), the "one
  `normalizeVersion` function with per-target branches" shape may be worth
  restructuring — e.g. one parser function per target — before it grows
  unreadable. Three special-cased branches (`git`, generic, `go`) is not yet
  that point.
- Revisit the "no `BinaryChecker` plugin interface" call if a concrete,
  validated third-party runtime-probe need surfaces, per ADR-0023's own
  longer-term alternative.
