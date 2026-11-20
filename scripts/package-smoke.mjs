import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// cmd.exe needs its own quoting; POSIX takes the argument vector directly.
function quoteForCmd(value) {
  return /[\s"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function npmCommand(args) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `npm ${args.map(quoteForCmd).join(" ")}`],
    };
  }
  return { executable: "npm", args };
}

function failureDetail(result) {
  const parts = [result.stderr, result.stdout, result.error?.message];
  const text = parts.find((part) => typeof part === "string" && part.trim().length > 0);
  return text === undefined ? "unknown error" : text.trim();
}

function runNpm(args, cwd) {
  const command = npmCommand(args);
  const result = spawnSync(command.executable, command.args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed:\n${failureDetail(result)}`);
  }
  return result.stdout;
}

// One temp root holds the packed tarball, the consumer install and the fixture
// repository, so cleanup is a single removal even when an assertion throws.
const workspace = mkdtempSync(join(tmpdir(), "agent-ready-package-smoke-"));
const packDirectory = join(workspace, "pack");
const consumerDirectory = join(workspace, "consumer");
const fixture = join(workspace, "fixture");

try {
  mkdirSync(packDirectory);
  mkdirSync(consumerDirectory);
  mkdirSync(fixture);

  // Pack once: the tarball is the artifact this check and npm publish ship, so
  // its file list and its installed behaviour are both verified.
  const packed = JSON.parse(
    runNpm(["pack", "--json", "--pack-destination", packDirectory], root),
  )[0];
  const tarball = join(packDirectory, packed.filename);
  const packagedPaths = new Set(packed.files.map((file) => file.path));

  const manifest = JSON.parse(
    readFileSync(join(root, "compatibility/adapter-output/v1/manifest.json"), "utf8"),
  );
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

  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      { name: "agent-ready-package-smoke-consumer", version: "0.0.0", private: true },
      null,
      2,
    )}\n`,
  );

  // `--omit=dev` is the point of this check. Anything the CLI imports at
  // runtime must be declared in `dependencies`; a dev-only import passes a
  // repo-root smoke test (the repo's node_modules hides it) and fails here.
  runNpm(
    [
      "install",
      tarball,
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    consumerDirectory,
  );

  const installedDirectory = join(
    consumerDirectory,
    "node_modules",
    "@adameddahmouni",
    "agent-ready",
  );
  const installedPackage = JSON.parse(
    readFileSync(join(installedDirectory, "package.json"), "utf8"),
  );
  if (installedPackage.version !== packageJson.version) {
    throw new Error(
      `Installed package version ${String(installedPackage.version)} does not match ${packageJson.version}`,
    );
  }
  const binRelative = installedPackage.bin?.["agent-ready"];
  if (typeof binRelative !== "string") {
    throw new Error("Installed package does not declare the agent-ready bin entry.");
  }
  const binPath = join(installedDirectory, binRelative);

  // Everything below runs the installed package against a temporary repository
  // from an unrelated cwd, exactly as a consumer would.
  function runInstalled(args) {
    const result = spawnSync(process.execPath, [binPath, ...args], {
      cwd: fixture,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`agent-ready ${args.join(" ")} failed:\n${failureDetail(result)}`);
    }
    return result.stdout;
  }

  const version = runInstalled(["--version"]).trim();
  if (version !== packageJson.version) {
    throw new Error(`Installed CLI reported version ${version}, expected ${packageJson.version}`);
  }

  writeFileSync(
    join(fixture, "package.json"),
    `${JSON.stringify({ name: "package-smoke-fixture", version: "0.0.0", scripts: { test: "vitest run" } }, null, 2)}\n`,
  );
  mkdirSync(join(fixture, "src"));
  writeFileSync(join(fixture, "src/index.ts"), "export const value = 1;\n");
  copyFileSync(
    resolve(root, "examples/minimal/agent-ready.yaml"),
    join(fixture, "agent-ready.yaml"),
  );

  runInstalled(["validate", "--config", "agent-ready.yaml"]);

  // The discovery surface (`discover`, `twin build`, `twin query`) ships with
  // the next release, so the package gate proves it from the installed
  // artifact rather than only checking the v1 commands. The fixture is
  // deliberately tiny: this checks wiring and determinism, not discovery
  // coverage, which the conformance corpus and Vitest already own.
  const discoverArgs = ["discover", "--json"];
  const discovered = runInstalled(discoverArgs);
  if (runInstalled(discoverArgs) !== discovered) {
    throw new Error("discover --json is not byte-identical across runs");
  }
  const snapshot = JSON.parse(discovered);
  if (snapshot.ok !== true || snapshot.snapshotVersion !== 1) {
    throw new Error("discover --json did not emit a Snapshot Format 1 document");
  }

  runInstalled(["twin", "build", "--output", "discovery-snapshot.json"]);
  const query = JSON.parse(
    runInstalled([
      "twin",
      "query",
      "--snapshot",
      "discovery-snapshot.json",
      "--kind",
      "summary",
      "--json",
    ]),
  );
  if (query.queryVersion !== 1 || query.kind !== "summary") {
    throw new Error("twin query did not answer from the built snapshot");
  }

  // The installed tree, not the repo, must carry the schemas and the public
  // API: consumers import these paths from the package directory.
  const api = await import(pathToFileURL(join(installedDirectory, "dist/index.js")).href);
  if (typeof api.loadContract !== "function" || typeof api.NodeCommandRunner !== "function") {
    throw new Error("Installed public API is missing expected exports.");
  }

  JSON.parse(readFileSync(join(installedDirectory, "schemas/v1/agent-ready.schema.json"), "utf8"));
  JSON.parse(
    readFileSync(join(installedDirectory, "schemas/discovery/snapshot-v1.schema.json"), "utf8"),
  );

  console.log("Package smoke test passed (production-only install).");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
