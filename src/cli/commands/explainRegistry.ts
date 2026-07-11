import type { DiagnosticCode } from "../../diagnostics/codes.js";

/**
 * Extended explanation for a single diagnostic code. Complementing the
 * existing one-line `summary`/`remediation` fields, this provides the
 * longer-form tutorial content `agent-ready explain` renders.
 */
export interface Explanation {
  /** One- to two-sentence plain-language definition of what this code means. */
  readonly what: string;
  /** Why Agent-Ready checks for this condition and what the user should understand about it. */
  readonly why: string;
  /** Step-by-step remediation, with concrete YAML or shell examples where helpful. */
  readonly fix: string;
  /**
   * JSON Pointer paths to contract fields this diagnostic commonly
   * relates to. When `--config` is given, explain reads these fields
   * from the loaded contract and surfaces their values in the
   * "Your contract" section.
   */
  readonly fields?: readonly string[];
  /** Stable diagnostic codes commonly related to this one. */
  readonly related?: readonly DiagnosticCode[];
}

/**
 * Registry of extended explanations for every diagnostic code in
 * DIAGNOSTIC_CODES. A unit test asserts that every code has an entry
 * so the registry cannot drift from the code list.
 *
 * Exported for testing; not part of the public API surface (not
 * exported from src/index.ts).
 */
export const EXPLANATION_REGISTRY: ReadonlyMap<DiagnosticCode, Explanation> = new Map<
  DiagnosticCode,
  Explanation
