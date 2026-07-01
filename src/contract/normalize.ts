import { normalizePathPattern } from "./paths.js";
import type {
  NormalizedCommand,
  NormalizedContract,
  NormalizedRuntime,
  RawContract,
} from "./types.js";
import { ADAPTER_NAMES } from "./types.js";

export class NormalizationError extends Error {}

/**
 * Produces the deterministic normalized contract from an already
 * schema-valid and semantically-valid RawContract. This function assumes
 * validation already succeeded; it never emits diagnostics, and throws
 * NormalizationError only if an invariant that validation should have
 * guaranteed does not hold (an internal bug, not a user error).
 *
 * Ordering policy (see docs/specification/contract-reference.md):
 *  - commands, path categories, adapters, and runtimes are unordered sets
 *    in the source format and are sorted alphabetically for stability.
 *  - verification.required and instructions.sources are ordered lists
 *    whose declared order is semantically meaningful and is preserved.
 */
export function normalizeContract(raw: RawContract): NormalizedContract {
  const commands = normalizeCommands(raw);
  const commandNames = new Set(commands.map((c) => c.name));

  const verificationRequired = raw.verification?.required ?? [];
  for (const ref of verificationRequired) {
    if (!commandNames.has(ref)) {
      throw new NormalizationError(
        `Invariant violated: verification.required references unknown command "${ref}" after validation.`,
      );
    }
  }

  return {
    version: 1,
    project: {
      name: raw.project.name,
      ...(raw.project.description !== undefined && { description: raw.project.description }),
    },
    environment: {
      runtimes: normalizeRuntimes(raw),
      ...(raw.environment?.packageManager !== undefined && {
        packageManager: raw.environment.packageManager,
      }),
    },
    commands,
    verification: {
      required: [...verificationRequired],
    },
    paths: {
      protected: normalizePatternList(raw.paths?.protected, { allowGlob: true, sort: true }),
      generated: normalizePatternList(raw.paths?.generated, { allowGlob: true, sort: true }),
      ignored: normalizePatternList(raw.paths?.ignored, { allowGlob: true, sort: true }),
    },
    instructions: {
      sources: normalizePatternList(raw.instructions?.sources, { allowGlob: false, sort: false }),
    },
    adapters: ADAPTER_NAMES.filter((name) => raw.adapters?.[name] !== undefined)
      .map((name) => ({ name, enabled: raw.adapters?.[name]?.enabled ?? false }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function normalizeCommands(raw: RawContract): NormalizedCommand[] {
  const entries = Object.entries(raw.commands ?? {});
  return entries
    .map(([name, command]) => ({
      name,
      run: command.run,
      ...(command.description !== undefined && { description: command.description }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeRuntimes(raw: RawContract): NormalizedRuntime[] {
  const entries = Object.entries(raw.environment?.runtimes ?? {});
  return entries
    .map(([name, range]) => ({ name, range }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePatternList(
  patterns: readonly string[] | undefined,
  options: { readonly allowGlob: boolean; readonly sort: boolean },
): string[] {
  if (patterns === undefined) {
    return [];
  }
  const normalized = patterns.map((pattern) => {
    const result = normalizePathPattern(pattern, "", { allowGlob: options.allowGlob });
    if ("diagnostics" in result) {
      throw new NormalizationError(
        `Invariant violated: pattern "${pattern}" failed normalization after validation.`,
      );
    }
    return result.normalized;
  });
  return options.sort ? [...normalized].sort((a, b) => a.localeCompare(b)) : normalized;
}
