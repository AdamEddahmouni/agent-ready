/**
 * Parsing workspace declarations.
 *
 * Strictly separate from expansion: this module answers "what did the
 * repository *write*", and knows nothing about whether any of it exists. A
 * declaration of `["packages/*"]` is configuration; `["packages/a",
 * "packages/b"]` is a derivation from the file system. Keeping the two apart is
 * the difference between describing a repository and reinterpreting it.
 *
 * Only forms that are implemented and tested are named. Anything else is
 * reported as `unsupported` with a reason — never coerced into the nearest
 * shape that happens to fit. A `workspaces` field that is a bare string, a
 * number, or an array containing a non-string is a real situation in real
 * repositories, and the honest answer to it is "I do not model this", not
 * "probably one of the shapes I do model".
 */

import { parseYaml } from "../../contract/parseYaml.js";
import type { WorkspaceDeclarationEntry, WorkspaceDeclarationForm } from "../types.js";

/** The `package.json` field a workspace declaration is read from. */
export const WORKSPACES_FIELD = "workspaces";
/** The `pnpm-workspace.yaml` key a workspace declaration is read from. */
export const PNPM_PACKAGES_KEY = "packages";

/**
 * Parses the `workspaces` field of a root manifest.
 *
 * Returns `null` when the manifest simply declares no workspace, which is a
 * different state from declaring one this implementation cannot read. Reporting
 * "no `workspaces` key" as an *unsupported* declaration would put a
 * `DISCOVERY_WORKSPACE_UNSUPPORTED` on every ordinary single-package repository,
 * train a reader to ignore it, and hide the cases that matter.
 *
 * Two forms are supported, both from currently used Node tooling:
 *
 *  - the **array** form (`["packages/*"]`) used by npm and Yarn classic;
 *  - the **object** form (`{"packages": [...]}`) used by Yarn berry, whose other
 *    keys (`nohoist`, and berry's own settings) are ignored rather than
 *    interpreted.
 *
 * The array form is checked strictly: a single non-string entry makes the whole
 * declaration unsupported. Partially accepting `["packages/*", 42]` would mean
 * silently dropping an entry the author wrote, which is how a workspace ends up
 * reported as smaller than it is.
 */
export function parsePackageJsonWorkspaces(
  source: string,
  document: Record<string, unknown>,
): WorkspaceDeclarationEntry | null {
  if (!(WORKSPACES_FIELD in document)) {
    return null;
  }
  const raw: unknown = document[WORKSPACES_FIELD];

  if (Array.isArray(raw)) {
    return fromPatternList(source, "array", raw);
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (!(PNPM_PACKAGES_KEY in record)) {
      return unsupported(
        source,
        `the workspaces object has no "${PNPM_PACKAGES_KEY}" key, which is the only form supported`,
      );
    }
    const packages: unknown = record[PNPM_PACKAGES_KEY];
    if (!Array.isArray(packages)) {
      return unsupported(source, `workspaces.${PNPM_PACKAGES_KEY} is not an array`);
    }
    return fromPatternList(source, "object", packages);
  }
  return unsupported(
    source,
    `workspaces is ${describeJsonType(raw)}; only an array of strings, or an object with a "${PNPM_PACKAGES_KEY}" array, is supported`,
  );
}

/**
 * Parses a `pnpm-workspace.yaml` file.
 *
 * Uses the repository's existing safe YAML infrastructure from ADR-0003 — the
 * depth guard, the duplicate-key rejection, the alias cap, and the size cap all
 * come for free. No second YAML parser is introduced for one file.
 *
 * Only `packages:` is read. `catalog:`, `onlyBuiltDependencies:`, `patched:`, and
 * every other pnpm key are ignored: they are not workspace *membership*, and
 * interpreting them would mean modelling pnpm's configuration language rather
 * than its workspace declaration. A file with no `packages:` key therefore
 * declares no workspace and returns `null` — which is the correct reading of a
 * `pnpm-workspace.yaml` that exists only to configure something else.
 *
 * A file that cannot be parsed is a declaration *attempt* that could not be
 * read, so it is reported as unsupported with the parser's reason rather than
 * being treated as an absence. Silently reporting "no workspace here" for a file
 * full of workspace configuration that we failed to read is a false negative of
 * the most dangerous kind.
 *
 * The file is read statically. No package manager is executed, no schema is
 * consulted over a network, and no setting is validated.
 */
export function parsePnpmWorkspaceYaml(
  source: string,
  content: string,
): WorkspaceDeclarationEntry | null {
  const parsed = parseYaml(content, source);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    return unsupported(
      source,
      first === undefined
        ? "the file could not be parsed as YAML"
        : `the file is not valid YAML: ${first.detail ?? first.code}`,
    );
  }
  const root: unknown = parsed.value.value;
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return unsupported(source, "the document is not a YAML mapping");
  }
  const record = root as Record<string, unknown>;
  if (!(PNPM_PACKAGES_KEY in record)) {
    return null;
  }
  const packages: unknown = record[PNPM_PACKAGES_KEY];
  if (!Array.isArray(packages)) {
    return unsupported(
      source,
      `${PNPM_PACKAGES_KEY} is ${describeJsonType(packages)}, not an array`,
    );
  }
  return fromPatternList(source, "array", packages);
}

function fromPatternList(
  source: string,
  form: WorkspaceDeclarationForm,
  raw: readonly unknown[],
): WorkspaceDeclarationEntry {
  if (raw.length === 0) {
    return { source, form, patterns: [], unsupportedReason: null };
  }
  if (!raw.every((entry) => typeof entry === "string")) {
    return unsupported(
      source,
      "the pattern list contains a non-string entry, so the whole declaration is not understood",
    );
  }
  return {
    source,
    form,
    // Verbatim and in declaration order. Order is declared information: a `!`
    // exclusion only means something relative to the patterns around it, so
    // sorting here would change what the repository said.
    patterns: raw,
    unsupportedReason: null,
  };
}

function unsupported(source: string, reason: string): WorkspaceDeclarationEntry {
  return { source, form: "unsupported", patterns: [], unsupportedReason: reason };
}

function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
