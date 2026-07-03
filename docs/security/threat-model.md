# Threat model (Phase 0-9)

## Trust boundary

Agent-Ready runs locally, as a CLI or an embedded library, operating on
files the invoking user/CI job already has read (and, for `generate
--write` and `agent-ready verify --execute --record`, write; and, for
`agent-ready verify --execute`, execute) access to. There is no network
service, no account, and no remote code path in this phase. The threat model here is specifically about **untrusted
repository content** — a malicious or malformed `agent-ready.yaml`, or
adversarial paths within it — not about a multi-tenant or networked
attacker model.

**One narrow, explicit exception:** `agent-ready verify --execute` runs the
contract's `verification.required` commands as real shell commands (see
[ADR-0014](../decisions/0014-verification-execution.md)). For that one
command only, `commands[].run` is treated as trusted, executable content —
the same trust boundary `package.json` scripts, a `Makefile`'s targets, or
a CI config's `run:` steps already have. Whoever can edit
`agent-ready.yaml` already has write access to those files in the same
repository, so this does not introduce a new privilege boundary; it makes
an existing one (repo-write access implies command-execution access)
explicit for a fifth file. Every other command (`validate`, `inspect`,
`generate`, `check`, and `agent-ready verify` without `--execute`) remains
exactly as non-executing as before — this exception does not widen without
the `--execute` flag being passed by the invoking user.

## Assets

- The integrity of the machine running Agent-Ready (no arbitrary code
  execution triggered by contract content).
- Files outside the repository boundary (no path-traversal read; writes
  are restricted to a hardcoded, repo-root-relative filename per
  adapter — never a contract-supplied path).
- Hand-authored files a user has already created (a `generate --write`
  must never silently overwrite content it did not itself generate).
- Availability (no denial-of-service via pathological input).
- Accuracy of diagnostics (a validator that silently accepts a broken
  contract, or crashes uninformatively, undermines the entire project's
  purpose).

## Untrusted inputs

