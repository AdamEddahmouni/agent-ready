import { FileSystemError } from "../filesystem/types.js";
import type { FileSystem } from "../filesystem/types.js";
import type { DiagnosticResult } from "../diagnostics/types.js";
import { fail, ok } from "../diagnostics/types.js";

export const MAX_HANDOFF_BYTES = 64 * 1024;
export const MAX_HANDOFF_SUMMARY_LENGTH = 2000;
export const MAX_HANDOFF_ENTRY_LENGTH = 500;
export const MAX_HANDOFF_ARRAY_ENTRIES = 100;

export interface HandoffEvidence {
  readonly version: 1;
  readonly summary: string;
  readonly filesChanged: readonly string[];
  readonly commandsRun: readonly string[];
  readonly assumptions: readonly string[];
  readonly knownIssues: readonly string[];
  readonly requiresManualReview: boolean;
}

const FIELDS = [
  "summary",
  "filesChanged",
  "commandsRun",
  "assumptions",
  "knownIssues",
  "requiresManualReview",
] as const;
const ARRAY_FIELDS = ["filesChanged", "commandsRun", "assumptions", "knownIssues"] as const;

export async function readHandoff(
  fs: FileSystem,
  path: string,
): Promise<DiagnosticResult<HandoffEvidence>> {
  try {
    const stat = await fs.stat(path);
    if (stat === undefined || !stat.isFile || stat.sizeBytes > MAX_HANDOFF_BYTES) {
      return invalid(
        path,
        stat?.sizeBytes !== undefined && stat.sizeBytes > MAX_HANDOFF_BYTES
          ? `The handoff file exceeds ${String(MAX_HANDOFF_BYTES)} bytes.`
          : "The handoff path is not a readable file.",
      );
    }
    const text = await fs.readTextFile(path);
    if (Buffer.byteLength(text, "utf8") > MAX_HANDOFF_BYTES) {
      return invalid(path, `The handoff file exceeds ${String(MAX_HANDOFF_BYTES)} bytes.`);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return invalid(path, "The handoff file is not valid JSON.");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return invalid(path, "The handoff root must be a JSON object.");
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    if (
      keys.some((key) => !FIELDS.includes(key as (typeof FIELDS)[number])) ||
      FIELDS.some((field) => !(field in object))
    ) {
      return invalid(path, "The handoff object must contain exactly the documented fields.");
    }
    if (
      typeof object["summary"] !== "string" ||
      typeof object["requiresManualReview"] !== "boolean"
    ) {
      return invalid(path, "summary must be a string and requiresManualReview must be a boolean.");
    }
    for (const field of ARRAY_FIELDS) {
      const entries = object[field];
      if (
        !Array.isArray(entries) ||
        entries.length > MAX_HANDOFF_ARRAY_ENTRIES ||
        entries.some((entry) => typeof entry !== "string")
      ) {
        return invalid(
          path,
          `${field} must be an array of at most ${String(MAX_HANDOFF_ARRAY_ENTRIES)} strings.`,
        );
      }
    }
    if (characterLength(object["summary"]) > MAX_HANDOFF_SUMMARY_LENGTH)
      return tooLong(path, "summary");
    for (const field of ARRAY_FIELDS) {
      if (
        (object[field] as string[]).some(
          (entry) => characterLength(entry) > MAX_HANDOFF_ENTRY_LENGTH,
        )
      ) {
        return tooLong(path, field);
      }
    }
    return ok({
      version: 1,
      summary: object["summary"],
      filesChanged: object["filesChanged"] as string[],
      commandsRun: object["commandsRun"] as string[],
      assumptions: object["assumptions"] as string[],
      knownIssues: object["knownIssues"] as string[],
      requiresManualReview: object["requiresManualReview"],
    });
  } catch (error) {
    return invalid(
      path,
      error instanceof FileSystemError ? error.message : "The handoff file could not be read.",
    );
  }
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function invalid(path: string, detail: string): DiagnosticResult<HandoffEvidence> {
  return fail([
    {
      code: "HANDOFF_FILE_INVALID",
      severity: "error",
      summary: "The handoff file is invalid.",
      detail,
      sourcePath: path,
      remediation: "Provide a readable JSON handoff object with only the required fields.",
    },
  ]);
}
function tooLong(path: string, field: string): DiagnosticResult<HandoffEvidence> {
  return fail([
    {
      code: "HANDOFF_FIELD_TOO_LONG",
      severity: "error",
      summary: `Handoff field "${field}" exceeds its length limit.`,
      sourcePath: path,
      field: `/${field}`,
      remediation: "Shorten the field and re-run verification.",
    },
  ]);
}
