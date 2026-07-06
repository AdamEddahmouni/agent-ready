import semver from "semver";
import type { BinaryClient, BinaryTarget } from "../../binary/types.js";
import { BinaryClientError } from "../../binary/types.js";
import { loadContract } from "../../contract/pipeline.js";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { ExitCode, resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import type { FileSystem } from "../../filesystem/types.js";
import type { GitClient } from "../../git/types.js";
import { GitClientError } from "../../git/types.js";
import type { CliOutcome, ValidateArgs } from "./validate.js";

export type DoctorArgs = ValidateArgs;

type CheckStatus = "pass" | "warn" | "fail";

/**
 * Per-check row (ADR-0023 §"JSON output"). Always has `check` and
 * `status`; the remaining fields appear conditionally by check type. The
 * shape is uniform across checks so consumers do not have to dispatch on
 * `check` to know what fields to expect.
 */
interface CheckRow {
  readonly check: string;
  readonly status: CheckStatus;
  readonly declared?: string | { readonly name: string; readonly version: string };
  readonly detected?: string | { readonly version: string; readonly path: string } | boolean | null;
  readonly required?: boolean;
  readonly summary?: string;
}

interface DoctorFinishContext {
  readonly contractPath: string;
  readonly repoRoot: string;
  readonly checks: readonly CheckRow[];
}

const SUPPORTED_PACKAGE_MANAGERS: readonly BinaryTarget[] = ["pnpm", "npm", "yarn"];

/**
 * Inspects the host environment for fitness to run Agent-Ready against
 * the contract: declared Node range, declared package manager, declared
 * non-Node runtimes, Git on PATH, and Git working-tree membership. Read
 * only; never executes contract-declared commands, never invokes Git for
 * state-changing operations, never modifies the repository. See
 * ADR-0023 for the design rationale.
 */
export async function runDoctor(
  fs: FileSystem,
  git: GitClient,
  binary: BinaryClient,
  args: DoctorArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const result = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });
  if (!result.ok) {
    return finish(args, result.diagnostics);
  }
  const { contract, contractPath, repoRoot } = result.value;

  const diagnostics: Diagnostic[] = [...result.diagnostics];
  const checks: CheckRow[] = [];

  // Check 1: Node runtime (always emitted; warn-only when not declared).
  pushRuntimeNodeCheck(checks, diagnostics, contract.environment.runtimes);

  // Check 2: one `runtime-other-<name>` row per non-`node` declared runtime.
  pushRuntimeOtherChecks(checks, diagnostics, contract.environment.runtimes);

  // Check 3: package manager (only emitted when declared).
  await pushPackageManagerCheck(
    checks,
    diagnostics,
    binary,
    repoRoot,
    contract.environment.packageManager,
  );

  // Check 4: git on PATH (required iff paths.protected is non-empty).
  const { gitAvailable } = await pushGitOnPathCheck(
    checks,
    diagnostics,
    binary,
    repoRoot,
    contract.paths.protected.length,
  );

  // Check 5: git working-tree membership (informational; warn if protected but not a repo).
  await pushGitRepositoryCheck(
    checks,
    diagnostics,
    git,
    repoRoot,
    contract.paths.protected.length,
    gitAvailable,
  );

  return finish(args, diagnostics, {
    contractPath,
    repoRoot,
    checks,
  });
}

function pushRuntimeNodeCheck(
  checks: CheckRow[],
  diagnostics: Diagnostic[],
  runtimes: readonly { readonly name: string; readonly range: string }[],
): void {
  const declared = runtimes.find((r) => r.name === "node")?.range;
  if (declared === undefined) {
    checks.push({
      check: "runtime-node",
      status: "warn",
      detected: process.version,
      summary: "doctor has no declared node range to compare against.",
    });
    return;
  }

  const satisfiesNode = semver.satisfies(process.version, declared, { includePrerelease: true });
  checks.push({
    check: "runtime-node",
    status: satisfiesNode ? "pass" : "fail",
    declared,
    detected: process.version,
    ...(satisfiesNode
      ? {}
      : {
          summary: `Detected Node ${process.version} does not satisfy declared "${declared}".`,
        }),
  });
  if (!satisfiesNode) {
    diagnostics.push({
      code: "RUNTIME_VERSION_MISMATCH",
      severity: "error",
      summary: `Declared Node range "${declared}" does not satisfy detected Node version ${process.version}.`,
      detail: `Agent-Ready was invoked with Node ${process.version}, but the contract declares environment.runtimes.node = "${declared}".`,
      field: "/environment/runtimes/node",
      remediation:
        "Install a Node version satisfying the declared range, or update the contract to match the detected Node version.",
    });
  }
}

