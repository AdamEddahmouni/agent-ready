# Changelog

All notable changes to Agent-Ready are documented here. The project follows
[Semantic Versioning](https://semver.org/) while remaining pre-1.0.

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
