/**
 * Package-manager evidence: the fixed table of artifacts that indicate a
 * manager, and the one deterministic derivation applied to a declaration.
 *
 * Everything here is a code constant rather than configuration, which is the
 * `derived` kind's requirement in ADR-0044: the rule is the same for every
 * repository and cannot be tuned per repository to produce a nicer answer.
 *
 * What this module deliberately does **not** contain:
 *
 *  - any inference from README prose, CI command text, shell scripts, or
 *    directory names. A repository called `my-pnpm-app` says nothing, and
 *    treating its name as evidence is the kind of manufactured coherence this
 *    whole issue exists to refuse;
 *  - any priority ordering between managers. There is no table of "which
 *    signal wins", because a winner is not a thing the evidence can supply.
 */

/** Root manifest, and the name of the field a declaration is read from. */
export const ROOT_MANIFEST = "package.json";
export const PACKAGE_MANAGER_FIELD = "packageManager";
export const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";

/**
 * Repository-root artifacts that indicate a package manager, each with the
 * claim it justifies.
 *
 * The claim wording is the whole point. A lockfile does not establish that the
 * repository *uses* a manager; it establishes that a manager-specific artifact
 * is present. The distinction is carried in the claim's value — the lockfile
 * path, not the manager name — so a consumer reading the JSON cannot mistake
 * an observation for a conclusion.
 *
 * `pnpm-workspace.yaml` is conspicuously absent. It is a workspace
 * declaration, not a manager signal: a repository can carry one beside a
 * `yarn.lock`, and counting it as evidence about a manager would assert
 * something the files do not jointly say.
 */
export const LOCKFILE_SIGNALS: readonly LockfileSignal[] = [
  { path: "package-lock.json", manager: "npm", detail: "an npm lockfile exists" },
  { path: "npm-shrinkwrap.json", manager: "npm", detail: "an npm shrinkwrap exists" },
  { path: "pnpm-lock.yaml", manager: "pnpm", detail: "a pnpm lockfile exists" },
  { path: "yarn.lock", manager: "yarn", detail: "a Yarn lockfile exists" },
];

export interface LockfileSignal {
  /** Repository-relative path, which is also the claim's value. */
  readonly path: string;
  readonly manager: string;
  readonly detail: string;
}

/**
 * The name of a supported lockfile, or undefined.
 *
 * A lookup, not a heuristic: an unrecognized file name contributes nothing
 * rather than being guessed at, so a repository's `bun.lockb` is `unknown` here
 * and not silently counted as npm.
 */
export function managerForLockfile(path: string): string | undefined {
  return LOCKFILE_SIGNALS.find((signal) => signal.path === path)?.manager;
}

/**
 * The manager name a `packageManager` declaration indicates.
 *
 * `pnpm@10.0.0` yields `pnpm`. That is the entire rule: the text before the
 * **first** `@`. It is a deterministic projection of a declaration the snapshot
 * retains verbatim, not a validation — Agent-Ready does not check that pnpm 10
 * exists, does not compare it to the lockfile's recorded version, and does not
 * upgrade or repair it.
 *
 * A declaration that is not a non-empty `<name>@<version>` string returns
 * undefined, and the caller reports that as unsupported rather than taking the
 * text before a separator that may not be there. `npm` is never returned as a
 * default: Node's historical package manager is a fact about Node, and
 * inferring it from the absence of a declaration would be fabricated knowledge.
 *
 * The separator is the *first* `@` and the search does not skip a leading one,
 * so `@scope/pkg@1.0.0` yields no name at all. That is deliberate, and it is the
 * stricter of the two readings. `@scope/...` is npm package-name syntax, not
 * package-manager syntax: no package manager is scoped, so accepting the string
 * would mint a manager name — `@scope/pkg` — that cannot exist, cannot match a
 * lockfile, and cannot corroborate anything. Reporting it as a known manager is
 * the fabrication this whole function exists to avoid; reporting it as
 * `unknown`/`not-probed` with `DISCOVERY_FACT_UNSUPPORTED` says precisely what
 * happened, which is that this version does not model the shape.
 */
export function managerFromDeclaration(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const separator = value.indexOf("@");
  if (separator <= 0 || separator === value.length - 1) {
    return undefined;
  }
  const name = value.slice(0, separator);
  const version = value.slice(separator + 1);
  if (name.length === 0 || version.length === 0 || /\s/.test(name) || /\s/.test(version)) {
    return undefined;
  }
  return name;
}

/**
 * Whether a manifest field value is a declaration form this implementation
 * supports. Kept separate from `managerFromDeclaration` so a probe can report
 * "the field exists but I do not model its form" — which is information — while
 * still declining to invent a manager name from it.
 */
export function isSupportedDeclarationForm(value: unknown): boolean {
  return managerFromDeclaration(value) !== undefined;
}
