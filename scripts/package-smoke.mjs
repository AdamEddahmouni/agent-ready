import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @typedef {{ path: string }} PackedFile */
/** @typedef {{ files: PackedFile[] }} PackResult */
/** @typedef {{ source?: string }} CorpusInput */
/** @typedef {{ fixture: string }} CorpusOutput */
/** @typedef {{ contract: string, files: CorpusInput[], outputs: CorpusOutput[] }} CorpusCase */
/** @typedef {{ cases: CorpusCase[] }} CorpusManifest */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} text */
function parseJson(text) {
  return /** @type {unknown} */ (JSON.parse(text));
}

/** @param {string} specifier */
function importUnknown(specifier) {
  return /** @type {Promise<unknown>} */ (import(specifier));
}

const packageJson = /** @type {{ version: string }} */ (
  parseJson(await readFile(resolve(root, "package.json"), "utf8"))
);

const packCommand =
  process.platform === "win32"
    ? {
        executable: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", "npm pack --dry-run --json"],
      }
    : { executable: "npm", args: ["pack", "--dry-run", "--json"] };
const packed = spawnSync(packCommand.executable, packCommand.args, {
  cwd: root,
  encoding: "utf8",
});
if (packed.status !== 0) {
  throw new Error(`npm pack --dry-run failed:\n${packed.error?.message ?? packed.stderr}`);
}

const packResult = /** @type {PackResult[]} */ (parseJson(packed.stdout));
const packagedPaths = new Set(packResult[0].files.map((file) => file.path));
const requiredPaths = [
  "dist/cli/index.js",
  "dist/index.js",
  "dist/index.d.ts",
  "schemas/v1/agent-ready.schema.json",
  "schemas/discovery/snapshot-v1.schema.json",
  "compatibility/adapter-output/v1/manifest.json",
  "README.md",
  "LICENSE",
];
const manifest = /** @type {CorpusManifest} */ (
  parseJson(await readFile(resolve(root, "compatibility/adapter-output/v1/manifest.json"), "utf8"))
);
for (const corpusCase of manifest.cases) {
  requiredPaths.push(`compatibility/adapter-output/v1/${corpusCase.contract}`);
  for (const input of corpusCase.files) {
    if (input.source !== undefined) {
      requiredPaths.push(`compatibility/adapter-output/v1/${input.source}`);
    }
  }
  for (const output of corpusCase.outputs) {
    requiredPaths.push(`compatibility/adapter-output/v1/${output.fixture}`);
  }
}

for (const required of requiredPaths) {
  if (!packagedPaths.has(required)) {
    throw new Error(`Package is missing required file: ${required}`);
  }
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
function runCli(args, cwd = root) {
  const result = spawnSync(process.execPath, [resolve(root, "dist/cli/index.js"), ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `CLI ${args.join(" ")} failed:\n${result.error?.message ?? (result.stderr.trim() || result.stdout)}`,
    );
  }
  return result.stdout;
}

const cli = spawnSync(process.execPath, [resolve(root, "dist/cli/index.js"), "--version"], {
  cwd: root,
  encoding: "utf8",
});
if (cli.status !== 0 || cli.stdout.trim() !== packageJson.version) {
  throw new Error(`CLI version smoke test failed: ${cli.stderr || cli.stdout}`);
}

// The discovery surface (`discover`, `twin build`, `twin query`) ships with the
// next release, so the package gate proves it from the built artifact rather
// than only checking the v1 commands. The fixture is deliberately tiny: this
// checks wiring and determinism, not discovery coverage, which the conformance
// corpus and Vitest already own.
const fixture = mkdtempSync(join(tmpdir(), "agent-ready-package-smoke-"));
try {
  writeFileSync(
    join(fixture, "package.json"),
    `${JSON.stringify({ name: "package-smoke-fixture", version: "0.0.0", scripts: { test: "vitest run" } }, null, 2)}\n`,
  );
  mkdirSync(join(fixture, "src"));
  writeFileSync(join(fixture, "src/index.ts"), "export const value = 1;\n");

  // Run from the fixture, not the package root: an installed CLI is invoked
  // from the consumer's project. Bundled schemas must resolve beside `dist/`,
  // not from `process.cwd()`.
  const discoverArgs = ["discover", "--root", fixture, "--json"];
  const discovered = runCli(discoverArgs, fixture);
  if (runCli(discoverArgs, fixture) !== discovered) {
    throw new Error("discover --json is not byte-identical across runs");
  }
  const snapshot = /** @type {{ ok?: unknown, snapshotVersion?: unknown }} */ (
    parseJson(discovered)
  );
  if (snapshot.ok !== true || snapshot.snapshotVersion !== 1) {
    throw new Error("discover --json did not emit a Snapshot Format 1 document");
  }

  const snapshotPath = join(fixture, "discovery-snapshot.json");
  runCli(["twin", "build", "--root", fixture, "--output", snapshotPath], fixture);
  const query = /** @type {{ kind?: unknown, queryVersion?: unknown }} */ (
    parseJson(
      runCli(["twin", "query", "--snapshot", snapshotPath, "--kind", "summary", "--json"], fixture),
    )
  );
  if (query.queryVersion !== 1 || query.kind !== "summary") {
    throw new Error("twin query did not answer from the built snapshot");
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

const api = /** @type {{ loadContract?: unknown, NodeCommandRunner?: unknown }} */ (
  await importUnknown(pathToFileURL(resolve(root, "dist/index.js")).href)
);
if (typeof api.loadContract !== "function" || typeof api.NodeCommandRunner !== "function") {
  throw new Error("Built public API is missing expected exports.");
}

parseJson(await readFile(resolve(root, "schemas/v1/agent-ready.schema.json"), "utf8"));
parseJson(await readFile(resolve(root, "schemas/discovery/snapshot-v1.schema.json"), "utf8"));
console.log("Package smoke test passed.");
