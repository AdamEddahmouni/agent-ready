# Repository and contract discovery

See [ADR-0004](../decisions/0004-repository-and-contract-discovery.md)
for the full rationale; this document is the user-facing summary.

## Default behavior (no `--config`)

1. Start at the current working directory (or an explicitly given start
   directory, used in tests).
2. Check that directory, then each ancestor directory in turn, for a file
   named exactly `agent-ready.yaml`.
3. The **first** directory found containing it becomes the repository
   root; that file is used. Search stops immediately — it never looks
   further up once a match is found, so a contract belonging to an
   unrelated ancestor project is never picked up by accident.
4. If a directory contains a `.git` entry (file or directory — this
   covers both regular clones and worktrees) but not `agent-ready.yaml`,
   the search **stops there** and reports `CONTRACT_NOT_FOUND`. Agent-Ready
   does not search above what is clearly a repository's own root.
5. In a directory tree with no `.git` anywhere in its ancestry, the search
   continues up to the file-system root, bounded by a 64-level safety
   limit.

**Git is never required and the `git` executable is never invoked** —
only the presence of a `.git` entry is checked via a plain file-system
stat.

### Nested working directories

Running `agent-ready validate` from any subdirectory of a repository
finds the repository's contract without any configuration, because the
ancestor search starts at the current directory and walks upward.

## Explicit `--config`

```bash
agent-ready validate --config path/to/agent-ready.yaml
```

When `--config` is given, ancestor search is **bypassed entirely**. The
repository root becomes the directory containing the given file, full
stop — this is the simplest rule that remains safe and unambiguous. A
relative `--config` path is resolved against the current working
directory; a missing or non-file path produces `CONTRACT_NOT_FOUND`.

## Symlinks

Filesystem metadata checks use `lstat` semantics. A symbolic-link
`agent-ready.yaml` is not accepted as the repository contract, preventing
contract reads, upgrades, or verification execution from being redirected
outside the discovered repository. A symbolic-link `.git` entry still stops
ancestor traversal because any entry marks the repository boundary.

## What is not supported

- Alternate contract filenames — only `agent-ready.yaml` is recognized.
- Nested or monorepo-aware contract inheritance (an explicit non-goal for
  this phase; see [../../ROADMAP.md](../../ROADMAP.md)).