function pushRuntimeOtherChecks(
  checks: CheckRow[],
  diagnostics: Diagnostic[],
  runtimes: readonly { readonly name: string; readonly range: string }[],
): void {
  for (const runtime of runtimes) {
    if (runtime.name === "node") continue;
    checks.push({
      check: `runtime-other-${runtime.name}`,
      status: "warn",
      declared: runtime.range,
      detected: null,
      summary: `doctor does not probe ${runtime.name} in this ADR.`,
    });
    diagnostics.push({
      code: "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED",
      severity: "warning",
      summary: `Declared runtime ${runtime.name} is not probed by doctor in this ADR.`,
      detail: `The contract declares environment.runtimes.${runtime.name} = "${runtime.range}", but doctor does not currently probe this runtime.`,
      field: `/environment/runtimes/${runtime.name}`,
      remediation:
        "Track ADR-0023 follow-ups; future ADRs may graduate additional runtimes to first-class `BinaryClient.probe` targets.",
    });
  }
}

async function pushPackageManagerCheck(
  checks: CheckRow[],
  diagnostics: Diagnostic[],
  binary: BinaryClient,
  repoRoot: string,
  packageManager: { readonly name: "npm" | "pnpm" | "yarn"; readonly version: string } | undefined,
): Promise<void> {
  if (packageManager === undefined) return;

  if (!SUPPORTED_PACKAGE_MANAGERS.includes(packageManager.name)) {
    // Schema validation should already reject an unsupported package
    // manager name (PACKAGE_MANAGER_INVALID) before reaching doctor. If we
    // somehow arrive here, surface a precise internal invariant rather
    // than silently treating it as "manager unavailable."
    diagnostics.push({
      code: "INTERNAL_INVARIANT_VIOLATION",
      severity: "error",
      summary: `Contract declares unsupported package manager "${packageManager.name}".`,
      detail:
        "Schema validation should reject this; if doctor sees it, normalization or schema validation is broken.",
      field: "/environment/packageManager",
      remediation: "Please report this as a bug in Agent-Ready.",
    });
    checks.push({
      check: "package-manager",
      status: "fail",
      declared: { name: packageManager.name, version: packageManager.version },
      detected: null,
      summary: "Contract declares an unsupported package manager.",
    });
    return;
  }

  const pmTarget = packageManager.name as BinaryTarget;
  let probeResult: Awaited<ReturnType<BinaryClient["probe"]>>;
  try {
    probeResult = await binary.probe(pmTarget, repoRoot);
  } catch (error) {
    // Probe threw for a reason other than ENOENT (e.g. binary present but
    // --version failed). Emit a precise diagnostic and an explicit fail
    // row rather than rethrowing — the CLI's contract is "emit diagnostic
    // and exit predictably," not "crash on a corrupted binary on PATH."
    const detail =
      error instanceof BinaryClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown probe error.";
    diagnostics.push({
      code: "PACKAGE_MANAGER_UNAVAILABLE",
      severity: "error",
      summary: `Declared package manager ${packageManager.name} probe failed.`,
      detail,
      field: "/environment/packageManager",
      remediation: `Investigate why \`${pmTarget} --version\` failed on this host.`,
    });
    checks.push({
      check: "package-manager",
      status: "fail",
      declared: { name: packageManager.name, version: packageManager.version },
      detected: null,
      summary: `${pmTarget} --version failed.`,
    });
    return;
  }

  if (probeResult === undefined) {
    checks.push({
      check: "package-manager",
      status: "fail",
      declared: { name: packageManager.name, version: packageManager.version },
      detected: null,
      summary: `Declared package manager ${packageManager.name} is not on PATH.`,
    });
    diagnostics.push({
      code: "PACKAGE_MANAGER_UNAVAILABLE",
      severity: "error",
      summary: `Declared package manager ${packageManager.name} is not on PATH.`,
      detail: `The contract declares environment.packageManager.name = "${packageManager.name}", but ${pmTarget} could not be resolved on PATH.`,
      field: "/environment/packageManager",
      remediation: `Install ${packageManager.name} or update environment.packageManager to match an installed manager.`,
    });
    return;
  }

  const satisfiesVersion = semver.satisfies(probeResult.version, packageManager.version, {
    includePrerelease: true,
  });
  checks.push({
    check: "package-manager",
    status: satisfiesVersion ? "pass" : "fail",
    declared: { name: packageManager.name, version: packageManager.version },
    detected: { version: probeResult.version, path: probeResult.path },
    ...(satisfiesVersion
      ? {}
      : {
          summary: `Detected ${packageManager.name} ${probeResult.version} does not satisfy declared "${packageManager.version}".`,
        }),
  });
  if (!satisfiesVersion) {
    diagnostics.push({
      code: "PACKAGE_MANAGER_VERSION_MISMATCH",
      severity: "error",
      summary: `Detected ${packageManager.name} version does not satisfy declared "${packageManager.version}".`,
      detail: `Agent-Ready probed ${pmTarget} --version and got "${probeResult.version}", but the contract declares environment.packageManager.version = "${packageManager.version}".`,
      field: "/environment/packageManager",
      remediation:
        "Update environment.packageManager.version to a range satisfied by the installed package manager, or install a version that satisfies the declared range.",
    });
  }
}

