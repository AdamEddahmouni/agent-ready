# Diagnostic and error-code reference

Every diagnostic has the shape described in
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md):
`code`, `severity`, `summary`, and optionally `detail`, `field`,
`sourcePath`, `location`, `remediation`, `related`, and `metadata`.
Codes are stable; human message text is not (see
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md)).

| Code                                      | Stage            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                          | Typical remediation                                                                                             |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CONTRACT_NOT_FOUND`                      | discovery        | No `agent-ready.yaml` was found by ancestor search, or an explicit `--config` path does not exist / is not a file.                                                                                                                                                                                                                                                                                               | Create the contract at the repository root, or fix the `--config` path.                                         |
| `CONTRACT_READ_FAILED`                    | read             | The contract file exists but could not be read (permissions, or exceeds the 1 MB size limit).                                                                                                                                                                                                                                                                                                                    | Check file permissions/size.                                                                                    |
| `YAML_PARSE_FAILED`                       | parse            | The file is not syntactically valid YAML.                                                                                                                                                                                                                                                                                                                                                                        | Fix the reported YAML syntax error.                                                                             |
| `YAML_DUPLICATE_KEY`                      | parse            | The same mapping key appears twice at the same level.                                                                                                                                                                                                                                                                                                                                                            | Remove or rename the duplicate key.                                                                             |
| `YAML_NESTING_TOO_DEEP`                   | parse            | The parsed YAML AST exceeds the default maximum depth of 100 before conversion to plain JavaScript.                                                                                                                                                                                                                                                                                                              | Flatten the contract or move long-form guidance into instruction sources.                                       |
| `CONTRACT_SCHEMA_INVALID`                 | schema           | The contract does not match the public JSON Schema, and the failure isn't covered by a more specific code below. Includes unknown fields anywhere in the document.                                                                                                                                                                                                                                               | See [contract-reference.md](contract-reference.md) for the expected shape.                                      |
| `CONTRACT_VERSION_UNSUPPORTED`            | semantic         | `version` is a syntactically valid integer but not one this CLI build supports (only `1` currently).                                                                                                                                                                                                                                                                                                             | Set `version: 1`, or upgrade the Agent-Ready CLI.                                                               |
| `COMMAND_IDENTIFIER_INVALID`              | schema           | A key under `commands` does not match the required identifier format.                                                                                                                                                                                                                                                                                                                                            | Rename to lowercase kebab-case, e.g. `test-e2e`.                                                                |
| `COMMAND_REFERENCE_INVALID`               | semantic         | A `verification.required` entry references a command that isn't declared, or is duplicated within the list.                                                                                                                                                                                                                                                                                                      | Declare the referenced command, remove the entry, or de-duplicate.                                              |
| `COMMAND_DUPLICATE`                       | semantic         | Reserved for representations where object-key uniqueness cannot be structurally guaranteed. **Not currently reachable** through the standard YAML → object pipeline, since JS object keys are unique by construction and YAML-level duplicates are already caught earlier as `YAML_DUPLICATE_KEY`. Kept in the registry for forward compatibility (see [ADR-0006](../decisions/0006-command-representation.md)). | N/A today.                                                                                                      |
| `RUNTIME_DECLARATION_INVALID`             | semantic         | An `environment.runtimes` value is not a syntactically valid semver range.                                                                                                                                                                                                                                                                                                                                       | Use a valid range, e.g. `">=20 <23"`.                                                                           |
| `PACKAGE_MANAGER_INVALID`                 | schema/semantic  | `environment.packageManager.name` is not one of `npm`/`pnpm`/`yarn`, or `.version` is not a valid semver version/range.                                                                                                                                                                                                                                                                                          | Use a recognized package manager name and a valid version.                                                      |
| `PATH_PATTERN_INVALID`                    | semantic         | A path/glob pattern is empty, contains control characters, uses unsupported syntax (extglobs, unbalanced brackets/braces), or contains glob metacharacters where only a literal path is allowed (`instructions.sources`).                                                                                                                                                                                        | See [paths-and-globs.md](paths-and-globs.md) for the supported subset.                                          |
| `PATH_ABSOLUTE_DISALLOWED`                | semantic         | A path is absolute (POSIX-rooted, Windows drive-letter, or UNC).                                                                                                                                                                                                                                                                                                                                                 | Rewrite relative to the repository root.                                                                        |
| `PATH_TRAVERSAL_DISALLOWED`               | semantic         | A path attempts to escape the repository root via `..`.                                                                                                                                                                                                                                                                                                                                                          | Remove the traversal; reference a path within the repository.                                                   |
| `PATH_CATEGORY_CONFLICT`                  | semantic         | The same normalized pattern appears more than once, whether within one `paths` category or across `protected`/`generated`/`ignored`.                                                                                                                                                                                                                                                                             | Keep each normalized pattern in exactly one category, once.                                                     |
| `INSTRUCTION_SOURCE_INVALID`              | semantic         | An `instructions.sources` entry is invalid (bad pattern, duplicate) or does not exist as a readable file under the repository root.                                                                                                                                                                                                                                                                              | Fix the path, remove the duplicate, or create the missing document.                                             |
| `ARCHITECTURE_DECISION_INVALID`           | semantic/analyze | An `architecture.key_decisions` file is invalid, duplicated, not Markdown, or missing during analysis.                                                                                                                                                                                                                                                                                                           | Use a unique repo-relative `.md` decision file and create it.                                                   |
| `AGENT_CONTEXT_FILE_INVALID`              | semantic/analyze | An `agents.context_files` entry is invalid, duplicated, not Markdown, or missing during analysis.                                                                                                                                                                                                                                                                                                                | Use a unique repo-relative `.md` context file and create it.                                                    |
| `ADAPTER_DECLARATION_INVALID`             | schema           | An `adapters` key is not a recognized adapter name, or an adapter declaration doesn't match `{ enabled: boolean }`.                                                                                                                                                                                                                                                                                              | Use a recognized adapter name (`agentsMd`, `claude`, `cursor`, `copilot`, `gemini`) and a boolean `enabled`.    |
| `NORMALIZATION_FAILED`                    | normalize        | An expected invariant inside the normalization stage did not hold, despite validation having passed.                                                                                                                                                                                                                                                                                                             | Please report this as a bug.                                                                                    |
| `INTERNAL_INVARIANT_VIOLATION`            | any              | An unexpected internal error anywhere in the pipeline.                                                                                                                                                                                                                                                                                                                                                           | Please report this as a bug, including the contract that triggered it.                                          |
| `GENERATE_TARGET_UNMANAGED`               | generate         | `generate --write` found an existing file at a planned output path that lacks the managed-file marker, so it was not overwritten.                                                                                                                                                                                                                                                                                | Remove or rename the existing file, or re-run with `--force`.                                                   |
| `GENERATE_WRITE_FAILED`                   | generate         | A planned file could not be written to disk (permissions, disk space, etc.).                                                                                                                                                                                                                                                                                                                                     | Check file permissions and available disk space.                                                                |
| `GENERATED_FILES_OUT_OF_DATE`             | verify           | The generated-file preflight found missing or stale enabled-adapter output.                                                                                                                                                                                                                                                                                                                                      | Run `agent-ready generate --write`, review, and verify again.                                                   |
| `GENERATE_OUTSIDE_REPO_ROOT`              | generate         | Defense-in-depth only: a generated output path did not resolve inside the repository root. Expected unreachable, since output filenames are always adapter-hardcoded, never contract-supplied.                                                                                                                                                                                                                   | Please report this as a bug in Agent-Ready.                                                                     |
| `ADAPTER_NOT_YET_IMPLEMENTED`             | generate         | The contract enables a declared adapter name that has no generator yet. As of this release all five declared adapter names (`agentsMd`, `claude`, `cursor`, `copilot`, `gemini`) have one; this code is reserved for a future adapter name added to the schema ahead of its renderer. Informational — does not fail generation.                                                                                  | Disable the adapter, or wait for a future release that implements it.                                           |
| `PROTECTED_PATH_MODIFIED`                 | check            | `agent-ready check` found a changed file (in the working tree, the Git index, or relative to an explicit `--against` ref) that matches a `paths.protected` pattern.                                                                                                                                                                                                                                              | Revert the change, or update `paths.protected` in `agent-ready.yaml` if the file should no longer be protected. |
| `GIT_UNAVAILABLE`                         | check            | `agent-ready check` could not read changes from Git — the `git` executable is missing/not on `PATH`, or the underlying Git command failed (e.g. an `--against <ref>` that does not resolve to a valid revision).                                                                                                                                                                                                 | Ensure `git` is installed and on `PATH`, and that any `--against` ref given exists.                             |
| `GIT_REPOSITORY_NOT_FOUND`                | check            | `agent-ready check` was run against a repository root that is not inside a Git working tree.                                                                                                                                                                                                                                                                                                                     | Run inside a Git repository, or initialize one with `git init`.                                                 |
| `VERIFICATION_NOT_DECLARED`               | verify           | `agent-ready verify` was run against a contract with no `verification.required` commands. Informational — does not fail the command.                                                                                                                                                                                                                                                                             | Add a `verification.required` list to `agent-ready.yaml`.                                                       |
| `VERIFICATION_COMMAND_FAILED`             | verify           | `agent-ready verify --execute` ran a command that exited with a non-zero status.                                                                                                                                                                                                                                                                                                                                 | Fix the underlying failure, then re-run `agent-ready verify --execute`.                                         |
| `VERIFICATION_COMMAND_TIMEOUT`            | verify           | `agent-ready verify --execute` ran a command that exceeded `--timeout` and was killed.                                                                                                                                                                                                                                                                                                                           | Increase `--timeout`, or fix the command if it is unexpectedly hanging.                                         |
| `VERIFICATION_COMMAND_TERMINATION_FAILED` | verify           | A command exceeded its timeout, but Agent-Ready could not confirm that its process tree stopped.                                                                                                                                                                                                                                                                                                                 | Stop the remaining tree manually and investigate signal/process-tree handling.                                  |
| `VERIFICATION_COMMAND_SPAWN_FAILED`       | verify           | `agent-ready verify --execute` could not start a command's process at all (e.g. the executable is missing).                                                                                                                                                                                                                                                                                                      | Ensure the command's executable is installed and on `PATH`.                                                     |
| `VERIFICATION_RECORD_WRITE_FAILED`        | verify           | `agent-ready verify --execute --record` could not write the evidence file (`agent-ready-verify-result.json`) to the repository root (permissions, disk space, etc.).                                                                                                                                                                                                                                             | Check file permissions and available disk space.                                                                |
| `HANDOFF_FILE_INVALID`                    | verify           | The handoff file is unreadable, malformed, or has the wrong closed object shape.                                                                                                                                                                                                                                                                                                                                 | Provide all required fields with documented JSON types.                                                         |
| `HANDOFF_FIELD_TOO_LONG`                  | verify           | A handoff field exceeds its character limit.                                                                                                                                                                                                                                                                                                                                                                     | Shorten the summary or array entry.                                                                             |
| `DOCUMENTATION_SOURCE_READ_FAILED`        | analyze          | A declared instruction source passed contract validation but could not be read when documentation analysis ran.                                                                                                                                                                                                                                                                                                  | Check that the instruction source remains present and readable.                                                 |
| `DOCUMENTATION_LINK_CHECK_FAILED`         | analyze          | The analyzer could not inspect a resolved local link target because of a filesystem error.                                                                                                                                                                                                                                                                                                                       | Check filesystem permissions and retry.                                                                         |
| `DOCUMENTATION_LINK_BROKEN`               | analyze          | A repository-relative Markdown link in a declared instruction source resolves to a file or directory that does not exist.                                                                                                                                                                                                                                                                                        | Fix the link, restore its target, or remove the stale link.                                                     |
| `DOCUMENTATION_LINK_OUTSIDE_REPOSITORY`   | analyze          | A local Markdown link traverses lexically above the repository root.                                                                                                                                                                                                                                                                                                                                             | Replace it with a repository-relative destination that remains inside the repository.                           |
| `INSTRUCTION_SOURCE_TOO_LARGE`            | analyze          | A declared instruction source is larger than the 5,000,000-byte per-source analysis limit.                                                                                                                                                                                                                                                                                                                       | Split it into smaller focused sources or remove generated content.                                              |
| `RUNTIME_VERSION_MISMATCH`                | doctor           | Declared Node runtime range does not satisfy detected Node version.                                                                                                                                                                                                                                                                                                                                              | Install a Node version satisfying the declared range, or update the contract.                                   |
| `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`     | doctor           | A non-`node` runtime is declared under `environment.runtimes`; doctor does not currently probe that runtime.                                                                                                                                                                                                                                                                                                     | Track ADR-0023 follow-ups; future ADRs may graduate additional runtimes.                                        |
| `PACKAGE_MANAGER_UNAVAILABLE`             | doctor           | Declared package manager binary is not on `PATH`, or its `--version` probe failed.                                                                                                                                                                                                                                                                                                                               | Install the declared package manager, or update `environment.packageManager`.                                   |
| `PACKAGE_MANAGER_VERSION_MISMATCH`        | doctor           | Detected package-manager version does not satisfy the declared range.                                                                                                                                                                                                                                                                                                                                            | Update `environment.packageManager.version` or install a matching version.                                      |
| `GIT_REQUIRED_BUT_UNAVAILABLE`            | doctor           | `paths.protected` is declared but `git` is not on `PATH`. `agent-ready check` requires git when protected paths are declared.                                                                                                                                                                                                                                                                                    | Install git, or empty `paths.protected` if this repository does not use protected paths.                        |
| `INIT_CONTRACT_EXISTS`                    | init             | `init` found an existing `agent-ready.yaml` and refused to replace it.                                                                                                                                                                                                                                                                                                                                           | Keep the existing contract, or rename it explicitly before scaffolding a new one.                               |
| `UPGRADE_NO_CHANGES_NEEDED`               | upgrade          | No safe automatic modernization applies to the already-valid contract. Warning only.                                                                                                                                                                                                                                                                                                                             | No action required; review any separate manual-review warning.                                                  |
| `UPGRADE_MANUAL_REVIEW_REQUIRED`          | upgrade          | A possible modernization depends on maintainer policy or unavailable repository evidence, so it was not applied. Warning only.                                                                                                                                                                                                                                                                                   | Review the diagnostic and make the suggested change manually if appropriate.                                    |
| `UPGRADE_WRITE_FAILED`                    | upgrade          | A validated upgrade proposal could not be written to the contract file.                                                                                                                                                                                                                                                                                                                                          | Check permissions and disk space, then retry `upgrade --write`.                                                 |
| `DISCOVERY_ROOT_UNREADABLE`               | discover         | The `--root` path is missing, is not a directory, or could not be read. The only fatal discovery condition. See [ADR-0044](../decisions/0044-repository-discovery-model.md).                                                                                                                                                                                                                                     | Pass `--root` with a path to an existing repository directory.                                                  |
| `DISCOVERY_PARTIAL`                       | discover         | At least one probe could not complete. The affected fact is `unknown` with reason `probe-failed`. The snapshot is usable but incomplete. Informational — does not fail the command.                                                                                                                                                                                                                              | Check read permissions on the diagnostic's `sourcePath`, then re-run.                                           |
| `DISCOVERY_FACT_CONFLICT`                 | discover         | Two or more sources assert different values for the same fact. Every claim is retained with its evidence and the fact is reported with **no** value. Informational — does not fail the command.                                                                                                                                                                                                                  | Decide which source is authoritative and make the repository agree with itself.                                 |
| `DISCOVERY_NO_SIGNALS`                    | discover         | Every probe completed and none found any evidence. A valid, complete, empty result. Informational — does not fail the command. Never emitted together with `DISCOVERY_PARTIAL`, because it asserts a completeness the partial snapshot does not have.                                                                                                                                                            | Confirm `--root` points at the repository you intended to inspect.                                              |
| `DISCOVERY_FACT_UNSUPPORTED`              | discover         | Reserved for a discovery fact whose kind falls outside the four defined by ADR-0044. **Not currently reachable**; held in the registry so a future release cannot silently reuse a published string for a different meaning, following the `COMMAND_DUPLICATE` and `ADAPTER_NOT_YET_IMPLEMENTED` precedent.                                                                                                      | N/A today. If seen, the discovery fact kinds have been extended and ADR-0044 should be updated with them.       |

## Repository discovery diagnostics

`agent-ready discover` reuses this shared diagnostic vocabulary rather than a
parallel one: the same `Diagnostic` shape, the same registry
(`src/diagnostics/codes.ts`), the same renderers, and the same
`resolveExitCode` mapping. A consumer therefore needs no second error-handling
path. The `DISCOVERY_` prefix is a reserved namespace for the
`discover` command family.

The distinction that matters most here: a **diagnostic describes the discovery
operation**, while a **fact describes what is known about the repository**.
They are deliberately not the same thing. A probe that fails produces both a
`DISCOVERY_PARTIAL` warning _and_ a `repository.*` fact that is `unknown` with
reason `probe-failed`, and neither duplicates the other.

### `DISCOVERY_ROOT_UNREADABLE`

- **Trigger** — the resolved start directory does not exist, is not a
  directory, or its `stat` could not be performed.
- **Severity / category** — `error`. Stage: repository-root resolution.
- **Human rendering** — `error[DISCOVERY_ROOT_UNREADABLE]: The discovery root
does not exist or is not a directory.`, followed by a `detail` naming the
  path and a `suggestion` line. On stderr; stdout is empty.
- **Structured representation** — with `--json`, the failure envelope rather
  than a snapshot:

  ```json
  {
    "ok": false,
    "diagnostics": [
      {
        "code": "DISCOVERY_ROOT_UNREADABLE",
        "severity": "error",
        "summary": "The discovery root does not exist or is not a directory.",
        "detail": "No readable directory was found at \"/path/that/is/not/there\".",
        "remediation": "Pass --root with a path to an existing repository directory."
      }
    ]
  }
  ```

- **Fact / evidence behaviour** — none. No snapshot is produced, so no fact can
  exist to misreport.
- **Blocks execution** — yes. It is the only fatal discovery condition, and it
  resolves to exit code `2` (the same "input was not readable" category as
  `CONTRACT_READ_FAILED` and `GIT_REPOSITORY_NOT_FOUND`) rather than to the
  generic validation-failure code, because nothing was validated.
- **Informational only** — no.
- **Explain** — `agent-ready explain --code DISCOVERY_ROOT_UNREADABLE`; related
  codes: none.
- **Pinned by** — `tests/unit/discover.test.ts` ("reports a root that cannot be
  read as the only fatal condition"),
  `tests/unit/discoverCommand.test.ts` ("fails only when no readable root
  exists", "emits a JSON diagnostic envelope when discovery cannot run"),
  `tests/unit/discoverRegistry.test.ts` ("reports an unreadable root as an input
  that could not be used, not a validation failure", "surfaces that code
  through the command surface, human and JSON alike").

### `DISCOVERY_PARTIAL`

- **Trigger** — a probe returned `failed` (an unreadable path or an I/O error),
  threw, or reported a result inconsistent with the shape it declared. A thrown
  probe is downgraded to a failed probe rather than being allowed to masquerade
  as a repository fact, and so is a value-shaped probe that claimed to have
  found something without saying what.
- **Severity / category** — `warning`. Stage: probe execution.
- **Human rendering** — the repository-relative path is used as
  `sourcePath`, so it prefixes the line:

  ```text
  AGENTS.md - warning[DISCOVERY_PARTIAL]: Probe declaration-surface.presence could not complete, so repository.declarationSurface.present is reported as unknown.
    AGENTS.md: EACCES: permission denied
    suggestion: Check file permissions and readability. The path was not inspected; it is not known to be absent.
  ```

- **Structured representation** — `metadata` always carries `probeId` and
  `factId`, and `sourcePath` carries the path that could not be inspected when
  the probe reported one.
- **Fact / evidence behaviour** — the fact the probe was investigating becomes
  `unknown` with `reason: "probe-failed"`, never a value and never a `false`.
  `summary.complete` becomes `false`. The distinction from absence is the whole
  point: a path that could not be read is not a path that is not there.
- **Blocks execution** — no. Partial knowledge is a valid result and the
  command exits `0`.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_PARTIAL`; related codes:
  `DISCOVERY_NO_SIGNALS`.
