/**
 * Regenerates the canonical `discover --json` fixture and the human-output
 * fixture in `discoverCommand.test.ts` from the implementation.
 *
 * The prompt for Issue #37 is explicit that the JSON fixture must be *generated*
 * rather than approximated by hand, and the reason is worth keeping: a fixture
 * written by hand from an imagined output is a test of the imagination. A
 * fixture pasted from real output pins the real thing, including the parts that
 * are uglier than expected.
 *
 * Run with: pnpm exec tsx scripts/regenerate-discover-fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDiscover } from "../src/cli/commands/discover.js";
import { InMemoryFileSystem } from "../src/filesystem/inMemoryFileSystem.js";

function fixtureRepo(): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  fs.addFile("/repo/AGENTS.md", "# agents\n");
  fs.addFile("/repo/.github/copilot-instructions.md", "# ci\n");
  fs.addDirectory("/repo/.git");
  return fs;
}

const json = await runDiscover(fixtureRepo(), { json: true, root: "/repo" });
if (json.exitCode !== 0) {
  throw new Error(`expected a successful snapshot, got exit ${String(json.exitCode)}`);
}
const human = await runDiscover(fixtureRepo(), { json: false, root: "/repo" });

const target = join(process.cwd(), "tests", "unit", "discoverCommand.test.ts");
const source = readFileSync(target, "utf8");

const next = source
  .replace(
    /const EXPECTED_SNAPSHOT = `[\s\S]*?`;\n/,
    // The literal keeps its trailing newline: `runDiscover` terminates stdout
    // with one, and a fixture that dropped it would pin an output shape the
    // command does not actually produce.
    () => "const EXPECTED_SNAPSHOT = `" + json.stdout + "`;\n",
  )
  .replace(
    /expect\(outcome\.stdout\)\.toBe\(\s*\n\s*\[[\s\S]*?\n\s*\]\.join\("\\n"\)(?: \+ "\\n")?,\s*\n\s*\);/,
    () =>
      "expect(outcome.stdout).toBe(\n      [\n" +
      human.stdout
        .replace(/\n$/, "")
        .split("\n")
        .map((line) => `        ${JSON.stringify(line)},`)
        .join("\n") +
      '\n      ].join("\\n") + "\\n",\n    );',
  );

if (source.includes("const EXPECTED_SNAPSHOT") && !next.includes("const EXPECTED_SNAPSHOT")) {
  throw new Error("the JSON fixture marker could not be located in " + target);
}

if (next === source) {
  // Idempotent by design: running the generator against an already-current
  // fixture is the normal case in a clean working tree, and treating that as a
  // failure would make the script unusable as a verification step.
  //
  // The sanity check below still runs on this path, because "no change" is also
  // what a silently-failed regex produces. An unmatched pattern would leave a
  // stale fixture looking up to date, which is the one failure mode a generator
  // must not have.
  assertFixtureIsCurrent(source);
  process.stdout.write("discover fixtures already match the implementation\n");
  process.exit(0);
}
assertFixtureIsCurrent(next);
writeFileSync(target, next, "utf8");
process.stdout.write("regenerated discover fixtures\n");

/**
 * Fails when the text being written is not a #37-shaped snapshot.
 *
 * The two replacements are regexes, and a regex that stops matching produces a
 * script that reports success while changing nothing — the most expensive
 * possible failure for a tool whose entire purpose is to keep a fixture
 * honest. An earlier version of this guard compared a magic fact count, which
 * went stale the moment the vocabulary grew and then guarded nothing at all.
 *
 * So the check is on the thing that matters: the fixture must actually contain
 * the snapshot the implementation produces, including the package, workspace, and
 * command facts that distinguish it from the pre-#37 four-fact output.
 */
function assertFixtureIsCurrent(text: string): void {
  const required = [
    "repository.root",
    "repository.packages",
    "repository.workspace.declarations",
    "repository.workspace.members",
    "repository.packageManager.root",
    "repository.commands",
    "repository.verificationEntrypoints",
    "repository.contract.verification",
    '"snapshotVersion": 0',
  ];
  const missing = required.filter((marker) => !text.includes(marker));
  if (missing.length > 0) {
    throw new Error(
      "the discover fixture does not look like a snapshot this implementation produces; " +
        `missing: ${missing.join(", ")}. A replacement in this script probably stopped matching, ` +
        "so it would report success while leaving a stale fixture behind.",
    );
  }
}