async function pushGitOnPathCheck(
  checks: CheckRow[],
  diagnostics: Diagnostic[],
  binary: BinaryClient,
  repoRoot: string,
  protectedCount: number,
): Promise<{ readonly gitAvailable: boolean }> {
  const required = protectedCount > 0;
  let probeResult: Awaited<ReturnType<BinaryClient["probe"]>>;
  try {
    probeResult = await binary.probe("git", repoRoot);
  } catch (error) {
    // The probe threw for a reason other than ENOENT (which would normally
    // resolve to `undefined`). Whatever the cause, treat as a hard failure
    // (GIT_UNAVAILABLE, exit 10) rather than papering it over.
    const detail =
      error instanceof BinaryClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown probe error.";
    diagnostics.push({
      code: "GIT_UNAVAILABLE",
      severity: "error",
      summary: "Failed to probe `git` on PATH.",
      detail,
      remediation: "Ensure `git` is installed and on PATH, then re-run `agent-ready doctor`.",
    });
    checks.push({
      check: "git-on-path",
      status: "fail",
      detected: null,
      required,
      summary: "git --version probe threw.",
    });
    return { gitAvailable: false };
  }

  if (probeResult === undefined) {
    if (required) {
      checks.push({
        check: "git-on-path",
        status: "fail",
        detected: null,
        required: true,
        summary: "paths.protected is declared but git is not on PATH.",
      });
      diagnostics.push({
        code: "GIT_REQUIRED_BUT_UNAVAILABLE",
        severity: "error",
        summary: "`paths.protected` is declared but `git` is not on PATH.",
        detail:
          "The contract declares paths.protected, but the git binary could not be resolved on PATH. `agent-ready check` (which compares paths.protected against Git changes) requires git.",
        field: "/paths/protected",
        remediation:
          "Install git, or empty paths.protected if this repository does not use protected paths.",
      });
    } else {
      checks.push({
        check: "git-on-path",
        status: "warn",
        detected: null,
        required: false,
        summary: "git is not on PATH. paths.protected is empty, so this is informational.",
      });
    }
    return { gitAvailable: false };
  }

  checks.push({
    check: "git-on-path",
    status: "pass",
    required,
    detected: { version: probeResult.version, path: probeResult.path },
  });
  return { gitAvailable: true };
}

async function pushGitRepositoryCheck(
  checks: CheckRow[],
  diagnostics: Diagnostic[],
  git: GitClient,
  repoRoot: string,
  protectedCount: number,
  gitAvailable: boolean,
): Promise<void> {
  const required = protectedCount > 0;

  let isRepo: boolean;
  try {
    isRepo = await git.isRepository(repoRoot);
  } catch (error) {
    if (error instanceof GitClientError && !gitAvailable) {
      // git is missing on PATH — already surfaced via the git-on-path
      // check; record informational warn and skip an extra diagnostic so
      // we never emit the same root cause twice.
      isRepo = false;
    } else if (error instanceof GitClientError && required) {
      diagnostics.push({
        code: "GIT_REPOSITORY_NOT_FOUND",
        severity: "error",
        summary: "Could not determine whether the working tree is inside a Git repository.",
        detail: error.message,
        remediation:
          "Ensure `git` is installed and on PATH, and that the working directory is inside a Git working tree.",
      });
      checks.push({
        check: "git-repository",
        status: "fail",
        detected: null,
        required: true,
        summary: error.message,
      });
      return;
    } else {
      throw error;
    }
  }

  if (!isRepo) {
    if (required) {
      checks.push({
        check: "git-repository",
        status: "warn",
        detected: false,
        required: true,
        summary:
          "paths.protected is declared but the repository root is not inside a Git working tree.",
      });
    } else {
      checks.push({
        check: "git-repository",
        status: "warn",
        detected: false,
        required: false,
        summary: "The working directory is not inside a Git working tree.",
      });
    }
    return;
  }

  checks.push({
    check: "git-repository",
    status: "pass",
    required,
    detected: true,
  });
}

