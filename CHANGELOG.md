# Changelog

All notable changes to Agent-Ready are documented here. The project follows
[Semantic Versioning](https://semver.org/) while remaining pre-1.0.

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
