/**
 * Stamps a built package with the commit it came from, so a benchmark trial can
 * refuse a `dist/` that does not match the run manifest's pin. An exported
 * source tree has no Git metadata; there the stamp is written by the benchmark's
 * own builder instead, and this script is a no-op.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

let commit;
try {
  commit = git(["rev-parse", "HEAD"]);
} catch {
  process.exit(0);
}

const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const dirty = git(["status", "--porcelain"]).length > 0;

writeFileSync(
  new URL("../.agent-ready-build.json", import.meta.url),
  `${JSON.stringify({ commit, dirty, version, builtAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);
