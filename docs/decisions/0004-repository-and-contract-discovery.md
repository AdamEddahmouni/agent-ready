# ADR-0004: Repository root and contract discovery

## Status

Accepted

## Context

Agent-Ready needs a deterministic way to find `agent-ready.yaml` from an
arbitrary working directory, without requiring Git, without scanning
unbounded amounts of the file system, and with explicit behavior when an
explicit `--config` path is given.

## Alternatives considered

- **Git dependence**: require a `.git` directory to define repo root
  (simple, but fails in fresh/non-git projects and requires shelling out
  to `git` or parsing `.git` internals) vs. Git-independent discovery.
- **Search bound**: search indefinitely up to the file-system root vs.
  bounding search at a Git boundary or a fixed depth.
- **Multiple contracts**: error out if more than one `agent-ready.yaml`
  exists anywhere in the tree (requires a full scan) vs. simply using the
  nearest ancestor and never looking further up.

## Decision

- **Git is never required and the `git` executable is never invoked.**
  Only the presence of a `.git` entry (file or directory — worktrees use a
  `.git` _file_) is checked via `fs.stat`, purely as a search-boundary
  signal.
- **Ancestor search, nearest match wins.** Starting from the start
  directory (default: current working directory) and walking upward
  inclusive of the start directory itself, the first directory containing
  `agent-ready.yaml` is used. This naturally handles nested working
  directories (running the CLI from a subdirectory finds the repo's
  contract) without any special-casing.
- **Search stops at a `.git` boundary if the contract hasn't been found
  by then.** If a directory contains `.git` but not `agent-ready.yaml`,
  the search stops there and reports `CONTRACT_NOT_FOUND` — it does not
  continue searching above what is clearly the repository's own root. In
  a directory tree with no `.git` at all, the search continues upward to
  the file-system root, bounded only by `MAX_ANCESTOR_DEPTH` (64 levels)
  as a pure safety limit against pathological inputs (e.g. symlink
  cycles). This means Agent-Ready works in fresh, non-git projects, while
  still respecting Git repository boundaries where they exist.
- **"Multiple contracts found" is resolved by construction, not by a
  scan-and-error step.** Because search stops at the nearest match, a
  contract higher up the tree (e.g. a monorepo root contract, with this
  package having its own) is never even considered. This avoids the cost
  and complexity of a full-tree scan and gives predictable, cheap
  behavior (only ever a handful of `stat` calls, not a directory walk).
- **`--config <path>` bypasses ancestor search entirely.** The repository
  root becomes the directory containing the given file, full stop. This
  is the simplest rule that is still safe and explicit: no traversal
  logic, no ambiguity about which root applies.
- **Symlinks are not given special handling during discovery.** Both
  `agent-ready.yaml` and `.git` checks use `fs.stat` (which follows
  symlinks) exactly as normal file access would. Since this phase never
  executes the contract's contents and only reads them as inert text,
  symlink-based relocation of the contract file is a low-severity,
  accepted risk documented in `docs/security/threat-model.md`, rather
  than a scenario that justifies additional `lstat`-based boundary
  enforcement.

## Consequences

- Running `agent-ready validate` from any subdirectory of a repository
  finds the right contract without configuration.
- A stray `agent-ready.yaml` in an unrelated ancestor directory outside a
  Git repository's boundary is never picked up accidentally once a `.git`
  marker is crossed.
- In a directory with no Git repository and no contract anywhere in its
  ancestry, the search walks all the way to the file-system root (bounded
  by `MAX_ANCESTOR_DEPTH`) before reporting `CONTRACT_NOT_FOUND`.

## Reconsideration trigger

If Agent-Ready later supports monorepo-aware nested contracts (an
explicit non-goal for this phase), this discovery algorithm's "nearest
match wins, never look further" rule will need to become "nearest match
wins, but record the chain of ancestor contracts" — a materially
different discovery model.
