import type { DiscoveryProbe, DiscoveryProbeContext, ProbeResult } from "../probe.js";
import { parseJsonObject, safeRead, safeStat } from "../read.js";

const PACKAGE_JSON = "package.json";

/**
 * The package manager named by `package.json`'s `packageManager` field.
 *
 * This is a *declaration*: the repository states it, so the fact is
 * `declared` and cites the exact field. The value is the manager name — the
 * specification is stripped rather than guessed at, and an unrecognised shape
 * yields no claim instead of a best guess.
 */
export const packageJsonPackageManagerProbe: DiscoveryProbe = {
  id: "package-manager.package-json",
  factId: "repository.packageManager",
  kind: "declared",
  shape: "value",
  async run(context: DiscoveryProbeContext) {
    const read = await safeRead(context, PACKAGE_JSON);
    if (read.status === "absent") {
      return {
        status: "not-found",
        evidence: [{ source: PACKAGE_JSON, detail: "not present" }],
      };
    }
    if (read.status === "failed") {
      return {
        status: "failed",
        detail: read.detail,
        evidence: [{ source: PACKAGE_JSON, detail: "could not be read" }],
      };
    }

    const parsed = parseJsonObject(read.content);
    if (!parsed.ok) {
      // The file exists but cannot be interpreted. That is a failed probe,
      // not evidence that the repository declares no package manager.
      return {
        status: "failed",
        detail: `${PACKAGE_JSON} could not be parsed: ${parsed.detail}`,
        evidence: [{ source: PACKAGE_JSON, detail: "present but not parseable as JSON" }],
      };
    }

    const declared = parsed.value["packageManager"];
    if (typeof declared !== "string" || declared.length === 0) {
      return {
        status: "not-found",
        evidence: [
          {
            source: PACKAGE_JSON,
            pointer: "/packageManager",
            detail: "no packageManager string is declared",
          },
        ],
      };
    }
    return {
      status: "found",
      value: managerNameOf(declared),
      evidence: [
        {
          source: PACKAGE_JSON,
          pointer: "/packageManager",
          detail: `declared as "${declared}"`,
        },
      ],
    };
  },
};

/**
 * Each lockfile is its own probe reporting the same conceptual fact.
 *
 * Keeping them separate is what makes a contradiction representable: a
 * repository containing both `pnpm-lock.yaml` and `package-lock.json` yields
 * two claims for one fact id, which merge into a conflicted fact that keeps
 * both claims and has no value. Nothing here ranks lockfiles by convention
 * or recency, and no result is a verdict about which manager the project uses.
 */
interface LockfileSignal {
  readonly probeId: string;
  readonly lockfile: string;
  readonly manager: string;
}

const LOCKFILE_SIGNALS: readonly LockfileSignal[] = [
  { probeId: "package-manager.lockfile.npm", lockfile: "package-lock.json", manager: "npm" },
  { probeId: "package-manager.lockfile.pnpm", lockfile: "pnpm-lock.yaml", manager: "pnpm" },
  { probeId: "package-manager.lockfile.yarn", lockfile: "yarn.lock", manager: "yarn" },
];

export const lockfilePackageManagerProbes: readonly DiscoveryProbe[] = LOCKFILE_SIGNALS.map(
  (signal): DiscoveryProbe => ({
    id: signal.probeId,
    factId: "repository.packageManager",
    kind: "derived",
    shape: "value",
    async run(context: DiscoveryProbeContext): Promise<ProbeResult> {
      const stat = await safeStat(context, signal.lockfile);
      switch (stat.status) {
        case "present":
          if (!stat.isFile) {
            return {
              status: "not-found",
              evidence: [{ source: signal.lockfile, detail: "present but not a regular file" }],
            };
          }
          return {
            status: "found",
            value: signal.manager,
            evidence: [
              { source: signal.lockfile, detail: `a ${signal.manager} lockfile is present` },
            ],
          };
        case "absent":
          return {
            status: "not-found",
            evidence: [{ source: signal.lockfile, detail: "not present" }],
          };
        case "failed":
          return {
            status: "failed",
            detail: stat.detail,
            evidence: [{ source: signal.lockfile, detail: "could not be inspected" }],
          };
        default:
          return { status: "unsupported", detail: "the lockfile signal is out of scope" };
      }
    },
  }),
);

/**
 * `"pnpm@10.0.0"` names the manager `pnpm`; `"pnpm"` names it `pnpm`. Nothing
 * is validated or upgraded here — if the string has no recognisable shape, it
 * is reported verbatim rather than being repaired.
 */
function managerNameOf(declared: string): string {
  const separator = declared.lastIndexOf("@");
  if (separator > 0) {
    return declared.slice(0, separator);
  }
  return declared;
}
