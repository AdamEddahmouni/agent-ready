import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes each conformance case's machine-readable metadata.
 *
 * The prose here is the part of the corpus a human reads; the expected
 * snapshots are generated separately. Every case states why it exists and, where
 * it encodes a known inaccuracy, exactly what is wrong and what would be right —
 * so that a future maintainer who sees a diff on a `known-inaccurate` case
 * learns that behaviour became MORE correct rather than that CI went red.
 */
const ROOT = "conformance/discovery/v1";

const metadata = {
  "minimal-package": {
    name: "minimal-package",
    purpose:
      "The floor of the format: one package, one agreed package manager, a lockfile that resolves, three commands, one resolved import, one dependency, and no ownership policy at all.",
    exercises: [
      "canonical repository-relative paths",
      "agreed package-manager fact with corroboration",
      "resolved dependency version citing the lockfile line",
      "command inventory with verbatim bodies",
      "verification role projection over test/build/lint",
      "ownership surface absent, every subject explicitly unowned",
    ],
    snapshotVersion: 1,
    status: "normative",
  },

  workspace: {
    name: "workspace",
    purpose:
      "A root package plus two workspace members, one of which depends on the other through the `workspace:` protocol. Exercises workspace declaration and expansion, package identity by path rather than by name, a SECOND scoped package-manager fact from a member's own lockfile, and commands nested per declaring package.",
    exercises: [
      "workspace declaration and candidate expansion",
      "package identity by path rather than by name",
      "two scoped package-manager facts, one per manifest that states one",
      "workspace dependency edge resolved to the member's package node, with targetMissing false",
      "a member dependency carries no resolved version, because only the root importer is read",
      "commands nested per declaring package",
    ],
    snapshotVersion: 1,
    status: "normative",
  },

  "package-manager-conflict": {
    name: "package-manager-conflict",
    purpose:
      "Two lockfiles beside one declaration. The snapshot must carry the DECLARED manager forward, publish the contradicting one in `contradictedBy`, retain every claim, and name no winner.",
    exercises: [
      "the incomplete epistemic shape",
      "contradictedBy is non-empty and is the discriminator",
      "no value is chosen between disagreeing sources",
      "corroboration across a declaration and an artifact",
    ],
    snapshotVersion: 1,
    status: "normative",
    inspiredBy: {
      repository: "https://github.com/less/less.js",
      commit: "713331655e437401dfea6cd233893a69762734e1",
      originalBehaviour:
        'less ships pnpm-lock.json and package-lock.json while declaring `packageManager: pnpm@9.15.9`, and the snapshot reports an incomplete fact with contradictedBy: ["npm"] and a DISCOVERY_FACT_INCOMPLETE diagnostic.',
    },
  },

  "partial-observation": {
    name: "partial-observation",
    purpose:
      "Unreadable inputs. `summary.complete` must be false, the diagnostics must say what could not be read, and the snapshot must still be a usable document rather than an error.",
    exercises: [
      "summary.complete false when nothing could be interpreted",
      "a fatal failure is a CLI error envelope, not a snapshot",
      "unknown facts rather than fabricated ones",
    ],
    snapshotVersion: 1,
    status: "normative",
  },

  "unresolved-import": {
    name: "unresolved-import",
    purpose:
      "Five import shapes at once: one that resolves to a declaration file outside the module universe, one to a JSON module this version does not resolve, one to a Node built-in, one to an external package no manifest declares, and one to a file that is not there. Every one must keep its specifier, its line, and an honest resolution.",
    exercises: [
      "resolved edge to an out-of-universe declaration file, with a real cited line",
      "platform resolution with no target node",
      "dependency node minted by an import the manifest never declared",
      "unresolved edge with a specifier, a line, and a reason",
      "a JSON module this version does not resolve stays unresolved rather than gaining a target",
    ],
    snapshotVersion: 1,
    status: "normative",
    inspiredBy: {
      repository: "https://github.com/sindresorhus/type-fest",
      commit: "e9f614f191aa039e4aefa2d41d62c2a3fd070cfd",
      originalBehaviour:
        "An import resolving to a `.d.ts` minted a module node citing line 1 of a file the run had never read. That was a `provenance-file-was-read` violation, which is error severity, which suppressed the entire graph for this repository and six others. The corpus study found it; the target is now read before it is cited.",
    },
  },

  ownership: {
    name: "ownership",
    purpose:
      "A CODEOWNERS file with a catch-all, a nested directory rule with two owners on it, an overlapping rule where last-match-wins decides, and a character-class pattern this version refuses. Owned and unowned subjects must both be present and correct.",
    exercises: [
      "owned subject with more than one owner, one edge per owner token",
      "last-match-wins on overlapping rules",
      "explicitly unowned subjects with an evaluated policy",
      "an unsupported pattern surfaced rather than approximated, with its neighbours still applying",
    ],
    snapshotVersion: 1,
    status: "normative",
  },

  "known-inaccurate-fallback-source-universe": {
    name: "known-inaccurate-fallback-source-universe",
    purpose:
      "Pins a known limitation so that fixing it cannot happen silently. A package with no `tsconfig.json` gets the deliberately blind bounded traversal, which cannot tell source from build output, so committed `dist/` enters the module universe.",
    exercises: [
      "bounded-traversal strategy is published, not inferred",
      "generated output is admitted as source — deliberately, and wrongly",
      "CommonJS require is reported as unsupported-syntax rather than resolved",
    ],
    snapshotVersion: 1,
    status: "known-inaccurate",
    knownLimitation:
      'With no `tsconfig.json`, the fallback walk excludes only `node_modules` and `.git`, because "this directory looks like build output" is a guess and a guess that silently drops files produces a graph that is quietly incomplete. The cost is that committed `dist/` and `lib/` are treated as source, so `graph.sourceUniverse.files` is not the repository\'s source and `graph.nodes` contains generated code.',
    correctFutureBehaviour:
      "A documented exclusion rule for build output, with its own decision and its own diagnostics — not a growing list of directory names that look like build output. The corpus study also found a second route to the same inaccuracy: a `tsconfig.json` that states no `files` and no `include` reproduces TypeScript's own `**/*` default and admits generated trees just as well, so a fix has to cover both.",
    inspiredBy: {
      repository: "https://github.com/lodash/lodash",
      commit: "2b5e6f7399a7b48005140b5d5c6bc6c0e62919a8",
      originalBehaviour:
        "7 of 55 modules are in `dist/`. The same inaccuracy reached webpack at e95be18b465117b38d4f260b608d4f084a500bdc through a `tsconfig.json` default include rather than the fallback walk, where 640 of 765 modules are in a committed, generated `lib/`.",
    },
  },

  "unsupported-constructs": {
    name: "unsupported-constructs",
    purpose:
      "Two things this version deliberately declines, side by side: CommonJS `require`, and an npm lockfile in a format it does not model. Both must be reported as declined, with no version guessed and no edge invented.",
    exercises: [
      "require is unsupported-syntax with the specifier and the line retained",
      "an npm lockfile format this version does not model is named, not approximated",
      "no resolved version is invented from a lockfile this version cannot read",
    ],
    snapshotVersion: 1,
    status: "unsupported",
    inspiredBy: {
      repository: "https://github.com/lodash/lodash",
      commit: "2b5e6f7399a7b48005140b5d5c6bc6c0e62919a8",
      originalBehaviour:
        'package-lock.json at lockfileVersion 1 is reported as "Lockfile format 1 is not modelled… left uninterpreted rather than approximated", and all 85 `require` calls in `lib/` are `unsupported-syntax`. express (9a34acf03cb818ff3f8bc40e44176e277a25cbb9) and webpack (e95be18b465117b38d4f260b608d4f084a500bdc) show the same for 402 and 3249 imports respectively.',
    },
  },
};

for (const [name, value] of Object.entries(metadata)) {
  const target = join(ROOT, name, "metadata.json");
  mkdirSync(join(ROOT, name), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2) + "\n", "utf8");
  console.log("wrote", name);
}
