import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const COMMAND_NAME_RE = /^[a-z][a-z0-9-]*$/;

// Matches `program\n  .command("X")` (the form `src/cli/index.ts` uses for every
// subcommand registration). It explicitly does NOT match `program.name(...)`
// — only `.command(...)` — so the top-level program entry is filtered out.
const PROGRAM_COMMAND_RE = /program\s*\n?\s*\.\s*command\(\s*['"]([a-z][a-z0-9-]*)['"]\s*\)/g;

/**
 * Reads `action.yml`'s `inputs.command.description` and extracts the
 * subcommand allowlist out of the prose. The current description shape
 * is one folded YAML scalar like:
 *
 *   `The agent-ready subcommand to run: validate, inspect, generate,
 *    check, analyze, schema, or verify.`
 *
 * — a comma-separated (Oxford-comma `,` `or` `-` ``-`-separated list**
 * anchored after `run:`. We anchor at `run:`, normalize ` or ` (with
 * surrounding spaces) to a plain `,`, then split on commas. That
 * handles both the prose with `... X, or Y.` last item and the prose
 * without — the regex chosen matches `/schemas/v1/`'s anchor logic in
 * the schema subcommand's path-resolver tests for the same reason.
 */
function loadActionAcceptedCommands(): Set<string> {
  const actionPath = join(REPO_ROOT, "action.yml");
  const raw = readFileSync(actionPath, "utf8");
  const doc = parseYaml(raw) as {
    inputs?: { command?: { description?: string } };
  };
  const description = doc.inputs?.command?.description ?? "";
  const anchor = description.indexOf("run:");
  if (anchor === -1) {
    throw new Error(
      `action.yml inputs.command.description lacks a 'run:' subcommand-list anchor.\n` +
        `Got: ${JSON.stringify(description)}\n` +
        `Update action.yml so the description keeps its current shape: ` +
        `'The agent-ready subcommand to run: <comma-separated list>.'`,
    );
  }
  const tail = description.substring(anchor + "run:".length).trim();
  const normalized = tail
    .replace(/\s+or\s+/giu, ",")
    .replace(/[.,;?!]+$/u, "")
    .trim();
  return new Set(
    normalized
      .split(/,\s*/u)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => COMMAND_NAME_RE.test(s)),
  );
}

function loadCliIndexRegisteredCommands(): Set<string> {
  const indexPath = join(REPO_ROOT, "src/cli/index.ts");
  const raw = readFileSync(indexPath, "utf8");
  const names = new Set<string>();
  for (const match of raw.matchAll(PROGRAM_COMMAND_RE)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

describe("action.yml <-> src/cli/index.ts drift guard", () => {
  it("every wired CLI subcommand is listed in action.yml's inputs.command.description", () => {
    const wired = loadCliIndexRegisteredCommands();
    const accepted = loadActionAcceptedCommands();
    const missing = [...wired].filter((c) => !accepted.has(c));
    expect(
      missing,
      `These subcommands are wired in src/cli/index.ts but not listed in action.yml's inputs.command.description: ${missing.join(", ")}. Update action.yml (description, bash accepted_subcommands variable, AND docs/specification/ci-integration.md) so the composite action supports every shipped CLI subcommand without lag.`,
    ).toEqual([]);
  });

  it("action.yml's inputs.command.description lists exactly the wired subcommands (no orphans)", () => {
    const wired = loadCliIndexRegisteredCommands();
    const accepted = loadActionAcceptedCommands();
    const orphans = [...accepted].filter((c) => !wired.has(c));
    expect(
      orphans,
      `action.yml's inputs.command.description lists subcommands that are not wired in src/cli/index.ts: ${orphans.join(", ")}. Remove them from action.yml — extend the action only when the underlying CLI subcommand is also wired, per the widen-in-the-same-PR rule documented in ci-integration.md.`,
    ).toEqual([]);
  });
});