function finish(
  args: DoctorArgs,
  diagnostics: readonly Diagnostic[],
  context?: DoctorFinishContext,
): CliOutcome {
  // ADR-0023 §"Exit codes": probe('git') throwing unexpectedly surfaces
  // as exit 10 regardless of resolveExitCode's broader mapping (which
  // currently ties GIT_UNAVAILABLE back to CONTAINER_NOT_FOUND / exit 2,
  // inherited from `agent-ready check`). Doctor escalates it so a
  // truly-broken env is distinguishable from a missing-on-PATH binary.
  const exitCode = diagnostics.some((d) => d.code === "GIT_UNAVAILABLE" && d.severity === "error")
    ? ExitCode.INTERNAL_ERROR
    : resolveExitCode(diagnostics);
  const ok = !diagnostics.some((d) => d.severity === "error");

  if (args.json) {
    const body =
      context === undefined
        ? { ok, diagnostics: renderDiagnosticsJson(diagnostics) }
        : {
            ok,
            contractPath: context.contractPath,
            repoRoot: context.repoRoot,
            checks: context.checks,
            diagnostics: renderDiagnosticsJson(diagnostics),
          };
    return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
  }

  if (context === undefined) {
    const stderr = renderDiagnosticsHuman(diagnostics);
    return { exitCode, stdout: "", stderr: stderr.length > 0 ? stderr + "\n" : "" };
  }

  const lines: string[] = [`Agent-Ready doctor - repoRoot: ${context.repoRoot}`, ""];
  for (const check of context.checks) {
    lines.push(formatCheckHuman(check));
  }

  const rowHasWarn = context.checks.some((c) => c.status === "warn");
  if (ok && !rowHasWarn && diagnostics.length === 0) {
    lines.push("", `All ${String(context.checks.length)} checks pass.`);
    return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  if (diagnostics.length > 0) {
    lines.push("", renderDiagnosticsHuman(diagnostics));
  }
  return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
}

function formatCheckHuman(check: CheckRow): string {
  const tag = `[${check.status}]`;
  switch (check.check) {
    case "runtime-node": {
      if (check.status === "warn") {
        return `  ${tag} runtime-node: ${check.summary ?? "no declared node range to compare against"}`;
      }
      // `declared` for runtime-node is always a node-range string per
      // pushRuntimeNodeCheck, but the row's type union also allows the
      // `{ name, version }` shape so the template literal must guard
      // explicitly to keep `no-base-to-string` quiet.
      const declaredStr = typeof check.declared === "string" ? check.declared : "";
      return `  ${tag} runtime-node: detected ${checkedDetectedString(check)} satisfies declared "${declaredStr}"${check.summary !== undefined ? ` (${check.summary})` : ""}`;
    }
    case "package-manager": {
      // `declared` is the `{ name, version }` shape for package-manager
      // (per pushPackageManagerCheck). Narrow to a nullable object via a
      // type guard so subsequent name/version interpolation is string-typed;
      // null is already excluded by `CheckRow.declared`'s union, so the
      // simpler `typeof === "object"` predicate is enough (checking for
      // null after the type guard would just be redundant).
      const declaredPair = typeof check.declared === "object" ? check.declared : null;
      return `  ${tag} package-manager: ${
        check.detected === null
          ? "no package manager found on PATH"
          : `detected ${checkedDetectedString(check)}`
      }${
        declaredPair !== null
          ? ` satisfies declared ${declaredPair.name}@${declaredPair.version}`
          : ""
      }${check.summary !== undefined ? ` (${check.summary})` : ""}`;
    }
    case "git-on-path":
      return `  ${tag} git-on-path: ${
        check.detected === null
          ? "git is not on PATH"
          : `detected ${checkedDetectedString(check)} on ${checkedDetectedPath(check)}`
      }${check.summary !== undefined ? ` (${check.summary})` : ""}`;
    case "git-repository":
      return `  ${tag} git-repository: cwd is ${check.detected === true ? "inside" : "not inside"} a Git working tree`;
    default: {
      const declared = typeof check.declared === "string" ? ` declared "${check.declared}"` : "";
      const detected =
        check.detected === null
          ? " (no probe)"
          : check.detected === undefined
            ? ""
            : ` detected ${checkedDetectedString(check)}`;
      return `  ${tag} ${check.check}:${declared}${detected}${check.summary !== undefined ? ` (${check.summary})` : ""}`;
    }
  }
}

function checkedDetectedString(check: CheckRow): string {
  const d = check.detected;
  if (d === undefined || d === null) return "(none)";
  if (typeof d === "string") return d;
  if (typeof d === "object") return d.version;
  return d ? "true" : "false";
}

function checkedDetectedPath(check: CheckRow): string {
  if (typeof check.detected === "object" && check.detected !== null) {
    return check.detected.path;
  }
  return "";
}
