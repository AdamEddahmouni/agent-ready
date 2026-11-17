import { compareCodeUnits } from "../discover/ordering.js";
import type { JsonValue } from "../discover/types.js";

export const TWIN_QUERY_KINDS = [
  "summary",
  "package",
  "packages",
  "commands-for-package",
  "verification-for-package",
  "module",
  "imports-of-module",
  "importers-of-module",
  "dependencies-of-package",
  "owner-of",
  "unowned",
  "unresolved-imports",
] as const;

export type TwinQueryKind = (typeof TWIN_QUERY_KINDS)[number];

export interface TwinQueryRequest {
  readonly kind: TwinQueryKind;
  readonly parameter?: string;
  readonly limit: number;
}

export interface TwinQueryResult {
  readonly queryVersion: 1;
  readonly kind: TwinQueryKind;
  readonly parameter: string | null;
  readonly truncated: boolean;
  readonly result: JsonValue;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function normalizeTwinQueryLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export function isTwinQueryKind(value: string): value is TwinQueryKind {
  return (TWIN_QUERY_KINDS as readonly string[]).includes(value);
}

function packagesFromFacts(facts: Record<string, unknown>): JsonValue[] {
  const packages = facts["repository.packages"];
  if (typeof packages !== "object" || packages === null) return [];
  const value = (packages as Record<string, unknown>)["value"];
  // The snapshot was parsed from JSON, so every entry is already a JsonValue;
  // the cast only recovers the type that `Record<string, unknown>` erased.
  return Array.isArray(value) ? (value as JsonValue[]) : [];
}

function entryPath(entry: JsonValue): string {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "";
  const path = (entry as Record<string, JsonValue>)["path"];
  return typeof path === "string" ? path : "";
}

function objectEntries(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function factValue(facts: Record<string, unknown>, id: string): unknown {
  const fact = facts[id];
  if (typeof fact !== "object" || fact === null) return undefined;
  return (fact as Record<string, unknown>)["value"];
}

function graphNodes(document: Record<string, unknown>): Record<string, unknown>[] {
  const graph = document["graph"];
  if (typeof graph !== "object" || graph === null) return [];
  const nodes = (graph as Record<string, unknown>)["nodes"];
  return Array.isArray(nodes) ? (nodes as Record<string, unknown>[]) : [];
}

function graphEdges(document: Record<string, unknown>): Record<string, unknown>[] {
  const graph = document["graph"];
  if (typeof graph !== "object" || graph === null) return [];
  const edges = (graph as Record<string, unknown>)["edges"];
  return Array.isArray(edges) ? (edges as Record<string, unknown>[]) : [];
}

function moduleId(path: string): string {
  return path.startsWith("module:") ? path : `module:${path}`;
}

function packagePathId(path: string): string {
  return path === "." ? "package:." : `package:${path}`;
}

function truncate<T>(items: readonly T[], limit: number): { items: T[]; truncated: boolean } {
  if (items.length <= limit) return { items: [...items], truncated: false };
  return { items: items.slice(0, limit), truncated: true };
}

export function executeTwinQuery(
  document: Record<string, unknown>,
  request: TwinQueryRequest,
): TwinQueryResult | { readonly code: string; readonly detail: string } {
  const facts = document["facts"] as Record<string, unknown>;
  const kind = request.kind;
  const parameter = request.parameter ?? null;
  const limit = request.limit;

  switch (kind) {
    case "summary": {
      return {
        queryVersion: 1,
        kind,
        parameter: null,
        truncated: false,
        result: (document["summary"] ?? null) as JsonValue,
      };
    }
    case "packages": {
      const list = packagesFromFacts(facts).sort((a, b) =>
        compareCodeUnits(entryPath(a), entryPath(b)),
      );
      const { items, truncated } = truncate(list, limit);
      return { queryVersion: 1, kind, parameter: null, truncated, result: items };
    }
    case "package": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "package requires a package path (e.g. . or packages/api)",
        };
      }
      const path = parameter;
      const list = packagesFromFacts(facts);
      const found = list.find((entry) => (entry as Record<string, unknown>)["path"] === path);
      if (found === undefined) {
        return {
          code: "TWIN_QUERY_NOT_FOUND",
          detail: `no package at path ${JSON.stringify(path)}`,
        };
      }
      return { queryVersion: 1, kind, parameter: path, truncated: false, result: found };
    }
    case "commands-for-package": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "commands-for-package requires a package path",
        };
      }
      const commands = factValue(facts, "repository.commands");
      if (!Array.isArray(commands)) {
        return { code: "TWIN_QUERY_NOT_FOUND", detail: "snapshot has no command inventory" };
      }
      const entry = objectEntries(commands).find((item) => item["packagePath"] === parameter);
      if (entry === undefined) {
        return {
          code: "TWIN_QUERY_NOT_FOUND",
          detail: `no commands entry for ${JSON.stringify(parameter)}`,
        };
      }
      return { queryVersion: 1, kind, parameter, truncated: false, result: entry as JsonValue };
    }
    case "verification-for-package": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "verification-for-package requires a package path",
        };
      }
      const entrypoints = factValue(facts, "repository.verificationEntrypoints");
      if (!Array.isArray(entrypoints)) {
        return { code: "TWIN_QUERY_NOT_FOUND", detail: "snapshot has no verification entrypoints" };
      }
      const { items, truncated } = truncate(
        entrypoints.filter(
          (item) => (item as Record<string, unknown>)["packagePath"] === parameter,
        ),
        limit,
      );
      if (items.length === 0) {
        return {
          code: "TWIN_QUERY_NOT_FOUND",
          detail: `no verification entrypoints for ${JSON.stringify(parameter)}`,
        };
      }
      return { queryVersion: 1, kind, parameter, truncated, result: items as JsonValue };
    }
    case "module": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "module requires a module path (e.g. src/index.ts)",
        };
      }
      const id = moduleId(parameter);
      const node = graphNodes(document).find((entry) => entry["id"] === id);
      if (node === undefined) {
        return {
          code: "TWIN_QUERY_NOT_FOUND",
          detail: `no module ${JSON.stringify(id)} in snapshot graph`,
        };
      }
      return { queryVersion: 1, kind, parameter, truncated: false, result: node as JsonValue };
    }
    case "imports-of-module": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "imports-of-module requires a module path",
        };
      }
      const sourceId = moduleId(parameter);
      const edges = graphEdges(document).filter(
        (edge) => edge["kind"] === "imports" && edge["source"] === sourceId,
      );
      const { items, truncated } = truncate(edges, limit);
      return { queryVersion: 1, kind, parameter, truncated, result: items as JsonValue };
    }
    case "importers-of-module": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "importers-of-module requires a module path",
        };
      }
      const targetId = moduleId(parameter);
      const edges = graphEdges(document).filter((edge) => {
        if (edge["kind"] !== "imports") return false;
        return edge["target"] === targetId || edge["targetPath"] === parameter;
      });
      const { items, truncated } = truncate(edges, limit);
      return { queryVersion: 1, kind, parameter, truncated, result: items as JsonValue };
    }
    case "dependencies-of-package": {
      if (parameter === null) {
        return {
          code: "TWIN_QUERY_MISSING_PARAMETER",
          detail: "dependencies-of-package requires a package path",
        };
      }
      const sourceId = packagePathId(parameter);
      const edges = graphEdges(document).filter(
        (edge) => edge["kind"] === "package-depends-on" && edge["source"] === sourceId,
      );
      const { items, truncated } = truncate(edges, limit);
      return { queryVersion: 1, kind, parameter, truncated, result: items as JsonValue };
    }
    case "owner-of": {
      if (parameter === null) {
        return { code: "TWIN_QUERY_MISSING_PARAMETER", detail: "owner-of requires a module path" };
      }
      const id = moduleId(parameter);
      const node = graphNodes(document).find((entry) => entry["id"] === id);
      if (node === undefined) {
        return {
          code: "TWIN_QUERY_NOT_FOUND",
          detail: `no module ${JSON.stringify(id)} in snapshot graph`,
        };
      }
      const ownership = node["ownership"] as Record<string, unknown> | undefined;
      return {
        queryVersion: 1,
        kind,
        parameter,
        truncated: false,
        result: (ownership ?? { status: "unknown" }) as JsonValue,
      };
    }
    case "unowned": {
      const nodes = graphNodes(document).filter((node) => {
        const ownership = node["ownership"] as Record<string, unknown> | undefined;
        return ownership?.["status"] === "unowned";
      });
      const { items, truncated } = truncate(
        nodes.map((node) => ({ id: node["id"], path: node["path"] ?? null })),
        limit,
      );
      return { queryVersion: 1, kind, parameter: null, truncated, result: items as JsonValue };
    }
    case "unresolved-imports": {
      const edges = graphEdges(document).filter((edge) => {
        if (edge["kind"] !== "imports") return false;
        const resolution = edge["resolution"] as Record<string, unknown> | undefined;
        return resolution?.["status"] === "unresolved";
      });
      const { items, truncated } = truncate(edges, limit);
      return { queryVersion: 1, kind, parameter: null, truncated, result: items as JsonValue };
    }
    default: {
      return {
        code: "TWIN_QUERY_UNSUPPORTED",
        detail: `unsupported query kind ${JSON.stringify(kind)}`,
      };
    }
  }
}
