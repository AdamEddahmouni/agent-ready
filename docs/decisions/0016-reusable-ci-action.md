# ADR-0016: Reusable CI integration (GitHub composite action)

## Status

Accepted

## Context

`ROADMAP.md`'s "Long-term open-source direction" has always listed
"Basic CI integrations beyond this repository's own workflow (i.e. a
reusable action/workflow other repositories can adopt)" as a candidate
category, without committing to a phase. This repository's own
`.github/workflows/ci.yml` already exercises the exact sequence a
downstream adopter would want — `validate`, `inspect`, `generate --json`,
`verify --json`, `verify --execute` — as ad hoc `run:` steps that
shell out to `node dist/cli/index.js`. This phase packages that proven
sequence into something another repository can `uses:` directly, instead
of hand-copying shell steps.

**The constraint that shapes this ADR:** no npm package has ever been
published under this project's name (`ROADMAP.md`'s strict non-goals
list explicitly excludes "automated package publication or release"),
and no Git tag exists yet (`git tag -l` is empty at the time of this
decision). Any design assuming `npx agent-ready` works would be broken on
day one. This ADR does not solve — or need to solve — the publishing
question at all: a GitHub composite action distributed from this same
Git repository sidesteps it entirely, because GitHub already checks out
the action's own repository (at the pinned `uses: owner/repo@ref`) to
`github.action_path` before running it. The action can build itself,
in place, from that checkout, and invoke the CLI it just built — no
npm registry involved.

## Alternatives considered

- **Reusable workflow (`workflow_call`)**: rejected as the primary
  mechanism. A reusable workflow is a whole job a caller `uses:` once;
  running `validate` and then `verify` would require either two separate
  jobs or a more elaborate `with:`/`outputs:` contract between them. A
  composite action is a single step, so a caller can drop it in next to
  their own steps and call it multiple times (once per command) within
  one job — a better fit for how `cli-reference.md` already documents
  these commands: independent, composable, single-purpose invocations.
- **Wait for an npm publish, then `uses:`/`run: npx agent-ready`**:
  rejected for this phase. `ROADMAP.md` explicitly does not commit to
  "automated package publication or release," and manually cutting a
  first npm publish solely to unblock this feature would entangle two
  independent decisions (publishing strategy, and CI packaging) in one
  change. Revisit once a publish process exists on its own merits — see
  "Reconsideration trigger" below.
- **A Docker or JavaScript action**: rejected. Both require a second,
  parallel build/packaging pipeline (a container image, or a bundled JS
  file checked into the repo) duplicating logic the TypeScript CLI
  already has, fully tested, in `src/cli/index.ts`. A composite action
  that builds and runs the same `dist/cli/index.js` every local user
  already runs has zero duplicated logic.
- **A free-form `args: <string>` input**, shell-split and appended
  verbatim to the invocation: rejected. Typed inputs mirroring
  `src/cli/index.ts`'s actual commander options (`json`, `config`,
  `write`, `check`, `force`, `staged`, `against`, `execute`, `timeout`,
  `record`) avoid shell word-splitting entirely and keep every argument a
  discrete argv element — the same "structured data in, no string
  concatenation into anything interpreted" posture ADR-0013 already
  established for `NodeGitClient`'s `execFile` calls, applied here to the
  action's own bash step.
- **Interpolating `${{ inputs.* }}` directly inside the composite step's
  `run:` script body**: rejected as a matter of general GitHub Actions
  hygiene, not because caller-supplied inputs are adversarial here (a
  workflow author who writes `uses: AdamEddahmouni/agent-ready@<ref>`
  already trusts this action's code to run in their CI, same as any other
  third-party action). Passing inputs through `env:` and referencing them
  as `$INPUT_*` shell variables instead avoids the well-known
  script-injection footgun class entirely and costs nothing.

## Decision

