import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { ExitCode } from "../../diagnostics/exitCodes.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import type { CliOutcome } from "./validate.js";

/**
 * Path to the bundled JSON Schema expressed relative to *this* compiled
 * file. The source tree (`src/cli/commands/schema.ts`) and the built
 * `dist/cli/commands/schema.js` are both three directory levels away
 * from the repository root, so a single relative path works for both.
 */
const RELATIVE_BUNDLED_SCHEMA_PATH = "../../../schemas/v1/agent-ready.schema.json";

function defaultBundledSchemaPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), RELATIVE_BUNDLED_SCHEMA_PATH);
}

export interface SchemaArgs {
  readonly json: boolean;
  /** Include the parsed schema body, not just metadata. */
  readonly content: boolean;
}

export interface RunSchemaOptions {
  /**
   * Override the bundled-schema path. Production callers (the CLI) leave
   * this unset so production runs always read the package's own bundled
   * schema; tests pass a fixture path for determinism. Never a CLI flag.
   */
  readonly schemaPath?: string;
}

/**
 * Prints the bundled Agent-Ready contract JSON Schema and its version
 * metadata. Read-only: never modifies the repository, never executes
 * contract commands, never invokes Git, and does not require the
 * caller's working directory to contain an `agent-ready.yaml`.
 *
 * See ADR-0022 for the full design rationale.
 */
export async function runSchema(
  args: SchemaArgs,
  options: RunSchemaOptions = {},
): Promise<CliOutcome> {
  const schemaPath = options.schemaPath ?? defaultBundledSchemaPath();

  let raw: string;
  try {
    raw = await readFile(schemaPath, "utf8");
  } catch (cause) {
    return internalInvariant(args, schemaPath, {
      summary: "Bundled Agent-Ready schema file could not be read.",
      detail: extractErrorMessage(cause),
      remediation:
        "This is an internal Agent-Ready error: the bundled schema should always exist alongside the installed CLI. Please report this as a bug.",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return internalInvariant(args, schemaPath, {
      summary: "Bundled Agent-Ready schema is not valid JSON.",
      detail: extractErrorMessage(cause),
      remediation:
        "This is an internal Agent-Ready error: the bundled schema should always be valid JSON. Please report this as a bug.",
    });
  }

  if (!isJsonObject(parsed)) {
    return internalInvariant(args, schemaPath, {
      summary: "Bundled Agent-Ready schema is not a JSON object.",
      detail: "The bundle parsed as valid JSON but the top-level value was not a JSON object.",
      remediation:
        "This is an internal Agent-Ready error: the bundled schema should always be a JSON object. Please report this as a bug.",
    });
  }

  return render(args, parsed, schemaPath, raw);
}

interface SchemaMetadata {
  readonly schemaPath: string;
  readonly contractVersion: number;
  readonly draft?: string;
  readonly id?: string;
  readonly title?: string;
  readonly byteCount: number;
}

function render(
  args: SchemaArgs,
  schema: Record<string, unknown>,
  schemaPath: string,
  raw: string,
): CliOutcome {
  const metadata = collectMetadata(schema, schemaPath, raw);

  if (args.json) {
    const body: Record<string, unknown> = { ok: true, ...metadata, diagnostics: [] };
    if (args.content) body["schema"] = schema;
    return {
      exitCode: ExitCode.SUCCESS,
      stdout: JSON.stringify(body, null, 2) + "\n",
      stderr: "",
    };
  }

  const lines: string[] = [
    "Agent-Ready contract JSON Schema (bundled with this CLI).",
    `  contract version: ${String(metadata.contractVersion)}`,
    `  path: ${schemaPath}`,
    `  bytes: ${String(metadata.byteCount)}`,
  ];
  if (metadata.draft !== undefined) lines.push(`  JSON Schema $schema: ${metadata.draft}`);
  if (metadata.id !== undefined) lines.push(`  JSON Schema $id: ${metadata.id}`);
  if (metadata.title !== undefined) lines.push(`  title: ${metadata.title}`);

  let stdout = lines.join("\n") + "\n";
  if (args.content) stdout += "\n" + JSON.stringify(schema, null, 2) + "\n";
  return { exitCode: ExitCode.SUCCESS, stdout, stderr: "" };
}

function collectMetadata(
  schema: Record<string, unknown>,
  schemaPath: string,
  raw: string,
): SchemaMetadata {
  const metadata: {
    schemaPath: string;
    contractVersion: number;
    draft?: string;
    id?: string;
    title?: string;
    byteCount: number;
  } = {
    schemaPath,
    contractVersion: inferContractVersion(schemaPath),
    byteCount: Buffer.byteLength(raw, "utf8"),
  };
  if (typeof schema["$schema"] === "string") metadata.draft = schema["$schema"];
  if (typeof schema["$id"] === "string") metadata.id = schema["$id"];
  if (typeof schema["title"] === "string") metadata.title = schema["title"];
  return metadata;
}

/**
 * Derive the contract version from the bundled schema's path. Defensive
 * parser: not every conceivable installation shape has a `/schemas/vN/`
 * segment, so non-matching paths fall back to `1` (the version this
 * build supports). If a future Phase adds `schemas/v2/...`, the same
 * regex continues to work with no code change.
 */
function inferContractVersion(schemaPath: string): number {
  // Tolerate either forward slash or platform backslash so the same
  // matcher works on Linux/macOS and on Windows (where `path.resolve`
  // returns backslash-separated strings). The match anchors against
  // either separator on both sides of `v<N>`.
  const match = /schemas[/\\]v(\d+)[/\\]/.exec(schemaPath);
  if (match === null) return 1;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractErrorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function internalInvariant(
  args: SchemaArgs,
  schemaPath: string,
  body: { summary: string; detail: string; remediation: string },
): CliOutcome {
  const diagnostic: Diagnostic = {
    code: "INTERNAL_INVARIANT_VIOLATION",
    severity: "error",
    summary: body.summary,
    detail: body.detail,
    remediation: body.remediation,
    metadata: { schemaPath },
  };
  if (args.json) {
    return {
      exitCode: ExitCode.INTERNAL_ERROR,
      stdout: JSON.stringify({ ok: false, schemaPath, diagnostics: [diagnostic] }, null, 2) + "\n",
      stderr: "",
    };
  }
  return {
    exitCode: ExitCode.INTERNAL_ERROR,
    stdout: "",
    stderr: renderDiagnosticsHuman([diagnostic]) + "\n",
  };
}
