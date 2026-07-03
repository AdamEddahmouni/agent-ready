# Adapter output compatibility corpus v1

This directory is a self-contained, machine-readable corpus for checking an
implementation of Agent-Ready's five Markdown adapters.

`manifest.json` identifies each input contract, any supporting repository
files, every expected output path, and its byte-exact fixture. Paths in the
manifest are relative to this directory; output `path` values are relative to
the temporary repository created by a test runner.

Corpus version 1 is immutable. A correction that intentionally changes an
expected byte creates a new corpus version, allowing downstream implementations
to choose when to adopt it. New cases that do not alter existing expectations
may be added to the current version.

Run this repository's reference implementation against the corpus with:

```bash
pnpm test -- tests/compatibility/adapterOutput.test.ts
```
