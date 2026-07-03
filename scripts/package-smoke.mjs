import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
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

const cli = spawnSync(process.execPath, [resolve(root, "dist/cli/index.js"), "--version"], {
  cwd: root,
  encoding: "utf8",
});
if (cli.status !== 0 || cli.stdout.trim() !== packageJson.version) {
  throw new Error(`CLI version smoke test failed: ${cli.stderr || cli.stdout}`);
}

const api = /** @type {{ loadContract?: unknown, NodeCommandRunner?: unknown }} */ (
  await importUnknown(pathToFileURL(resolve(root, "dist/index.js")).href)
);
if (typeof api.loadContract !== "function" || typeof api.NodeCommandRunner !== "function") {
  throw new Error("Built public API is missing expected exports.");
}

parseJson(await readFile(resolve(root, "schemas/v1/agent-ready.schema.json"), "utf8"));
console.log("Package smoke test passed.");