- **Pinned by** — `tests/unit/discover.test.ts` ("reports a failed probe as
  unknown with reason probe-failed and a matching diagnostic", "downgrades a
  thrown probe to a failed probe", "produces different facts for a
  missing file and a file that could not be inspected"),
  `tests/unit/discoverCommand.test.ts` ("keeps a usable partial snapshot
  successful when a probe fails"),
  `tests/unit/discoverRegistry.test.ts` ("the DISCOVERY_PARTIAL diagnostic names
  the path it could not inspect", "still succeeds for a failed probe, which is
  not a fatal condition").

### `DISCOVERY_FACT_CONFLICT`

- **Trigger** — two or more claims for the same fact id assert different
  values. The production probe set produces one source per fact, so today this
  is reachable only through injected probes; Issue #37 supplies the first real
  multi-source case, where a declaration and a derived signal can disagree.
- **Severity / category** — `warning`. Stage: fact merge.
- **Human rendering** — the fact's row reads `conflicting` rather than any
  value, and every retained claim is listed beneath it:

  ```text
    Surfaces   conflicting
      Evidence
        declared        "one"  signals-a.json/present
        derived         "two"  signals-b.json
  ```

- **Structured representation** — `metadata.claimedValues` lists each asserted
  value, and `metadata.factId` names the fact. In the snapshot itself, the fact
  has **no `value` property at all**; all claims and their evidence are
  retained verbatim.
- **Fact / evidence behaviour** — the fact is counted in `summary.conflicts`
  and in `summary.known` (it is a real, resolved-as-contradictory observation,
  not ignorance). No source is ranked or preferred; the conflict is the fact.
- **Blocks execution** — no. The command exits `0`.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_FACT_CONFLICT`; related
  codes: `DISCOVERY_PARTIAL`.
- **Pinned by** — `tests/unit/discover.test.ts` ("retains both claims and names
  no winner"), `tests/unit/discoverCommand.test.ts` ("reports a conflict in the
  snapshot without choosing a value", "shows the retained claims when sources
  disagree"), `tests/unit/discoverFactBoundary.test.ts` ("reports a conflicting
  fact with no value rather than a ranked winner", "does not let an author claim
  overwrite what the repository shows").

### `DISCOVERY_NO_SIGNALS`

- **Trigger** — no probe returned `found` **and** no probe failed. The
  conjunction matters: the code asserts that every probe completed, so it is
  never emitted alongside `DISCOVERY_PARTIAL`, which would place a completeness
  claim in a snapshot whose own `summary.complete` is `false`.
- **Severity / category** — `warning`. Stage: probe execution.
- **Human rendering** — appended below the discovery summary:

  ```text
  warning[DISCOVERY_NO_SIGNALS]: No repository signal was found. Every probe completed and none found evidence.
    This is a complete, valid result for a repository that contains none of the probed signals.
    suggestion: Confirm --root points at the repository you intended to inspect.
  ```

- **Structured representation** — `code`, `severity`, `summary`, `detail`,
  `remediation`. No `metadata`: the condition is about the run as a whole, not
  about one fact.
- **Fact / evidence behaviour** — no fact changes. The affected facts are
  `unknown` with reason `no-evidence`, and they retain the paths that were
  inspected, so "we looked here and found nothing" stays distinguishable from
  "we did not look". `summary.complete` stays `true`.
- **Blocks execution** — no. A repository that genuinely contains none of the
  probed signals is a legitimate repository; the diagnostic exists so an empty
  result is never mistaken for a command that silently did nothing.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_NO_SIGNALS`; related
  codes: none.
- **Pinned by** — `tests/unit/discover.test.ts` ("reports a repository with no
  signals at all as a complete result", "does not claim every probe completed
  when one of them could not"),
  `tests/unit/discoverRegistry.test.ts` ("agrees with the severity discovery
  actually emits").

### `DISCOVERY_FACT_UNSUPPORTED`

- **Trigger** — none today. Reserved for a discovery fact whose epistemic kind
  falls outside `declared` / `derived` / `author-declared` / `unknown`.
- **Severity / category** — `warning`, by the same reserved-code convention as
  the other unreachable codes.
- **Human rendering / structured representation** — not reachable, so neither
  has an observed rendering. The registry entry exists so that a future
  fifth fact kind gets a published string rather than reusing an existing one
  with a different meaning.
- **Fact / evidence behaviour** — none.
- **Blocks execution** — no.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_FACT_UNSUPPORTED`;
  related codes: `INTERNAL_INVARIANT_VIOLATION`.
- **Pinned by** — `tests/unit/discover.test.ts` ("never emits the deliberately
  unreachable reservation"),
  `tests/unit/discoverRegistry.test.ts` ("adds only the five codes ADR-0044
  defines", "gives every discovery code a non-empty explanation").

### Stated deviations from ADR-0044

ADR-0044 is the decision record; where the shipped implementation departs from
its literal wording, the departure is recorded here rather than left for a
reader to discover.

- **Snapshot version field.** ADR-0044 names the field `schemaVersion`. The
  shipped field is `snapshotVersion`, with its own constant
  `DISCOVERY_SNAPSHOT_VERSION = 0`. `schemaVersion` would imply the snapshot is
  described by a JSON Schema, and would sit confusingly beside the v1 contract's
  own `version` field. The version-taxonomy intent — a format version
  independent of the contract version and of the package version — is
  unchanged.
- **How a contradiction is represented.** ADR-0044's fact sketch lists
  `reason: "conflict"` among the unknown reasons. The implementation makes no
  conflicted fact `unknown`: a `ConflictedFact` keeps a known `kind`, keeps
  every claim with its evidence, and has **no `value` field**. That is the
  stronger form of ADR-0044's own "contradiction is itself a fact" rule, and
  it means a conflicted fact is counted in `summary.known`, not `summary.unknown`.
  `UnknownReason` is therefore exactly `no-evidence | probe-failed | not-probed`.
- **Severity of the informational codes.** ADR-0044's table lists
  `DISCOVERY_NO_SIGNALS` and `DISCOVERY_FACT_UNSUPPORTED` as `info`. The shared
  `Severity` type is `error | warning`, and adding an `info` level would change
  the renderers and the `--json` output of all eleven v1 commands — a v1
  surface change that ADR-0042 forbids. Both are emitted as `warning`, which
  preserves the operative meaning (informational, never fails the command)
  within the frozen severity vocabulary. The human renderer labels every
  non-error diagnostic `warning`, so no rendering claims a severity the type
  does not have.
- **Exit code for the fatal condition.** ADR-0044 says exit-code resolution
  follows the existing `resolveExitCode` mapping. The mapping is reused, with
  `DISCOVERY_ROOT_UNREADABLE` added to the existing "input was not readable"
  bucket (exit `2`) alongside `CONTRACT_READ_FAILED` and
  `GIT_REPOSITORY_NOT_FOUND`. No new code or bucket was introduced, and no v1
  code's exit code changes.
- **Meaning of `corroborated`.** A fact's `corroboration.corroborated` is true
  only when at least two claims support the value from _different_ evidence. A
  single source — however direct, and even when repeated — does not corroborate
  itself, and the weaker question ("is this more than the author's word?") is
  already answered by `corroboration.kinds`. This is strictly narrower than the
  first reading of the field, in the direction of under-claiming rather than
  over-claiming.

## Severity

`Severity` has exactly two values, `"error"` and `"warning"`, and a warning
never changes a command's exit code. The set of codes emitted as `"warning"`
is declared once, in `WARNING_DIAGNOSTIC_CODES`
(`src/diagnostics/codes.ts`), and `agent-ready explain` derives the severity
it reports from that same list rather than restating it — so a code registered
as informational cannot be described as an error by one command and a warning
by another.

The warning codes are:

- `ADAPTER_NOT_YET_IMPLEMENTED` — an enabled-but-unimplemented adapter does not
  fail `generate`, it is simply skipped.
- `VERIFICATION_NOT_DECLARED` — a contract with no `verification.required`
  commands does not fail `agent-ready verify`, there is simply nothing to run.
- `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` — a non-`node` runtime declared in the
  contract is not yet probed by doctor, so the row is informational only.
- `UPGRADE_NO_CHANGES_NEEDED` and `UPGRADE_MANUAL_REVIEW_REQUIRED` — they
  describe a successful no-op and a maintainer-review outcome respectively.
- `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_CONFLICT`, `DISCOVERY_NO_SIGNALS`, and
  `DISCOVERY_FACT_UNSUPPORTED` — the discovery conditions that leave a snapshot
  usable. See [Repository discovery diagnostics](#repository-discovery-diagnostics)
  and the stated deviations from ADR-0044 recorded there.

Every other code is emitted as `"error"`.

## Exit-code mapping

See [ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) and
[cli-reference.md](cli-reference.md#exit-codes) for how a diagnostic list
maps to a single process exit code.

`agent-ready discover` uses that same mapping and adds no scheme of its own.
Its consequences, which are part of the command's contract:

- A snapshot with no diagnostics, or with warnings only — including
  `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_CONFLICT`, and `DISCOVERY_NO_SIGNALS` —
  exits `0`. Partial, empty, and contradictory knowledge are all successful
  results.
- `DISCOVERY_ROOT_UNREADABLE` is the only fatal discovery condition, and it
  exits `2`, the "input was not readable" category, because the location
  `--root` named could not be used. It is not a validation failure: nothing was
  validated.
- A missing `agent-ready.yaml` is **not** fatal for this command. Every other
  command treats it as `CONTRACT_NOT_FOUND` and exits non-zero; `discover`
  reports it as a fact and continues.
