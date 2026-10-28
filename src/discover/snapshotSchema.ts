import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { DISCOVERY_SNAPSHOT_VERSION } from "./types.js";

const SCHEMA_PATH = "schemas/discovery/snapshot-v1.schema.json";

let compiled: ValidateFunction | undefined;

/** Loads and compiles the published Discovery Snapshot Format 1 schema once. */
export function snapshotFormat1Validator(): ValidateFunction {
  if (compiled === undefined) {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    compiled = ajv.compile(schema);
  }
  return compiled;
}

export interface SnapshotValidationFailure {
  readonly code: "TWIN_SNAPSHOT_UNSUPPORTED_VERSION" | "TWIN_SNAPSHOT_INVALID" | "TWIN_SNAPSHOT_NOT_OBJECT";
  readonly detail: string;
}

/** Parses stdout or file bytes into a validated Format 1 snapshot document. */
export function parseValidatedSnapshotFormat1(
  text: string,
): { readonly ok: true; readonly document: Record<string, unknown> } | SnapshotValidationFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { code: "TWIN_SNAPSHOT_INVALID", detail: "the snapshot is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { code: "TWIN_SNAPSHOT_NOT_OBJECT", detail: "the snapshot must be a JSON object" };
  }
  const document = parsed as Record<string, unknown>;
  if (document["ok"] !== true) {
    return {
      code: "TWIN_SNAPSHOT_INVALID",
      detail: "a discovery error envelope is not a snapshot artifact",
    };
  }
  const version = document["snapshotVersion"];
  if (version !== DISCOVERY_SNAPSHOT_VERSION) {
    return {
      code: "TWIN_SNAPSHOT_UNSUPPORTED_VERSION",
      detail: `expected snapshotVersion ${String(DISCOVERY_SNAPSHOT_VERSION)}, got ${JSON.stringify(version)}`,
    };
  }
  const validate = snapshotFormat1Validator();
  if (!validate(document)) {
    return {
      code: "TWIN_SNAPSHOT_INVALID",
      detail:
        validate.errors?.map((entry) => entry.message ?? "invalid").join("; ") ??
        "schema validation failed",
    };
  }
  return { ok: true, document };
}
