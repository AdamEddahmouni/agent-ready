# Threat model (Phase 0/1/2)

## Trust boundary

Agent-Ready runs locally, as a CLI or an embedded library, operating on
files the invoking user/CI job already has read (and, for `generate
--write` only, write) access to. There is no network service, no
account, and no remote code path in this phase. The threat model here is
specifically about **untrusted repository content** — a malicious or
malformed `agent-ready.yaml`, or adversarial paths within it — not about
a multi-tenant or networked attacker model.

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
strings, instruction-source references, and CLI arguments (`--config`).

## Controls implemented in this phase

| Risk                                                         | Control                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary code execution via YAML tags                       | `yaml` (eemeli/yaml) never resolves tags to executable JS types, unlike `js-yaml`'s unsafe-load mode. See [ADR-0003](../decisions/0003-yaml-parsing-safety.md).                                                                                                                                                                                                                                          |
| Command execution via contract content                       | Structurally impossible: no code path in this repository spawns a process, shell, or subprocess based on contract content. `run` strings are stored and validated as opaque data only. See [ADR-0006](../decisions/0006-command-representation.md).                                                                                                                                                      |
| YAML amplification ("billion laughs")                        | `maxAliasCount` (100, `yaml`'s default) caps alias/anchor expansion.                                                                                                                                                                                                                                                                                                                                     |
| Oversized input                                              | Hard 1 MB size limit (`MAX_CONTRACT_BYTES`) enforced before parsing begins.                                                                                                                                                                                                                                                                                                                              |
| Silent data loss via duplicate keys                          | Duplicate YAML mapping keys are a parse error (`YAML_DUPLICATE_KEY`), not a silent overwrite.                                                                                                                                                                                                                                                                                                            |
| Path traversal (`../../etc/passwd`)                          | Explicit segment-stack traversal detection in `contract/paths.ts`; rejected as `PATH_TRAVERSAL_DISALLOWED` before any file-system use.                                                                                                                                                                                                                                                                   |
| Absolute-path escape (POSIX root, Windows drive-letter, UNC) | Detected and rejected (`PATH_ABSOLUTE_DISALLOWED`) prior to any normalization that might otherwise "fix" a UNC/drive path into something usable.                                                                                                                                                                                                                                                         |
| Environment/secret leakage                                   | No environment-variable interpolation is ever performed on contract content; diagnostics never include full environment state; ordinary output does not include unrelated local absolute paths beyond the contract/repo paths being validated.                                                                                                                                                           |
| Unnecessary remote configuration/code loading                | No runtime network calls anywhere in this phase: the JSON Schema is bundled and read from disk (never fetched from its `$id` URL); there are no remote includes, no `.env` auto-loading, and no telemetry.                                                                                                                                                                                               |
| Uninformative crashes on malformed input                     | Every expected failure path produces a typed `Diagnostic` (code, summary, remediation) rather than an unhandled exception; only a true internal-invariant violation is caught and reported generically (`INTERNAL_INVARIANT_VIOLATION`), without a raw stack trace in user-facing output.                                                                                                                |
| Resource exhaustion from repeated validation                 | A single CLI invocation runs each pipeline stage exactly once; discovery only stats a bounded number of ancestor directories (`MAX_ANCESTOR_DEPTH = 64`), not a full repository scan.                                                                                                                                                                                                                    |
| Path escape on write (`generate --write`)                    | Output paths are always adapter-hardcoded filenames (`AGENTS.md`, `CLAUDE.md`) joined against the already-verified `repoRoot`, never taken from contract content; `generate.ts` additionally re-checks the joined path resolves inside `repoRoot` before it is ever passed to `writeTextFile` (`GENERATE_OUTSIDE_REPO_ROOT`, expected unreachable in practice — defense in depth).                       |
| Clobbering hand-authored files (`generate --write`)          | Every file Agent-Ready generates embeds a managed-file marker. `--write` refuses to overwrite an existing target that lacks the marker (`GENERATE_TARGET_UNMANAGED`) unless `--force` is explicitly passed. See [ADR-0010](../decisions/0010-generate-write-boundary.md).                                                                                                                                |
| Silent unintended writes                                     | `generate` defaults to a dry run; writing to disk requires the explicit `--write` flag. `validate` and `inspect` never write, and never gain a write flag.                                                                                                                                                                                                                                               |
| Symlink write-through (`generate --write`)                   | `writeTextFile` uses ordinary `node:fs` write semantics (symlinks followed transparently), consistent with this project's existing discovery-time symlink policy; since output paths are never contract-supplied, an attacker cannot use contract content to redirect a write. Documented limitation, not actively defended against a locally-planted malicious symlink — see "Known limitations" below. |

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

## Explicitly out of scope for this threat model

Anything requiring a network service, authentication, or multi-tenant
isolation does not apply — there is no such surface in this phase (see
[../../ROADMAP.md](../../ROADMAP.md)'s strict non-goals list).
