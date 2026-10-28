Found while reviewing the vNext Phase 0 branch. Deliberately **not** folded into Phase 0 — it is pre-existing and unrelated to the vNext direction.

## What was found

`agent-ready analyze` reports `ok: true` with 76 links checked and zero findings. Running an independent link checker over every Markdown file in the repository finds **13 broken relative links** that `analyze` does not report.

The affected files are historical ADRs:

- `docs/decisions/0017-adapter-output-markdown-escaping.md`
- `docs/decisions/0021-cli-package-maturity-direction.md`
- `docs/decisions/0022-agent-ready-schema-command.md`
- `docs/decisions/0023-agent-ready-doctor-command.md`
- `docs/decisions/0026-instructions-content-field.md`

Most are the same class of error: a path written relative to the repository root (`specification/evidence.md`, `../schemas/v1/agent-ready.schema.json`) used from inside `docs/decisions/`, where it should be `../../specification/evidence.md` or `../../schemas/v1/...`.

## Why `analyze` misses them

`analyze` only link-checks paths declared in `instructions.sources` in `agent-ready.yaml`, and it ignores external `http(s)://` links entirely. It validates explicitly registered documentation, not the repository's actual documentation surface. That gap is itself evidence for the vNext thesis: Agent-Ready currently validates only what a maintainer told it to validate.

## Scope

1. Repair the 13 broken relative links in the five ADRs above.
2. Do **not** rewrite history in the ADRs. Fix the links; leave the decisions as written.
3. Leave generated adapter output in `compatibility/` and `examples/` alone — those are fixture-driven and validated by their own corpora, not by repository link resolution.
4. Exclude template placeholders such as `${source}` in ADR-0017 and the `.github/PULL_REQUEST_TEMPLATE.md` root-relative links from any check that gets added.

## The second half: expand link-analysis coverage

`analyze` should not need a maintainer to register a file before its links are checked. Consider walking the documentation surface directly, with a suppression mechanism for templates and fixtures, so the next 13 broken links are caught by `analyze` rather than by a separate script.

## Acceptance criteria

- [ ] Zero broken relative links in hand-written documentation.
- [ ] Fixtures, examples, and templates are either correctly excluded or correctly resolved, and the exclusion is explicit rather than incidental.
- [ ] The behaviour is covered by a test that fails on a deliberately broken link.
- [ ] Any change to `analyze`'s behaviour follows the [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/main/GOVERNANCE.md) rule: an ADR before new diagnostic codes.

## Note

This is filed on `main` and is independent of the vNext work on `docs/vnext-phase-0`.
