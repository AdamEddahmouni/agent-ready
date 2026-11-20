import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BUILD_DIRECTORY, buildAgentReadyCli } from "./harness/agentReadyCli.js";
import { DEFAULT_RUN_MANIFEST_PATH, loadRunManifest } from "./harness/manifest.js";

/**
 * Builds the Agent-Ready CLI at the commit the run manifest pins, so a trial
 * queries through the artifact under test rather than the working tree's
 * `dist/`. The output is stamped and verified before the command reports
 * success.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const USAGE =
  "Usage: pnpm research:benchmark-build-agent-ready [--manifest <run-manifest.json>] [--out <dir>]";

async function main(): Promise<number> {
  let values: { readonly manifest?: string; readonly out?: string };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: { manifest: { type: "string" }, out: { type: "string" } },
      strict: true,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }

  const manifest = await loadRunManifest(values.manifest ?? DEFAULT_RUN_MANIFEST_PATH);
  const outputRoot =
    values.out ??
    resolve(
      REPOSITORY_ROOT,
      BUILD_DIRECTORY,
      `agent-ready-${manifest.agentReadyCommit.slice(0, 12)}`,
    );

  console.log(
    `building agent-ready ${manifest.agentReadyCommit.slice(0, 12)} into ${outputRoot} ` +
      `(dependencies from ${REPOSITORY_ROOT}/node_modules)`,
  );
  const built = await buildAgentReadyCli({
    repositoryRoot: REPOSITORY_ROOT,
    pinnedCommit: manifest.agentReadyCommit,
    outputRoot,
  });
  console.log(
    `built ${built.cliPath}: commit ${built.buildInfo.commit}, ` +
      `version ${built.buildInfo.version ?? "unknown"}, dirty ${String(built.buildInfo.dirty)}`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