Treated as untrusted throughout: contract file contents, YAML structures,
declared path/glob patterns, working-directory state, symbolic links
encountered during discovery, project name/description strings, command
strings, instruction-source references, and CLI arguments (`--config`,
and, for `agent-ready check`, `--staged`/`--against <ref>`, and the
`git` executable's own output). **Exception**: `commands[].run` strings
are treated as trusted, executable content specifically by
`agent-ready verify --execute` (and by nothing else) — see "Trust
boundary" above and ADR-0014.

## Controls implemented in this phase

| Risk                                                                                      | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arbitrary code execution via YAML tags                                                    | `yaml` (eemeli/yaml) never resolves tags to executable JS types, unlike `js-yaml`'s unsafe-load mode. See [ADR-0003](../decisions/0003-yaml-parsing-safety.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Command execution via contract content                                                    | Denied by default and limited to one explicit boundary: `run` strings remain inert for every command except `agent-ready verify --execute`, which executes only commands referenced by `verification.required`. See [ADR-0006](../decisions/0006-command-representation.md) and [ADR-0014](../decisions/0014-verification-execution.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| YAML amplification ("billion laughs")                                                     | `maxAliasCount` (100, `yaml`'s default) caps alias/anchor expansion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Oversized input                                                                           | Hard 1 MB size limit (`MAX_CONTRACT_BYTES`) enforced before parsing begins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Silent data loss via duplicate keys                                                       | Duplicate YAML mapping keys are a parse error (`YAML_DUPLICATE_KEY`), not a silent overwrite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Path traversal (`../../etc/passwd`)                                                       | Explicit segment-stack traversal detection in `contract/paths.ts`; rejected as `PATH_TRAVERSAL_DISALLOWED` before any file-system use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Absolute-path escape (POSIX root, Windows drive-letter, UNC)                              | Detected and rejected (`PATH_ABSOLUTE_DISALLOWED`) prior to any normalization that might otherwise "fix" a UNC/drive path into something usable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Environment/secret leakage                                                                | No environment-variable interpolation is ever performed on contract content; diagnostics never include full environment state; ordinary output does not include unrelated local absolute paths beyond the contract/repo paths being validated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Unnecessary remote configuration/code loading                                             | No runtime network calls anywhere in this phase: the JSON Schema is bundled and read from disk (never fetched from its `$id` URL); there are no remote includes, no `.env` auto-loading, and no telemetry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Uninformative crashes on malformed input                                                  | Every expected failure path produces a typed `Diagnostic` (code, summary, remediation) rather than an unhandled exception; only a true internal-invariant violation is caught and reported generically (`INTERNAL_INVARIANT_VIOLATION`), without a raw stack trace in user-facing output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Resource exhaustion from repeated validation                                              | A single CLI invocation runs each pipeline stage exactly once; discovery only stats a bounded number of ancestor directories (`MAX_ANCESTOR_DEPTH = 64`), not a full repository scan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Path escape on write (`generate --write`)                                                 | Output paths are always adapter-hardcoded filenames (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, `GEMINI.md`) joined against the already-verified `repoRoot`, never taken from contract content; `generate.ts` additionally re-checks the joined path resolves inside `repoRoot` before it is ever passed to `writeTextFile` (`GENERATE_OUTSIDE_REPO_ROOT`, expected unreachable in practice — defense in depth).                                                                                                                                                                                                                                                                                                                                                                                                     |
| Clobbering hand-authored files (`generate --write`)                                       | Every file Agent-Ready generates embeds a managed-file marker. `--write` refuses to overwrite an existing target that lacks the marker (`GENERATE_TARGET_UNMANAGED`) unless `--force` is explicitly passed. See [ADR-0010](../decisions/0010-generate-write-boundary.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Silent unintended writes                                                                  | `generate` defaults to a dry run; writing to disk requires the explicit `--write` flag. `validate` and `inspect` never write, and never gain a write flag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Symlink write-through (`generate --write`)                                                | `writeTextFile` uses ordinary `node:fs` write semantics (symlinks followed transparently), consistent with this project's existing discovery-time symlink policy; since output paths are never contract-supplied, an attacker cannot use contract content to redirect a write. Documented limitation, not actively defended against a locally-planted malicious symlink — see "Known limitations" below.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Markdown-structure corruption via contract-supplied free text (`generate`)                | Contract-supplied free text is never interpolated into generated Markdown unescaped: `escapeMarkdownText` neutralizes block-starting/inline-significant CommonMark characters and collapses embedded newlines for plain-text positions (`project.name`, `project.description`, `command.description`); `wrapCodeSpan` computes a backtick-fence length longer than any backtick run in the content for inline-code positions (`command.run`, `runtime.range`, `packageManager.version`, path glob patterns); `renderMarkdownLink` uses CommonMark's angle-bracket destination form for `instructions.sources` paths containing spaces/parentheses. This also prevents a contract-supplied description from spoofing the literal managed-file marker string in generated output. See [ADR-0017](../decisions/0017-adapter-output-markdown-escaping.md). |
| Command/option injection via Git invocation (`agent-ready check`)                         | `NodeGitClient` uses `execFile` (never a shell, never string interpolation into a command line); every `git` argument is either Agent-Ready-hardcoded or the single caller-influenced `--against <ref>` value, which is passed after Git's own `--end-of-options` marker so it is always treated as a revision, never as an option, even if it starts with `-`. No contract-declared content ever reaches a `git` argument. See [ADR-0013](../decisions/0013-protected-path-enforcement-and-git-invocation.md).                                                                                                                                                                                                                                                                                                                                        |
| Untrusted subprocess output (`agent-ready check`)                                         | `git diff --name-status`/`git status --porcelain` output is parsed with a strict, bounded line format (status code + tab/columns + path) and never evaluated as anything beyond path/status pairs; output is capped at 16 MB (`maxBuffer`) to bound memory use against a pathologically large diff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Arbitrary command execution via `verification.required`                                   | Deliberate and scoped, not prevented: only `agent-ready verify --execute` runs `commands[].run` strings, as shell commands, and only those reachable from `verification.required`. Every other command remains non-executing. Plain `agent-ready verify` (no `--execute`) never spawns anything — it only prints the ordered plan. See [ADR-0014](../decisions/0014-verification-execution.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Secret leakage via captured command output (`agent-ready verify`)                         | `NodeCommandRunner` never captures a command's stdout/stderr; it inherits the parent process's stdio, so output goes straight to the invoking terminal exactly as if the command were run by hand. The structured per-command result (`--json`, diagnostics) carries only `id`, `run`, `status`, `exitCode`, and `durationMs` — never captured output, avoiding the need for output redaction entirely.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Hung command (`agent-ready verify --execute`)                                             | A per-run `--timeout` (default 900s) bounds each command; on expiry, the whole process tree spawned for that command is killed (`taskkill /t` on Windows, a negative-pid signal to the process group on POSIX — see "Known limitations" below) and the command is reported `"timed-out"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Path escape / secret leakage via evidence write (`agent-ready verify --execute --record`) | The evidence output path is a single Agent-Ready-hardcoded filename (`agent-ready-verify-result.json`) joined against the already-verified `repoRoot` — never contract-supplied, never CLI-configurable. The file's content is exactly the same structured, non-output fields (`id`, `run`, `status`, `exitCode`, `durationMs`, plus diagnostics) `verify --json` already prints; a command's actual stdout/stderr is never captured or written. See [ADR-0015](../decisions/0015-verification-evidence-recording.md).                                                                                                                                                                                                                                                                                                                                 |

## Known limitations (accepted for this phase)

- **Deep, non-aliased YAML nesting** is not specifically depth-limited
  beyond the 1 MB size cap and the JS engine's own recursion limits. A
  pathological (but small) deeply-nested document could still be slow to
  process. Mitigation: the size cap bounds the practical worst case; a
  dedicated depth guard is a candidate for a future phase if this proves
  insufficient in practice.
- **Symlinked contract files and `.git` markers are followed
  transparently** during discovery (ordinary `stat` semantics), rather
  than being subject to `lstat`-based boundary enforcement. Since this
  phase never executes contract content and only reads it as inert text,
  the primary risk this would otherwise mitigate (arbitrary code
  execution via symlink redirection) does not apply. See
  [ADR-0004](../decisions/0004-repository-and-contract-discovery.md).
- **Case-insensitive file systems**: path-category conflict detection
  uses exact, case-sensitive string comparison. On a case-insensitive
  file system (default on Windows/macOS), two differently-cased patterns
  that would collide on disk are not flagged as a conflict by Agent-Ready.
  See [ADR-0005](../decisions/0005-path-and-glob-semantics.md).
- **Glob-pattern overlap** across categories is only detected via exact
  normalized-string equality, not semantic intersection analysis (e.g.
  `dist/**` and `dist/output` are not recognized as overlapping). This is
  a deliberate scope boundary, not an oversight — see
  [ADR-0005](../decisions/0005-path-and-glob-semantics.md).
- **`pnpm audit` in CI is informational, not blocking** (`continue-on-error: true`)
  in this phase, to avoid false-positive-driven CI failures on
  dev-only dependencies. Findings are reviewed manually. See
  `.github/workflows/ci.yml`.
- **GitHub Actions are pinned to major version tags**, not immutable
  commit SHAs, in this phase — a deliberate, documented tradeoff between
  supply-chain rigor and maintenance overhead for a fresh project with no
  external users yet. Revisit before encouraging third-party CI reuse.
- **`generate --write` follows symlinks transparently** rather than using
  `lstat`-based boundary enforcement, consistent with this project's
  existing discovery-time symlink policy. If a user (or something with
  write access to their working directory) has already planted a symlink
  named `AGENTS.md`/`CLAUDE.md` pointing outside the repository, `--write`
  will write through it. Since output filenames are never contract-supplied,
  this cannot be triggered by untrusted contract content — only by
  pre-existing local file-system state the invoking user already
  controls. See [ADR-0010](../decisions/0010-generate-write-boundary.md).
- **`agent-ready check` is the first command whose availability depends
  on an external binary** — it requires `git` on `PATH` and a Git working
  tree, unlike every other command in this phase, which needs only
  Node.js. See [ADR-0013](../decisions/0013-protected-path-enforcement-and-git-invocation.md).
- **`agent-ready check`'s rename handling checks both the old and new
  path** of a detected rename against `paths.protected`, but relies on
  Git's own default rename-detection heuristics (no `-M` threshold is
  explicitly configured) — a rename Git does not detect as such is
  instead reported as a plain delete-plus-add, which is still caught (the
  new path is still checked), just not labeled as a rename.
- **`agent-ready verify --execute`'s shell invocation is platform-native**
  (`cmd.exe` on Windows, `/bin/sh` elsewhere) rather than a single
  cross-platform shell grammar — the same characteristic every tool that
  takes this approach (`npm run`, `make`) already has. A `run` string that
  relies on shell-specific syntax will not behave identically on every
  platform; this is inherent to shell invocation, not a defect.
- **`agent-ready verify --execute`'s timeout kill is best-effort, not a
  hard guarantee.** On POSIX it signals the negative process-group pid
  (`SIGTERM`); on Windows it shells out to `taskkill /t /f`. A process that
  ignores `SIGTERM`, or reparents a grandchild out of its process group
  before the timeout fires, can outlive the reported `"timed-out"` result.
  No `SIGKILL` escalation or forced-wait is implemented in this phase.
- **`agent-ready verify --execute --record` overwrites its target
  unconditionally**, unlike `generate --write`'s managed-file-marker
  protection — there is no `--force`-style refusal path. This is a
  deliberate scope decision, not an oversight: the evidence filename
  (`agent-ready-verify-result.json`) is not a plausible pre-existing
  hand-authored file the way `AGENTS.md`/`CLAUDE.md` are, and its content
  is inherently ephemeral, per-run data. See
  [ADR-0015](../decisions/0015-verification-evidence-recording.md).

## Explicitly out of scope for this threat model

Anything requiring a network service, authentication, or multi-tenant
isolation does not apply — there is no such surface in this phase (see
[../../ROADMAP.md](../../ROADMAP.md)'s strict non-goals list).
