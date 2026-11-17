import { parseValidatedSnapshotFormat1 } from "../../discover/snapshotSchema.js";
import type { FileSystem } from "../../filesystem/types.js";
import {
  executeTwinQuery,
  isTwinQueryKind,
  normalizeTwinQueryLimit,
  type TwinQueryKind,
} from "../../twin/queryEngine.js";
import type { CliOutcome } from "./validate.js";

export interface TwinQueryArgs {
  readonly snapshot: string;
  readonly kind: string;
  readonly parameter?: string;
  readonly limit?: number;
  readonly json: boolean;
}

function fail(code: string, detail: string): CliOutcome {
  if (code.startsWith("TWIN_")) {
    return { exitCode: 1, stdout: "", stderr: `${code}: ${detail}\n` };
  }
  return { exitCode: 1, stdout: "", stderr: `${code}: ${detail}\n` };
}

/**
 * Answers bounded questions from a snapshot file only. Never reads the
 * repository tree behind the snapshot.
 */
export async function runTwinQuery(fs: FileSystem, args: TwinQueryArgs): Promise<CliOutcome> {
  if (!isTwinQueryKind(args.kind)) {
    return fail("TWIN_QUERY_UNSUPPORTED", `unknown query kind ${JSON.stringify(args.kind)}`);
  }
  const kind: TwinQueryKind = args.kind;

  let text: string;
  try {
    text = await fs.readTextFile(args.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("TWIN_SNAPSHOT_UNREADABLE", message);
  }

  const validated = parseValidatedSnapshotFormat1(text);
  if (!validated.ok) {
    return fail(validated.code, validated.detail);
  }

  const limit = normalizeTwinQueryLimit(args.limit);
  const outcome = executeTwinQuery(validated.document, {
    kind,
    ...(args.parameter !== undefined && { parameter: args.parameter }),
    limit,
  });

  if ("code" in outcome) {
    return fail(outcome.code, outcome.detail);
  }

  if (args.json) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(outcome, null, 2)}\n`,
      stderr: "",
    };
  }

  const lines = [
    `Query: ${outcome.kind}${outcome.parameter === null ? "" : ` ${outcome.parameter}`}`,
    outcome.truncated ? "(truncated)" : "",
    JSON.stringify(outcome.result, null, 2),
  ].filter((line) => line.length > 0);
  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