- **New `action.yml` at the repository root**, `runs.using: composite`.
  Inputs: `command` (required: `validate`/`inspect`/`generate`/`check`/
  `verify`), `config`, `json`, `write`, `check`, `force`, `staged`,
  `against`, `execute`, `timeout`, `record` (all optional, mirroring
  `src/cli/index.ts`'s per-command options — an option irrelevant to the
  chosen `command` is simply ignored), and `node-version` (default
  `"22"`, matching `ci.yml`'s `PRIMARY_NODE_VERSION`).
- **Steps**: `pnpm/action-setup@v4` → `actions/setup-node@v4` (using the
  `node-version` input) → `pnpm install --frozen-lockfile` and `pnpm
build`, both run with `working-directory: ${{ github.action_path }}` (the
  checkout of _this_ repository at the pinned ref, not the caller's
  repository) → a final bash step, run with the caller's default working
  directory (`GITHUB_WORKSPACE`, i.e. the caller's own checked-out repo —
  unchanged, no override needed), that maps every input to an `INPUT_*`
  environment variable via `env:`, builds a bash argv array from them,
  and executes `node "${{ github.action_path }}/dist/cli/index.js"
"${args[@]}"`.
- **No output capture.** The composite action does not parse or
  redirect the CLI's stdout/stderr; it inherits them straight to the
  job log, exactly like every other step. The job step's own exit code
  is the CLI's exit code — a failing `validate`/`check`/`verify` fails
  the calling job with no extra wiring.
- **No new diagnostic codes, no new exit-code values, no schema change.**
  This phase adds zero lines to `src/`; it is purely a new top-level
  YAML file plus a CI job and docs referencing the existing CLI.
- **Self-consumption**: `.github/workflows/ci.yml` gains a
  `dogfood-action` job that calls `uses: ./` (this repository's own,
  not-yet-tagged checkout) with `command: validate`, proving the action
  works end-to-end on every PR before any external consumer could ever
  hit a broken `action.yml`.

## Consequences

- A downstream repository can adopt Agent-Ready's CLI in its own CI with
  `uses: AdamEddahmouni/agent-ready@<ref>` plus a `with: { command:
... }` block, instead of hand-copying `node dist/cli/index.js ...`
  invocations — see the new
  [docs/specification/ci-integration.md](../specification/ci-integration.md).
- Every invocation rebuilds Agent-Ready from source (`pnpm install &&
pnpm build`) inside the action's own checkout. This costs the caller's CI
  run some time (no cross-run caching is set up in this phase) in
  exchange for requiring nothing beyond a pinned Git ref — no publish
  pipeline, no registry trust, no version-resolution ambiguity beyond
  ordinary Git ref semantics.
- No tagged release exists yet at the time this phase ships. Early
  adopters must pin to a commit SHA until a maintainer cuts a Git tag —
  documented explicitly in `docs/specification/ci-integration.md` rather
  than left as a silent gap. Cutting that tag is a manual, one-time
  maintainer action outside this change, consistent with `ROADMAP.md`'s
  "automated package publication or release" remaining a non-goal (a
  hand-run `git tag && git push --tags` is not automation).
- `ROADMAP.md`'s "Long-term open-source direction" list is updated in
  the same change that introduces this feature, moving this bullet into
  a new "Phase 7" entry — required by `GOVERNANCE.md`'s ADR process.

## Reconsideration trigger

Revisit this decision if:

- An npm publish process is established for other reasons — at that
  point, offering an `npx agent-ready` path (faster than a from-source
  build on every CI run) becomes worth adding as an alternative, not a
  replacement, to this action.
- A concrete need emerges for orchestrating multiple commands in one
  action call (e.g. "run `validate` then `verify`, stop on first
  failure") rather than one `uses:` step per command — at that point,
  reconsider whether a reusable workflow (`workflow_call`) better fits
  that shape than chaining composite-action steps.
- A concrete need emerges for the action to run against a directory
  other than the caller's default `GITHUB_WORKSPACE` (e.g. a monorepo
  subdirectory) — today there is no `working-directory` input, matching
  the fact that `agent-ready.yaml` discovery already walks up from the
  process's own working directory with no equivalent CLI flag either.
