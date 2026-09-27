# Diagnostic and error-code reference

Every diagnostic has the shape described in
[ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md):
`code`, `severity`, `summary`, and optionally `detail`, `field`,
`sourcePath`, `location`, `remediation`, `related`, and `metadata`.
Codes are stable; human message text is not (see
[ADR-0009](../decisions/0009-pre-1.0-stability-policy.md)).

| Code                                      | Stage            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Typical remediation                                                                                                                                       |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTRACT_NOT_FOUND`                      | discovery        | No `agent-ready.yaml` was found by ancestor search, or an explicit `--config` path does not exist / is not a file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Create the contract at the repository root, or fix the `--config` path.                                                                                   |
| `CONTRACT_READ_FAILED`                    | read             | The contract file exists but could not be read (permissions, or exceeds the 1 MB size limit).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Check file permissions/size.                                                                                                                              |
| `YAML_PARSE_FAILED`                       | parse            | The file is not syntactically valid YAML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Fix the reported YAML syntax error.                                                                                                                       |
| `YAML_DUPLICATE_KEY`                      | parse            | The same mapping key appears twice at the same level.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Remove or rename the duplicate key.                                                                                                                       |
| `YAML_NESTING_TOO_DEEP`                   | parse            | The parsed YAML AST exceeds the default maximum depth of 100 before conversion to plain JavaScript.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Flatten the contract or move long-form guidance into instruction sources.                                                                                 |
| `CONTRACT_SCHEMA_INVALID`                 | schema           | The contract does not match the public JSON Schema, and the failure isn't covered by a more specific code below. Includes unknown fields anywhere in the document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | See [contract-reference.md](contract-reference.md) for the expected shape.                                                                                |
| `CONTRACT_VERSION_UNSUPPORTED`            | semantic         | `version` is a syntactically valid integer but not one this CLI build supports (only `1` currently).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Set `version: 1`, or upgrade the Agent-Ready CLI.                                                                                                         |
| `COMMAND_IDENTIFIER_INVALID`              | schema           | A key under `commands` does not match the required identifier format.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Rename to lowercase kebab-case, e.g. `test-e2e`.                                                                                                          |
| `COMMAND_REFERENCE_INVALID`               | semantic         | A `verification.required` entry references a command that isn't declared, or is duplicated within the list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Declare the referenced command, remove the entry, or de-duplicate.                                                                                        |
| `COMMAND_DUPLICATE`                       | semantic         | Reserved for representations where object-key uniqueness cannot be structurally guaranteed. **Not currently reachable** through the standard YAML → object pipeline, since JS object keys are unique by construction and YAML-level duplicates are already caught earlier as `YAML_DUPLICATE_KEY`. Kept in the registry for forward compatibility (see [ADR-0006](../decisions/0006-command-representation.md)).                                                                                                                                                                                                                           | N/A today.                                                                                                                                                |
| `RUNTIME_DECLARATION_INVALID`             | semantic         | An `environment.runtimes` value is not a syntactically valid semver range.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Use a valid range, e.g. `">=20 <23"`.                                                                                                                     |
| `PACKAGE_MANAGER_INVALID`                 | schema/semantic  | `environment.packageManager.name` is not one of `npm`/`pnpm`/`yarn`, or `.version` is not a valid semver version/range.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Use a recognized package manager name and a valid version.                                                                                                |
| `PATH_PATTERN_INVALID`                    | semantic         | A path/glob pattern is empty, contains control characters, uses unsupported syntax (extglobs, unbalanced brackets/braces), or contains glob metacharacters where only a literal path is allowed (`instructions.sources`).                                                                                                                                                                                                                                                                                                                                                                                                                  | See [paths-and-globs.md](paths-and-globs.md) for the supported subset.                                                                                    |
| `PATH_ABSOLUTE_DISALLOWED`                | semantic         | A path is absolute (POSIX-rooted, Windows drive-letter, or UNC).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Rewrite relative to the repository root.                                                                                                                  |
| `PATH_TRAVERSAL_DISALLOWED`               | semantic         | A path attempts to escape the repository root via `..`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Remove the traversal; reference a path within the repository.                                                                                             |
| `PATH_CATEGORY_CONFLICT`                  | semantic         | The same normalized pattern appears more than once, whether within one `paths` category or across `protected`/`generated`/`ignored`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Keep each normalized pattern in exactly one category, once.                                                                                               |
| `INSTRUCTION_SOURCE_INVALID`              | semantic         | An `instructions.sources` entry is invalid (bad pattern, duplicate) or does not exist as a readable file under the repository root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Fix the path, remove the duplicate, or create the missing document.                                                                                       |
| `ARCHITECTURE_DECISION_INVALID`           | semantic/analyze | An `architecture.key_decisions` file is invalid, duplicated, not Markdown, or missing during analysis.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Use a unique repo-relative `.md` decision file and create it.                                                                                             |
| `AGENT_CONTEXT_FILE_INVALID`              | semantic/analyze | An `agents.context_files` entry is invalid, duplicated, not Markdown, or missing during analysis.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Use a unique repo-relative `.md` context file and create it.                                                                                              |
| `ADAPTER_DECLARATION_INVALID`             | schema           | An `adapters` key is not a recognized adapter name, or an adapter declaration doesn't match `{ enabled: boolean }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Use a recognized adapter name (`agentsMd`, `claude`, `cursor`, `copilot`, `gemini`) and a boolean `enabled`.                                              |
| `NORMALIZATION_FAILED`                    | normalize        | An expected invariant inside the normalization stage did not hold, despite validation having passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Please report this as a bug.                                                                                                                              |
| `INTERNAL_INVARIANT_VIOLATION`            | any              | An unexpected internal error anywhere in the pipeline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Please report this as a bug, including the contract that triggered it.                                                                                    |
| `GENERATE_TARGET_UNMANAGED`               | generate         | `generate --write` found an existing file at a planned output path that lacks the managed-file marker, so it was not overwritten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Remove or rename the existing file, or re-run with `--force`.                                                                                             |
| `GENERATE_WRITE_FAILED`                   | generate         | A planned file could not be written to disk (permissions, disk space, etc.).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Check file permissions and available disk space.                                                                                                          |
| `GENERATED_FILES_OUT_OF_DATE`             | verify           | The generated-file preflight found missing or stale enabled-adapter output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Run `agent-ready generate --write`, review, and verify again.                                                                                             |
| `GENERATE_OUTSIDE_REPO_ROOT`              | generate         | Defense-in-depth only: a generated output path did not resolve inside the repository root. Expected unreachable, since output filenames are always adapter-hardcoded, never contract-supplied.                                                                                                                                                                                                                                                                                                                                                                                                                                             | Please report this as a bug in Agent-Ready.                                                                                                               |
| `ADAPTER_NOT_YET_IMPLEMENTED`             | generate         | The contract enables a declared adapter name that has no generator yet. As of this release all five declared adapter names (`agentsMd`, `claude`, `cursor`, `copilot`, `gemini`) have one; this code is reserved for a future adapter name added to the schema ahead of its renderer. Informational — does not fail generation.                                                                                                                                                                                                                                                                                                            | Disable the adapter, or wait for a future release that implements it.                                                                                     |
| `PROTECTED_PATH_MODIFIED`                 | check            | `agent-ready check` found a changed file (in the working tree, the Git index, or relative to an explicit `--against` ref) that matches a `paths.protected` pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Revert the change, or update `paths.protected` in `agent-ready.yaml` if the file should no longer be protected.                                           |
| `GIT_UNAVAILABLE`                         | check            | `agent-ready check` could not read changes from Git — the `git` executable is missing/not on `PATH`, or the underlying Git command failed (e.g. an `--against <ref>` that does not resolve to a valid revision).                                                                                                                                                                                                                                                                                                                                                                                                                           | Ensure `git` is installed and on `PATH`, and that any `--against` ref given exists.                                                                       |
| `GIT_REPOSITORY_NOT_FOUND`                | check            | `agent-ready check` was run against a repository root that is not inside a Git working tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Run inside a Git repository, or initialize one with `git init`.                                                                                           |
| `VERIFICATION_NOT_DECLARED`               | verify           | `agent-ready verify` was run against a contract with no `verification.required` commands. Informational — does not fail the command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Add a `verification.required` list to `agent-ready.yaml`.                                                                                                 |
| `VERIFICATION_COMMAND_FAILED`             | verify           | `agent-ready verify --execute` ran a command that exited with a non-zero status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Fix the underlying failure, then re-run `agent-ready verify --execute`.                                                                                   |
| `VERIFICATION_COMMAND_TIMEOUT`            | verify           | `agent-ready verify --execute` ran a command that exceeded `--timeout` and was killed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Increase `--timeout`, or fix the command if it is unexpectedly hanging.                                                                                   |
| `VERIFICATION_COMMAND_TERMINATION_FAILED` | verify           | A command exceeded its timeout, but Agent-Ready could not confirm that its process tree stopped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Stop the remaining tree manually and investigate signal/process-tree handling.                                                                            |
| `VERIFICATION_COMMAND_SPAWN_FAILED`       | verify           | `agent-ready verify --execute` could not start a command's process at all (e.g. the executable is missing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Ensure the command's executable is installed and on `PATH`.                                                                                               |
| `VERIFICATION_RECORD_WRITE_FAILED`        | verify           | `agent-ready verify --execute --record` could not write the evidence file (`agent-ready-verify-result.json`) to the repository root (permissions, disk space, etc.).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Check file permissions and available disk space.                                                                                                          |
| `HANDOFF_FILE_INVALID`                    | verify           | The handoff file is unreadable, malformed, or has the wrong closed object shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Provide all required fields with documented JSON types.                                                                                                   |
| `HANDOFF_FIELD_TOO_LONG`                  | verify           | A handoff field exceeds its character limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Shorten the summary or array entry.                                                                                                                       |
| `DOCUMENTATION_SOURCE_READ_FAILED`        | analyze          | A declared instruction source passed contract validation but could not be read when documentation analysis ran.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Check that the instruction source remains present and readable.                                                                                           |
| `DOCUMENTATION_LINK_CHECK_FAILED`         | analyze          | The analyzer could not inspect a resolved local link target because of a filesystem error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Check filesystem permissions and retry.                                                                                                                   |
| `DOCUMENTATION_LINK_BROKEN`               | analyze          | A repository-relative Markdown link in a declared instruction source resolves to a file or directory that does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Fix the link, restore its target, or remove the stale link.                                                                                               |
| `DOCUMENTATION_LINK_OUTSIDE_REPOSITORY`   | analyze          | A local Markdown link traverses lexically above the repository root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Replace it with a repository-relative destination that remains inside the repository.                                                                     |
| `INSTRUCTION_SOURCE_TOO_LARGE`            | analyze          | A declared instruction source is larger than the 5,000,000-byte per-source analysis limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Split it into smaller focused sources or remove generated content.                                                                                        |
| `RUNTIME_VERSION_MISMATCH`                | doctor           | Declared Node runtime range does not satisfy detected Node version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Install a Node version satisfying the declared range, or update the contract.                                                                             |
| `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`     | doctor           | A non-`node` runtime is declared under `environment.runtimes`; doctor does not currently probe that runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Track ADR-0023 follow-ups; future ADRs may graduate additional runtimes.                                                                                  |
| `PACKAGE_MANAGER_UNAVAILABLE`             | doctor           | Declared package manager binary is not on `PATH`, or its `--version` probe failed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Install the declared package manager, or update `environment.packageManager`.                                                                             |
| `PACKAGE_MANAGER_VERSION_MISMATCH`        | doctor           | Detected package-manager version does not satisfy the declared range.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Update `environment.packageManager.version` or install a matching version.                                                                                |
| `GIT_REQUIRED_BUT_UNAVAILABLE`            | doctor           | `paths.protected` is declared but `git` is not on `PATH`. `agent-ready check` requires git when protected paths are declared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Install git, or empty `paths.protected` if this repository does not use protected paths.                                                                  |
| `INIT_CONTRACT_EXISTS`                    | init             | `init` found an existing `agent-ready.yaml` and refused to replace it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Keep the existing contract, or rename it explicitly before scaffolding a new one.                                                                         |
| `UPGRADE_NO_CHANGES_NEEDED`               | upgrade          | No safe automatic modernization applies to the already-valid contract. Warning only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | No action required; review any separate manual-review warning.                                                                                            |
| `UPGRADE_MANUAL_REVIEW_REQUIRED`          | upgrade          | A possible modernization depends on maintainer policy or unavailable repository evidence, so it was not applied. Warning only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Review the diagnostic and make the suggested change manually if appropriate.                                                                              |
| `UPGRADE_WRITE_FAILED`                    | upgrade          | A validated upgrade proposal could not be written to the contract file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Check permissions and disk space, then retry `upgrade --write`.                                                                                           |
| `DISCOVERY_ROOT_UNREADABLE`               | discover         | The `--root` path is missing, is not a directory, or could not be read. The only fatal discovery condition. See [ADR-0044](../decisions/0044-repository-discovery-model.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass `--root` with a path to an existing repository directory.                                                                                            |
| `DISCOVERY_PARTIAL`                       | discover         | At least one probe could not complete. The affected fact is `unknown` with reason `probe-failed`. The snapshot is usable but incomplete. Informational — does not fail the command.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Check read permissions on the diagnostic's `sourcePath`, then re-run.                                                                                     |
| `DISCOVERY_FACT_CONFLICT`                 | discover         | Two or more sources assert different values for the same fact. Every claim is retained with its evidence and the fact is reported with **no** value. Informational — does not fail the command. See [ADR-0045](../decisions/0045-package-and-workspace-discovery-semantics.md).                                                                                                                                                                                                                                                                                                                                                            | Decide which source is authoritative and make the repository agree with itself.                                                                           |
| `DISCOVERY_FACT_INCOMPLETE`               | discover         | A declared value is reported alongside evidence that contradicts it. The declaration is carried forward, the contradicting values are published in the fact's `contradictedBy`, and every claim is retained. Informational — does not fail the command. See [ADR-0045](../decisions/0045-package-and-workspace-discovery-semantics.md).                                                                                                                                                                                                                                                                                                    | Read `contradictedBy` and decide which source is authoritative.                                                                                           |
| `DISCOVERY_WORKSPACE_UNSUPPORTED`         | discover         | A workspace declaration exists in a form this version does not model, or a declared pattern was refused as unsafe. Nothing is interpreted and no membership is derived from it. Informational — does not fail the command. See [ADR-0045](../decisions/0045-package-and-workspace-discovery-semantics.md).                                                                                                                                                                                                                                                                                                                                 | Use an array of strings, an object with a `packages` array, or `packages:` in `pnpm-workspace.yaml`.                                                      |
| `DISCOVERY_LOCKFILE_UNREADABLE`           | discover         | A package-manager lockfile path could not be inspected, so its existence is not reported as evidence for that manager. The affected fact is `unknown` with reason `probe-failed`. Informational — does not fail the command. See [ADR-0045](../decisions/0045-package-and-workspace-discovery-semantics.md).                                                                                                                                                                                                                                                                                                                               | Check read permissions on the named path, then re-run.                                                                                                    |
| `DISCOVERY_NO_SIGNALS`                    | discover         | Every probe completed and none found any evidence. A valid, complete, empty result. Informational — does not fail the command. Never emitted together with `DISCOVERY_PARTIAL`, because it asserts a completeness the partial snapshot does not have.                                                                                                                                                                                                                                                                                                                                                                                      | Confirm `--root` points at the repository you intended to inspect.                                                                                        |
| `DISCOVERY_FACT_UNSUPPORTED`              | discover         | A probe read a **shape** this version does not model — for example a `packageManager` field that is not a `<name>@<version>` string, a `scripts` field that is not an object of name/command-string pairs, or a `scripts` entry whose value is not a string. The affected value is reported as unmodelled rather than approximated, and the surrounding observations survive. Reachable as of [ADR-0045](../decisions/0045-package-and-workspace-discovery-semantics.md), which repurposed the ADR-0044 reservation, and extended by [ADR-0046](../decisions/0046-command-and-verification-discovery-semantics.md) to the `scripts` field. | Nothing in the repository needs fixing; read the diagnostic's `detail` to see what was found. Every other declared command and package is still reported. |

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
  values on the comparison axis for that fact. The canonical case is two
  manager-specific artifacts with no declaration: `pnpm-lock.yaml` beside
  `yarn.lock` is a conflict, because npm and pnpm are different values for the
  same identity and neither outranks the other.
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

### `DISCOVERY_FACT_INCOMPLETE`

- **Trigger** — a `declared` or `author-declared` claim is contradicted by a
  `derived` claim about the same fact. The production case is a
  `packageManager` field naming one tool beside another tool's lockfile.
- **Why a separate code** — a declaration and an artifact are not peers, so
  ADR-0044's conflict shape does not fit. Reporting no value would deny that
  the repository declared anything, which is false; reporting the lockfile would
  promote an artifact to an opinion. The fact is therefore _valued but
  contested_, and that is a third outcome, not a variant of the second.
- **Severity / category** — `warning`. Stage: fact merge.
- **Human rendering** — the value is never printed bare. It is rendered with the
  contradicting managers named:

  ```text
  Package manager
    Root         incomplete (pnpm; contradicted by npm)
  ```

- **Structured representation** — the fact keeps its `value` **and** gains
  `contradictedBy`, a code-unit-sorted, deduplicated list of the values the
  retained claims disagree with. `contradictedBy` is non-empty on this variant
  by construction, so "this is incomplete" is checkable from the shape alone and
  a renderer cannot read a contested value as a settled one.
- **Fact / evidence behaviour** — the fact is counted in `summary.known`, not in
  `summary.conflicts`: it is a resolved-as-contested observation, not ignorance.
  Every claim is retained with its evidence, and nothing is ranked.
- **Blocks execution** — no. The command exits `0`.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_FACT_INCOMPLETE`; related
  codes: `DISCOVERY_FACT_CONFLICT`, `DISCOVERY_PARTIAL`.
- **Pinned by** — `tests/unit/discoverPackageManager.test.ts` ("keeps the
  declaration and publishes the artifact that contradicts it"),
  `tests/unit/discoverFactBoundary.test.ts` ("distinguishes an incomplete fact
  from both an agreed one and a conflict").

### `DISCOVERY_WORKSPACE_UNSUPPORTED`

- **Trigger** — a workspace declaration was found but is in a form this
  implementation does not model (`workspaces` as a bare string, a non-string
  entry in a pattern list, a `packages:` key that is not a list of strings, a
  `pnpm-workspace.yaml` that is not valid YAML), **or** a declared pattern was
  refused during normalization.
- **Severity / category** — `warning`. Stage: workspace declaration parsing and
  pattern normalization.
- **Human rendering** — appended below the discovery summary, naming the file
  and, for a refused pattern, the pattern itself:

  ```text
  warning[DISCOVERY_WORKSPACE_UNSUPPORTED]: A workspace pattern in pnpm-workspace.yaml was not expanded.
    pnpm-workspace.yaml declares "../outside", which was not expanded: Path escapes the repository root.
    suggestion: Repository-relative patterns only. A pattern that is absolute or escapes the root is never read from the file system.
  ```

- **Structured representation** — `metadata.source`, and for a refused pattern
  `metadata.pattern` and `metadata.reason`. An unsupported _declaration_ form is
  also visible in the fact itself: `repository.workspace.declarations` carries
  `form: "unsupported"` and an `unsupportedReason`, with `patterns: []`.
- **Fact / evidence behaviour** — an unsupported declaration contributes **no**
  patterns, so `repository.workspace.candidates` and
  `repository.workspace.members` are derived from the declarations that _were_
  understood. The declaration itself is never dropped: it stays in the fact
  list with its reason, so the snapshot cannot present an unmodelled workspace
  as though it did not exist.
- **Path safety** — a refused pattern never reaches the file system.
  Normalization rejects absolute paths, `..` escapes, extglobs, and unbalanced
  brackets before any read, and matched directories are confirmed to be inside
  the repository by real path. Symbolic links are never traversed. The one
  documented departure from ADR-0005 is that `.` is accepted, because
  `packages: ["."]` is how a single-package pnpm repository declares the root as
  a member.
- **Blocks execution** — no. The command exits `0`.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_WORKSPACE_UNSUPPORTED`;
  related codes: `DISCOVERY_FACT_UNSUPPORTED`, `DISCOVERY_PARTIAL`.
- **Pinned by** — `tests/unit/discoverWorkspace.test.ts` ("reports an
  unrecognised workspaces form as unsupported rather than coercing it",
  "refuses a pattern that escapes the repository root before reading anything",
  "accepts `packages: ['.']`, which declares the root as a member").

### `DISCOVERY_LOCKFILE_UNREADABLE`

- **Trigger** — the package-manager probe could not `stat` a lockfile path it
  expected to inspect, and no other artifact for that identity could be seen
  either. The condition is about the **inspection**, not about the file's
  contents: discovery never reads a lockfile, so "unreadable" means "existence
  could not be established", and the remedy is a permission check rather than a
  parse check.
- **Severity / category** — `warning`. Stage: package-manager probing.
- **Human rendering** — `warning[DISCOVERY_LOCKFILE_UNREADABLE]: Probe
package-manager.lockfiles could not complete, so repository.packageManager.root
is reported as unknown.`, naming the first offending path in `sourcePath` and
  listing every one of them in `detail`.
- **Structured representation** — `sourcePath` (the first unreadable path),
  `metadata.probeId`, `metadata.factId`, and a `detail` naming all of them.
- **Fact / evidence behaviour** — the affected package-manager fact is `unknown`
  with reason `probe-failed`, never `no-evidence`: the inspection did not
  complete, so "there is no lockfile here" was never established. When the
  manifest itself declares a manager, that declaration is unaffected and is
  still reported — with `corroborated: false`, because the one source that
  would have supported it could not be read. A readable lockfile beside the
  unreadable one still produces its own `derived` claim, so the code is only
  raised when the inspection produced no evidence at all.
- **Blocks execution** — no. The command exits `0`.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_LOCKFILE_UNREADABLE`;
  related codes: `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_CONFLICT`.
- **Pinned by** — `tests/unit/discoverPackageManager.test.ts` ("reports an
  unstat-able lockfile as its own condition, not as absence", "keeps a declared
  manager when its lockfile cannot be inspected"), `tests/unit/discoverReadOnly.test.ts`
  ("never reads a lockfile's contents, only its presence").

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

- **Trigger** — a probe completed, read something, and deliberately declined to
  interpret it. Two production cases, with identical remediation:
  - a `packageManager` field whose value is not a `<name>@<version>` string:
    `pnpm` alone, `""`, a number, or an object; and
  - a manifest `scripts` field that is not an object of name/command-string
    pairs, or an individual `scripts` entry whose value is not a string.
- **Severity / category** — `warning`. Stage: probe execution.
- **Human rendering** — `warning[DISCOVERY_FACT_UNSUPPORTED]`, naming the probe,
  the fact, and the raw value:

  ```text
  warning[DISCOVERY_FACT_UNSUPPORTED]: Probe package-manager.declaration found a form this version does not model, so repository.packageManager.root was not probed.
    package.json declares "workspace:*", which is not a <name>@<version> string.
    suggestion: Nothing needs fixing in the repository. Agent-Ready declined to guess; the value is reported as unknown rather than approximated.
  ```

- **Structured representation** — `metadata.probeId` and `metadata.factId` for the
  package-manager case; `metadata.path`, `metadata.field`, and `metadata.script`
  for the `scripts` case. The raw value is in `detail`, because the fact itself
  must not carry a value: a claim built from a shape we do not model would be a
  guess wearing a citation.
- **Fact / evidence behaviour** — for a package manager, the fact becomes
  `unknown` with reason `not-probed` and carries **no** claim; evidence from
  other sources for the same fact is unaffected. For `scripts`, the affected
  _package_ reports `scriptsStatus: "unsupported"` (or an entry lands in
  `unmodelledScripts` with its raw JSON value), and every other declared command
  and package is still reported — the failure boundary is one entry, not the
  object, and never the repository.
- **Blocks execution** — no. The command exits `0`.
- **Informational only** — yes.
- **Explain** — `agent-ready explain --code DISCOVERY_FACT_UNSUPPORTED`;
  related codes: `DISCOVERY_WORKSPACE_UNSUPPORTED`.
- **Pinned by** — `tests/unit/discoverPackageManager.test.ts` ("makes no name
  claim for a declaration form it does not model, and still reports the
  lockfile evidence") and `tests/unit/discoverCommands.test.ts` ("a malformed
  scripts field is unsupported, never coerced", "one unusable entry does not
  delete the valid ones beside it").

### Stated deviations from ADR-0044

ADR-0044 is the decision record; where the shipped implementation departs from
its literal wording, the departure is recorded here rather than left for a
reader to discover. ADR-0045 amends three of its rules deliberately; those
amendments are listed at the end of this section.

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
  only when at least two claims support the value. A single source — however
  direct, and even when repeated — does not corroborate itself, and the weaker
  question ("is this more than the author's word?") is already answered by
  `corroboration.kinds`. This is strictly narrower than the first reading of the
  field, in the direction of under-claiming rather than over-claiming.
- **Contradiction has two shapes.** ADR-0044 models disagreement as one outcome.
  The implementation has two, because a `declared` claim and a `derived` claim
  are not peers. Two sources of the same kind that disagree are a
  `ConflictedFact` with no value, exactly as ADR-0044 requires. A declaration
  contradicted by an artifact is an `IncompleteFact`: it keeps the declaration as
  its value and publishes the contradicting values in `contradictedBy`, because
  a conflict shape built only on peer comparison cannot express "the repository
  said pnpm and there is also an npm artifact" without either dropping a true
  claim or promoting an artifact to a declaration. Neither shape names a winner.
  This is ADR-0045's first amendment.

### Amendments recorded by ADR-0045

ADR-0045 is a separate decision record that amends ADR-0044 in three places.
Each amendment is narrower than the rule it replaces, and each is listed here so
that a consumer reading the diagnostics does not have to reconstruct the
reasoning from the code.

- **Corroboration is about claims, not cited files.** ADR-0044 defined
  `corroborated` as two claims whose evidence comes from different files. That
  holds for the single-file facts #36 shipped and collapses for a fact whose
  evidence is naturally spread over several files: a package manager evidenced by
  three lockfiles would report `corroborated: false` for every claim. It is now
  two claims. The property ADR-0044 protected is preserved by two narrower rules
  enforced at the probe boundary in `src/discover/discover.ts`: **one claim is
  one source** (a claim may not cite more than `evidenceBudgetFor(kind)` paths —
  two for `derived`, one otherwise), and **one document is one source** (no
  probe may split a single document into more than one claim). A violation is
  downgraded to a failed probe, so manufactured corroboration is recorded as
  nothing at all rather than as support.
- **Contradiction is incomplete as well as conflicting.** As described above.
- **`DISCOVERY_FACT_UNSUPPORTED` is reachable.** It was reserved for a fact
  _kind_ outside the four ADR-0044 defines. It is now used for a fact _shape_
  this implementation does not model. The four epistemic kinds are unchanged and
  no fifth kind exists; only the code's meaning was narrowed to something real,
  so it is no longer a dead registry entry. Its registry entry, severity,
  renderer behaviour, JSON behaviour, explain support, and documentation are all
  updated with it, so it is not an orphan code.

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
- `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_CONFLICT`, `DISCOVERY_FACT_INCOMPLETE`,
  `DISCOVERY_WORKSPACE_UNSUPPORTED`, `DISCOVERY_LOCKFILE_UNREADABLE`,
  `DISCOVERY_NO_SIGNALS`, and `DISCOVERY_FACT_UNSUPPORTED` — the discovery
  conditions that leave a snapshot usable. See
  [Repository discovery diagnostics](#repository-discovery-diagnostics) and the
  stated deviations from ADR-0044 recorded there.

Every other code is emitted as `"error"`.

## Exit-code mapping

See [ADR-0008](../decisions/0008-diagnostics-and-exit-codes.md) and
[cli-reference.md](cli-reference.md#exit-codes) for how a diagnostic list
maps to a single process exit code.

`agent-ready discover` uses that same mapping and adds no scheme of its own.
Its consequences, which are part of the command's contract:

- A snapshot with no diagnostics, or with warnings only — including
  `DISCOVERY_PARTIAL`, `DISCOVERY_FACT_CONFLICT`, `DISCOVERY_FACT_INCOMPLETE`,
  and `DISCOVERY_NO_SIGNALS` — exits `0`. Partial, empty, contradictory, and
  contested knowledge are all successful results. A messy repository is still a
  discoverable repository.
- `DISCOVERY_ROOT_UNREADABLE` is the only fatal discovery condition, and it
  exits `2`, the "input was not readable" category, because the location
  `--root` named could not be used. It is not a validation failure: nothing was
  validated.
- A missing `agent-ready.yaml` is **not** fatal for this command. Every other
  command treats it as `CONTRACT_NOT_FOUND` and exits non-zero; `discover`
  reports it as a fact and continues.
