import { mkdirSync, renameSync, unlinkSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runDiscover } from "./discover.js";
import { parseValidatedSnapshotFormat1 } from "../../discover/snapshotSchema.js";
import type { FileSystem } from "../../filesystem/types.js";
import type { CliOutcome } from "./validate.js";

export interface TwinBuildArgs {
  readonly output: string;
  readonly root?: string;
  readonly force: boolean;
}

function diagnostic(code: string, detail: string): CliOutcome {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${code}: ${detail}\n`,
  };
}

/**
 * Writes a validated Discovery Snapshot Format 1 document to an explicit path.
 * Discovery is read-only; the write happens only here at the CLI boundary.
 */
export async function runTwinBuild(fs: FileSystem, args: TwinBuildArgs): Promise<CliOutcome> {
  const outputPath = resolve(args.output);
  if (existsSync(outputPath)) {
    const stat = statSync(outputPath);
    if (!stat.isFile()) {
      return diagnostic("TWIN_BUILD_OUTPUT_NOT_FILE", outputPath);
    }
    if (!args.force) {
      return diagnostic(
        "TWIN_BUILD_EXISTS",
        `refusing to overwrite ${outputPath}; pass --force to replace it`,
      );
    }
  }

  const outcome = await runDiscover(fs, {
    json: true,
    ...(args.root !== undefined && { root: args.root }),
  });
  if (outcome.stderr.length > 0) {
    return { exitCode: outcome.exitCode, stdout: "", stderr: outcome.stderr };
  }
  const validated = parseValidatedSnapshotFormat1(outcome.stdout);
  if (!validated.ok) {
    return diagnostic(validated.code, validated.detail);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${String(process.pid)}`;
  try {
    writeFileSync(temporary, outcome.stdout, "utf8");
    renameSync(temporary, outputPath);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* ignore */
    }
    const message = error instanceof Error ? error.message : String(error);
    return diagnostic("TWIN_BUILD_WRITE_FAILED", message);
  }

  return { exitCode: 0, stdout: `${outputPath}\n`, stderr: "" };
}