>([
  // ── discovery / read ─────────────────────────────────────────────────
  [
    "CONTRACT_NOT_FOUND",
    {
      what: "Agent-Ready could not find an agent-ready.yaml file in the current directory or any ancestor directory. If you used the --config flag, the path you gave doesn't exist or isn't a regular file.",
      why: "Agent-Ready needs a contract file to know which commands, paths, and environment constraints to validate against. Without one, there's nothing to check.",
      fix: "1. Create an agent-ready.yaml file at the root of your repository.\n2. Or, if the file is at a non-standard location, pass it explicitly:\n     agent-ready validate --config path/to/agent-ready.yaml\n3. Start from the minimal example:\n     version: 1\n     project:\n       name: my-project",
    },
  ],
  [
    "CONTRACT_READ_FAILED",
    {
      what: "The agent-ready.yaml file exists but could not be read. This usually means the file permissions are too restrictive or the file exceeds the 1 MB size limit.",
      why: "Agent-Ready reads the contract as plain text before parsing it. A filesystem error at this stage means the file is present but inaccessible.",
      fix: "1. Check that the file has read permissions:\n     chmod 644 agent-ready.yaml\n2. Ensure the file is under 1 MB. If it's larger than that, split declaration data into referenced files.",
      fields: ["/"],
    },
  ],

  // ── parsing ──────────────────────────────────────────────────────────
  [
    "YAML_PARSE_FAILED",
    {
      what: "The agent-ready.yaml file is not valid YAML syntax. The YAML parser encountered a structural error it could not recover from.",
      why: "Agent-Ready uses a strict YAML parser that rejects malformed documents. A parse error means the file's syntax is incorrect in a way that prevents any further validation from running.",
      fix: "1. Check the line and column reported in the error message.\n2. Common mistakes: inconsistent indentation, missing colons after keys, unquoted values that look like YAML directives.\n3. Use a YAML validator (e.g. yamllint.com) to pinpoint the error.",
    },
  ],
  [
    "YAML_DUPLICATE_KEY",
    {
      what: "The agent-ready.yaml file contains the same mapping key repeated at the same nesting level. For example, two `project:` blocks at the top level.",
      why: "YAML allows duplicate keys syntactically, but they are almost always a mistake — one value silently overwrites the other. Agent-Ready rejects them explicitly so the intended value is unambiguous.",
      fix: "1. Find the duplicate key at the reported location.\n2. Merge the content of both occurrences into a single entry, or rename one of them if they were meant to be distinct.",
    },
  ],
  [
    "YAML_NESTING_TOO_DEEP",
    {
      what: "The contract's YAML structure is nested more deeply than Agent-Ready's configured safety limit.",
      why: "Extremely deep non-aliased YAML can exhaust the JavaScript call stack or consume disproportionate parser time even when the file is small. Agent-Ready checks AST depth before converting YAML to plain objects.",
      fix: "1. Flatten deeply nested mappings or sequences.\n2. Move long-form guidance into files listed under instructions.sources.\n3. Keep the contract focused on repository metadata, commands, paths, and adapter declarations.",
      fields: ["/"],
    },
  ],

  // ── schema ────────────────────────────────────────────────────────────
  [
    "CONTRACT_SCHEMA_INVALID",
    {
      what: "The contract does not match the expected shape defined by the Agent-Ready JSON Schema. This covers missing required fields, wrong types, and unknown fields that the schema explicitly rejects.",
      why: "Agent-Ready validates every contract against a strict JSON Schema that rejects unknown fields. This ensures the contract's shape is known and tooling can rely on it.",
      fix: "1. Read the full diagnostic detail — it names the exact field and the validation failure.\n2. Check docs/specification/contract-reference.md for the allowed shape.\n3. Run `agent-ready schema` to see the schema for yourself.\n4. Common fixes: add a required `project.name`, remove unsupported top-level keys, ensure `version` is the integer 1.",
      fields: ["/"],
    },
  ],

  // ── semantic ──────────────────────────────────────────────────────────
  [
    "CONTRACT_VERSION_UNSUPPORTED",
    {
      what: "The `version` field in agent-ready.yaml is a number other than 1. Only contract version 1 is supported by this CLI build.",
      why: "The contract version lets Agent-Ready evolve the schema without breaking existing files. If you have a version other than 1, this CLI build cannot validate your contract correctly.",
      fix: "1. Set `version: 1` at the top of agent-ready.yaml.\n2. If you genuinely need a newer contract version, upgrade the Agent-Ready CLI:\n     pnpm add -D @adameddahmouni/agent-ready@latest",
      fields: ["/version"],
    },
  ],
  [
    "COMMAND_IDENTIFIER_INVALID",
    {
      what: "A key under the `commands` section does not follow the required format: lowercase kebab-case (e.g. `lint`, `test-e2e`).",
      why: "Command identifiers must be predictable so they can be referenced reliably from `verification.required` and future tooling. Uppercase, spaces, and special characters are rejected.",
      fix: "1. Rename the command to lowercase kebab-case.\n   Good: `test-e2e`, `lint`, `build-release`\n   Bad: `TestE2E`, `test e2e`, `test_e2e`",
      fields: ["/commands"],
    },
  ],
  [
    "COMMAND_REFERENCE_INVALID",
    {
      what: "A `verification.required` entry references a command that hasn't been declared under `commands`, or the same command appears more than once in the list.",
      why: "Every entry in `verification.required` must point to a command Agent-Ready can look up. A dangling reference means the verification plan would be incomplete.",
      fix: '1. Add the missing command under `commands:`.\n2. Or, remove the invalid entry from `verification.required`.\n3. Check for typos: `verification.required: ["linnt"]` when the command is `lint`.',
      fields: ["/verification/required", "/commands"],
    },
  ],
  [
    "COMMAND_DUPLICATE",
    {
      what: "Reserved for forward compatibility. Under normal YAML parsing this code is not reachable, since JS object keys are unique and YAML-level duplicates are caught as YAML_DUPLICATE_KEY.",
      why: "Kept in the registry for completeness and future YAML representation changes.",
      fix: "N/A today. If you encounter this code, please report it as a bug.",
    },
  ],
  [
    "RUNTIME_DECLARATION_INVALID",
    {
      what: 'A value under `environment.runtimes` is not a syntactically valid semver range. For example, `node: "latest"` or `python: "^3"` may not parse as valid semver.',
      why: "Agent-Ready uses semver ranges to compare declared runtimes against detected versions. A malformed range can't be used for comparison.",
      fix: '1. Use a valid semver range.\n   Good: `node: ">=20 <23"`, `python: ">=3.10"`\n   Bad: `"latest"`, `"*"`, `"20.x"`\n2. Check the semver documentation for supported range syntax.',
      fields: ["/environment/runtimes"],
    },
  ],
  [
    "PACKAGE_MANAGER_INVALID",
    {
      what: "The `environment.packageManager` block has an unsupported name (must be npm, pnpm, or yarn) or the version string is not a valid semver version or range.",
      why: "Agent-Ready validates the package manager declaration so `agent-ready doctor` can compare it against the actually-installed manager. Unsupported names or garbled versions can't be checked.",
      fix: '1. Set `name` to one of: npm, pnpm, yarn.\n2. Set `version` to a valid semver version or range:\n     environment:\n       packageManager:\n         name: pnpm\n         version: "10"',
      fields: ["/environment/packageManager"],
    },
  ],

  // ── paths ─────────────────────────────────────────────────────────────
  [
    "PATH_PATTERN_INVALID",
    {
      what: "A path or glob pattern in `paths.protected`, `paths.generated`, `paths.ignored`, or `instructions.sources` is empty, contains control characters, uses unsupported glob syntax, or contains glob metacharacters where only a literal path is allowed.",
      why: "Agent-Ready supports a specific glob subset for path patterns. Extglob syntax (`@(...)`, `+(...)`, etc.) and unbalanced brackets/braces are rejected rather than silently reinterpreted.",
      fix: "1. Remove extglob operators — use `*.ts` instead of `@(*.ts)`.\n2. Ensure brackets and braces are balanced.\n3. For `instructions.sources`, use literal file paths only (no `*`, `?`, `[...]`).",
      fields: ["/paths"],
    },
  ],
  [
    "PATH_ABSOLUTE_DISALLOWED",
    {
      what: "A path is absolute (/etc/passwd, C:\\Windows, or a UNC path) when only repository-relative paths are allowed.",
      why: "Agent-Ready operates against a repository root. Absolute paths can't be checked for traversal safety and would break when the repository is cloned to a different location.",
      fix: "Rewrite the path relative to the repository root:\n  Bad: /home/user/project/.env\n  Good: .env",
      fields: ["/paths"],
    },
  ],
  [
    "PATH_TRAVERSAL_DISALLOWED",
    {
      what: "A path attempts to escape the repository root using `..` segments, e.g. `../outside` or `../../etc/passwd`.",
      why: "All paths must stay inside the repository. Traversal outside the repo could expose files the contract shouldn't describe.",
      fix: "Remove the `..` segments. Reference paths that are within the repository:\n  Bad: ../shared/config\n  Good: packages/shared/config (if the shared package is inside the repo)",
      fields: ["/paths"],
    },
  ],
  [
    "PATH_CATEGORY_CONFLICT",
    {
      what: "The same normalized glob pattern appears more than once across `paths.protected`, `paths.generated`, and `paths.ignored` combined.",
      why: "A file can only belong to one path category. If a pattern is in both `protected` and `ignored`, Agent-Ready can't determine which rule applies.",
      fix: "Choose exactly one category for each pattern:\n  - protected: files that must not be modified by agents (e.g. .env, CI config).\n  - generated: files produced by the project's own build (e.g. dist/**, src/generated/**).\n  - ignored: files neither protected nor generated (e.g. node_modules/**, .git/**).",
      fields: ["/paths"],
    },
  ],

  // ── instructions ──────────────────────────────────────────────────────
  [
    "INSTRUCTION_SOURCE_INVALID",
    {
      what: "An entry in `instructions.sources` is not a valid, readable file under the repository root, or the same path appears more than once.",
      why: "Every instruction source must be a real file so `agent-ready generate` can read its contents and `agent-ready analyze` can check its links.",
      fix: "1. Verify the file exists at the declared path.\n2. Fix typos in the path.\n3. Remove duplicate entries.",
      fields: ["/instructions/sources"],
    },
  ],

  // ── adapters ──────────────────────────────────────────────────────────
  [
    "ADAPTER_DECLARATION_INVALID",
    {
      what: "An `adapters` key is not one of the recognized adapter names (`agentsMd`, `claude`, `cursor`, `copilot`, `gemini`), or an adapter value does not match the `{ enabled: boolean }` shape.",
      why: "Only the five known adapters are supported. An unrecognized adapter name cannot produce output and must be rejected rather than silently ignored.",
      fix: "1. Use one of the five recognized adapter names.\n2. Set `enabled: true` or `enabled: false` for each adapter.",
      fields: ["/adapters"],
    },
  ],

  // ── normalize ─────────────────────────────────────────────────────────
  [
    "NORMALIZATION_FAILED",
    {
      what: "An internal error occurred during contract normalization — the stage that applies defaults and produces the canonical in-memory representation.",
      why: "Normalization should never fail after schema and semantic validation pass. This indicates a bug in Agent-Ready.",
      fix: "Please report this as a bug, including the agent-ready.yaml that triggered it.",
    },
  ],

  // ── internal ──────────────────────────────────────────────────────────
  [
    "INTERNAL_INVARIANT_VIOLATION",
    {
      what: "An unexpected internal error occurred — the Agent-Ready installation itself appears broken, or an invariant the code assumes always holds was violated.",
      why: "This is always a bug in Agent-Ready, not a problem with your contract.",
      fix: "1. Reinstall Agent-Ready:\n     pnpm add -D @adameddahmouni/agent-ready@latest\n2. If the error persists, please report it as a bug at github.com/AdamEddahmouni/agent-ready/issues. Include the full error output and the agent-ready.yaml that triggered it.",
    },
  ],

  // ── generate ──────────────────────────────────────────────────────────
  [
    "ARCHITECTURE_DECISION_INVALID",
    {
      what: "An architecture.key_decisions entry is malformed, duplicated, not a repository-relative Markdown path, or its referenced file is missing when analyzed.",
      why: "Architecture decisions are rendered as safe, durable links in generated instructions, so Agent-Ready keeps them bounded to unique local Markdown files.",
      fix: "1. Use a unique repository-relative .md path.\n2. Create the referenced decision file.\n3. Re-run validate and analyze.",
      fields: ["/architecture/key_decisions"],
      related: ["PATH_PATTERN_INVALID", "PATH_TRAVERSAL_DISALLOWED"],
    },
  ],
  [
    "AGENT_CONTEXT_FILE_INVALID",
    {
      what: "An agents.context_files entry is malformed, duplicated, not a repository-relative Markdown path, or its referenced file is missing when analyzed.",
      why: "Context files are rendered as safe links for agents, so the contract only accepts unique local Markdown references.",
      fix: "1. Use a unique repository-relative .md path.\n2. Create the referenced context file.\n3. Re-run validate and analyze.",
      fields: ["/agents/context_files"],
      related: ["PATH_PATTERN_INVALID", "PATH_TRAVERSAL_DISALLOWED"],
    },
  ],
  [
    "GENERATE_TARGET_UNMANAGED",
    {
      what: "`agent-ready generate --write` found an existing file at a planned output path (e.g. AGENTS.md) that was not originally created by Agent-Ready, so it refused to overwrite it.",
      why: "The managed-file marker protects hand-authored content. If you wrote AGENTS.md by hand, Agent-Ready won't silently replace it.",
      fix: "1. If the existing file is hand-authored and should be preserved, remove the corresponding adapter from agent-ready.yaml.\n2. If you want Agent-Ready to manage the file, delete or rename it first, or re-run with --force:\n     agent-ready generate --write --force",
      related: ["GENERATE_WRITE_FAILED"],
    },
  ],
  [
    "GENERATE_WRITE_FAILED",
    {
      what: "`agent-ready generate --write` could not write a planned file to disk. Usually a permissions problem or a full disk.",
      why: "Generate writes are the same as any other file write. If the disk is read-only or the directory lacks write permissions, the write fails.",
      fix: "1. Check that the target directory is writable.\n2. Ensure no other process has the file locked.\n3. Check available disk space.",
      related: ["GENERATE_TARGET_UNMANAGED"],
    },
  ],
  [
    "GENERATE_OUTSIDE_REPO_ROOT",
    {
      what: "Defense-in-depth: a generated output path resolved outside the repository root. This should be unreachable in normal operation since all adapter output paths are hardcoded.",
      why: "This code exists as a safety net. If you see it, the installation or adapter registry is corrupted.",
      fix: "Please report this as a bug in Agent-Ready.",
      related: ["INTERNAL_INVARIANT_VIOLATION"],
    },
  ],
  [
    "ADAPTER_NOT_YET_IMPLEMENTED",
    {
      what: "The contract enables an adapter name that has no renderer yet. This is a warning, not an error — generation continues for the other adapters.",
      why: "As of this release, all five declared adapter names have renderers. This code is reserved for future adapter names added to the schema before their renderer is ready.",
      fix: "1. Disable the adapter in agent-ready.yaml if you don't need it.\n2. Or, wait for a future Agent-Ready release that implements it.",
    },
  ],

  // ── check ─────────────────────────────────────────────────────────────
  [
    "PROTECTED_PATH_MODIFIED",
    {
      what: "`agent-ready check` found a file that was changed in Git and matches a `paths.protected` pattern declared in agent-ready.yaml.",
      why: "Protected paths are files that AI coding agents must not modify — things like .env, CI configuration, or security-sensitive build scripts. When check reports a violation, it means one of those files was changed.",
      fix: "1. If the change was intentional and the file should no longer be protected, update paths.protected.\n2. If the change was accidental, revert it:\n     git checkout -- <file>\n3. Use `agent-ready check --json` for machine-readable output in CI.",
      fields: ["/paths/protected"],
      related: ["GIT_UNAVAILABLE", "GIT_REPOSITORY_NOT_FOUND"],
    },
  ],
  [
    "GIT_UNAVAILABLE",
    {
      what: "`agent-ready check` (or `agent-ready doctor`) could not access Git — the `git` executable is missing, not on PATH, or the underlying git command failed.",
      why: "Commands that compare against Git history (`check`, `doctor`) need the `git` binary. Without it, protected-path enforcement cannot determine what changed.",
      fix: "1. Install git: https://git-scm.com/downloads\n2. Ensure git is on your PATH:\n     git --version\n3. For doctor specifically: if `paths.protected` is empty, git is optional and this is only a warning.",
      related: ["GIT_REPOSITORY_NOT_FOUND", "GIT_REQUIRED_BUT_UNAVAILABLE"],
    },
  ],
  [
    "GIT_REPOSITORY_NOT_FOUND",
    {
      what: "`agent-ready check` (or `agent-ready doctor`) was run against a directory that is not inside a Git working tree.",
      why: "Protected-path enforcement and repository membership checks need a Git repository to compare against.",
      fix: "1. Run inside a Git repository.\n2. If this is a new project, initialize one:\n     git init\n3. For doctor: if `paths.protected` is empty, this is informational only.",
      related: ["GIT_UNAVAILABLE"],
    },
  ],

  // ── verify ────────────────────────────────────────────────────────────
  [
    "VERIFICATION_NOT_DECLARED",
    {
      what: "`agent-ready verify` ran against a contract that has no `verification.required` commands. This is a warning — there's simply nothing to verify.",
      why: "Verification is opt-in. If your contract doesn't declare any verification steps, verify succeeds with zero work done.",
      fix: "Add a `verification.required` list to agent-ready.yaml with command identifiers to run:\n  verification:\n    required:\n      - lint\n      - test",
      fields: ["/verification/required"],
    },
  ],
  [
    "VERIFICATION_COMMAND_FAILED",
    {
      what: "`agent-ready verify --execute` ran a declared command and it exited with a non-zero status code.",
      why: "A verification command that exits non-zero means the check it performed did not pass. Verification stops at the first failure so remaining commands are skipped.",
      fix: "1. Run the failing command directly to see its full output:\n     pnpm lint\n2. Fix the underlying issue.\n3. Re-run `agent-ready verify --execute` to confirm the fix.",
      fields: ["/verification/required"],
      related: ["VERIFICATION_COMMAND_TIMEOUT", "VERIFICATION_COMMAND_SPAWN_FAILED"],
    },
  ],
  [
    "VERIFICATION_COMMAND_TIMEOUT",
    {
      what: "`agent-ready verify --execute` ran a command that exceeded the per-command timeout and was killed.",
      why: "Each verification command has a time limit (default 900 seconds). A timeout prevents hung commands from blocking CI indefinitely.",
      fix: "1. If the command legitimately needs more time, increase the timeout:\n     agent-ready verify --execute --timeout 1800\n2. If the command is hanging unexpectedly, investigate why.",
      fields: ["/verification/required"],
      related: ["VERIFICATION_COMMAND_FAILED"],
    },
  ],
  [
    "VERIFICATION_COMMAND_SPAWN_FAILED",
    {
      what: "`agent-ready verify --execute` could not start a command's process at all. The executable declared in `commands.<name>.run` is missing or not on PATH.",
      why: "A command declaration references an executable that doesn't exist on this system. It could be a missing tool or a typo in the run string.",
      fix: "1. Verify the executable is installed:\n     pnpm --version\n2. Check the `run` field for typos.\n3. If the command uses a project-local binary, ensure dependencies are installed first.",
      fields: ["/verification/required", "/commands"],
      related: ["VERIFICATION_COMMAND_FAILED"],
    },
  ],
  [
    "VERIFICATION_RECORD_WRITE_FAILED",
    {
      what: "`agent-ready verify --execute --record` could not write the evidence file (agent-ready-verify-result.json) to the repository root.",
      why: "The evidence record is written as a regular file. If the repository root is read-only or the disk is full, the write fails.",
      fix: "1. Check that the repository root directory is writable.\n2. Check available disk space.\n3. Ensure no other process has locked the file.",
      fields: ["/"],
    },
  ],

  // ── analyze ───────────────────────────────────────────────────────────
  [
    "DOCUMENTATION_SOURCE_READ_FAILED",
    {
      what: "`agent-ready analyze` tried to read a declared instruction source file but the filesystem returned an error — the file was valid during contract validation but became unreadable between validation and analysis.",
      why: "This is a rare race condition where a file is removed or its permissions change between the validation and analysis stages.",
      fix: "1. Check that the file still exists and is readable.\n2. Re-run `agent-ready analyze` — it may have been transient.",
    },
  ],
  [
    "DOCUMENTATION_LINK_CHECK_FAILED",
    {
      what: "`agent-ready analyze` could not inspect a resolved local link target because the filesystem returned an error (e.g. permission denied on a directory).",
      why: "The analyzer resolves each Markdown link to a file or directory and checks its existence. A filesystem error during that check is distinct from the target being missing.",
      fix: "1. Check permissions on the directory containing the link target.\n2. Re-run `agent-ready analyze`.",
    },
  ],
  [
    "DOCUMENTATION_LINK_BROKEN",
    {
      what: "`agent-ready analyze` found a repository-relative Markdown link in a declared instruction source that points to a file or directory that does not exist.",
      why: "Instruction sources are documentation. Broken links mean your docs reference something that no longer exists — a moved file, a deleted section, or a typo.",
      fix: "1. Open the source file at the reported line and column.\n2. Fix the link to point to the correct destination.\n3. If the target was intentionally removed, remove or update the link.",
      related: ["DOCUMENTATION_LINK_OUTSIDE_REPOSITORY"],
    },
  ],
  [
    "DOCUMENTATION_LINK_OUTSIDE_REPOSITORY",
    {
      what: "A Markdown link in a declared instruction source traverses lexically above the repository root (e.g. `../outside-repo/doc.md`).",
      why: "All instruction sources and their links must stay within the repository. Links that traverse above the root cannot be verified and may expose paths outside the project.",
      fix: "Replace the link with a repository-relative destination that stays inside the repository. If the linked document is important, consider copying it into the repository.",
      related: ["DOCUMENTATION_LINK_BROKEN"],
    },
  ],
  [
    "INSTRUCTION_SOURCE_TOO_LARGE",
    {
      what: "A file listed in instructions.sources is larger than the per-source analysis limit, so agent-ready analyze refused to read it into memory.",
      why: "Instruction-source analysis is intentionally bounded. A single pathological or accidentally generated Markdown file should not be able to consume unbounded memory.",
      fix: "1. Split the document into smaller focused Markdown files.\n2. List the smaller files under instructions.sources.\n3. Remove generated or binary-like content from instruction sources.",
      fields: ["/instructions/sources"],
      related: ["DOCUMENTATION_SOURCE_READ_FAILED"],
    },
  ],

  // ── init ──────────────────────────────────────────────────────────────
  [
    "INIT_CONTRACT_EXISTS",
    {
      what: "`agent-ready init` was asked to scaffold a starter agent-ready.yaml but one already exists at the repository root. `init` never overwrites an existing contract file.",
      why: "The contract is the repository's source of truth for agent-ready configuration — it is hand-authored and version-controlled. Unlike generated adapter output, a lost contract cannot be reproduced from source.",
      fix: "1. If you want a fresh starter contract, delete or rename the existing file: mv agent-ready.yaml agent-ready.yaml.bak\\n2. Re-run `agent-ready init --write`.\\n3. Review the generated contract and merge back any customizations from your backup.",
      fields: ["/"],
    },
  ],

  // ── upgrade ───────────────────────────────────────────────────────────
  [
    "UPGRADE_NO_CHANGES_NEEDED",
    {
      what: "agent-ready upgrade inspected the contract and found no safe automatic modernizations to propose.",
      why: "Upgrade is conservative and additive. It reports this warning when the contract already includes all evidence-backed v0.4 recommendations.",
      fix: "No action is required. Review any separate UPGRADE_MANUAL_REVIEW_REQUIRED warnings.",
      fields: ["/"],
      related: ["UPGRADE_MANUAL_REVIEW_REQUIRED"],
    },
  ],
  [
    "UPGRADE_MANUAL_REVIEW_REQUIRED",
    {
      what: "agent-ready upgrade found a possible modernization that requires maintainer judgment and deliberately did not apply it.",
      why: "Runtime support ranges and unreadable repository evidence cannot be changed safely from syntax alone. Upgrade never replaces a maintainer-declared policy value automatically.",
      fix: "Read the diagnostic detail, confirm the repository's actual policy or file state, then make the suggested change manually if appropriate.",
      fields: ["/environment/runtimes/node"],
      related: ["UPGRADE_NO_CHANGES_NEEDED"],
    },
  ],
  [
    "UPGRADE_WRITE_FAILED",
    {
      what: "agent-ready upgrade produced and validated a safe proposal but could not write it back to agent-ready.yaml.",
      why: "The filesystem rejected the write, usually because of permissions, a read-only mount, or insufficient disk space. The original contract remains intact.",
      fix: "Check file permissions and available disk space, inspect the dry-run diff again, then retry with --write.",
      fields: ["/"],
    },
  ],

  // ── doctor ────────────────────────────────────────────────────────────
  [
    "RUNTIME_VERSION_MISMATCH",
    {
      what: "`agent-ready doctor` detected that the running Node.js version does not satisfy the declared range in `environment.runtimes.node`.",
      why: "The contract declares which Node version range the project supports. Running Agent-Ready with a version outside that range means commands that shell out to Node may behave differently.",
      fix: '1. Install a Node version that satisfies the declared range:\n     nvm install 22  (or use fnm, volta, etc.)\n2. Or, update agent-ready.yaml to match the installed version:\n     environment:\n       runtimes:\n         node: ">=20"',
      fields: ["/environment/runtimes/node"],
    },
  ],
  [
    "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
    {
      what: "The contract declares a non-Node runtime (e.g. `python`, `ruby`) under `environment.runtimes`, but `agent-ready doctor` does not currently probe that runtime. This is a warning — it doesn't prevent any command from working.",
      why: "Doctor currently only probes Node and package managers. Non-Node runtime probing may be added in a future ADR.",
      fix: "No action required. This is informational only. Track ADR-0023 follow-ups for future runtime probe support.",
      fields: ["/environment/runtimes"],
    },
  ],
  [
    "PACKAGE_MANAGER_UNAVAILABLE",
    {
      what: "The contract declares a package manager (pnpm, npm, or yarn) that is not installed or not on your PATH. Agent-Ready tried to probe it with `--version` and could not find it.",
      why: "Commands like `agent-ready verify --execute` shell out to the declared package manager. Without it, verification commands that use `pnpm lint` or similar would fail with 'command not found'.",
      fix: '1. Install the declared package manager. For pnpm:\n     npm install -g pnpm\n2. Verify it is on your PATH:\n     pnpm --version\n3. Or, update agent-ready.yaml to declare the manager you already use:\n     environment:\n       packageManager:\n         name: npm\n         version: "10"\n4. Re-run `agent-ready doctor` to confirm.',
      fields: ["/environment/packageManager"],
      related: ["PACKAGE_MANAGER_VERSION_MISMATCH", "PACKAGE_MANAGER_INVALID"],
    },
  ],
  [
    "PACKAGE_MANAGER_VERSION_MISMATCH",
    {
      what: "`agent-ready doctor` detected a package manager version that does not satisfy the declared range in `environment.packageManager.version`.",
      why: "Different package manager versions can produce different lockfile formats and resolution behavior. The declared range declares which versions the project is tested against.",
      fix: '1. Update the declared version to match:\n     environment:\n       packageManager:\n         version: "9"  (if you have pnpm 9.x)\n2. Or, upgrade the installed package manager:\n     npm install -g pnpm@latest',
      fields: ["/environment/packageManager"],
      related: ["PACKAGE_MANAGER_UNAVAILABLE"],
    },
  ],
  [
    "GIT_REQUIRED_BUT_UNAVAILABLE",
    {
      what: "`agent-ready doctor` found that `paths.protected` is declared in agent-ready.yaml but `git` is not on PATH. `agent-ready check` requires git to compare protected paths against Git changes.",
      why: "When `paths.protected` is non-empty, the `agent-ready check` command becomes meaningful — and check needs git. Doctor flags this proactively so you know check would fail before you try to run it.",
      fix: "1. Install git: https://git-scm.com/downloads\n2. Or, empty `paths.protected` if this repository does not use protected paths:\n     paths:\n       protected: []\n3. Re-run `agent-ready doctor` to confirm.",
      fields: ["/paths/protected"],
      related: ["GIT_UNAVAILABLE"],
    },
  ],
]);
