import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type {
  Condition,
  ProtocolBundle,
  ProtocolManifest,
  RepositoryPin,
  TaskDefinition,
} from "./types.js";

export const DEFAULT_PROTOCOL_DIR = fileURLToPath(
  new URL("../../../docs/research/phase1-benchmark-protocol/v1/", import.meta.url),
);

export const CONDITIONS: readonly Condition[] = ["raw", "agent-ready"];

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

/**
 * Loads protocol v1 as a typed bundle. The frozen validator is the authority
 * for field-level invariants; this loader checks only that the files describe
 * the version and cardinality the harness is built to execute.
 */
export async function loadProtocol(protocolDir = DEFAULT_PROTOCOL_DIR): Promise<ProtocolBundle> {
  const manifest = (await readJson(join(protocolDir, "manifest.json"))) as ProtocolManifest;
  const repositorySet = (await readJson(join(protocolDir, "repositories.json"))) as {
    readonly repositories: readonly RepositoryPin[];
  };
  const taskSet = (await readJson(join(protocolDir, "tasks.json"))) as {
    readonly tasks: readonly TaskDefinition[];
  };

  const manifestVersion: unknown = manifest.protocolVersion;
  if (manifestVersion !== 1) {
    throw new Error(`unsupported protocol version: ${String(manifestVersion)}`);
  }
  if (repositorySet.repositories.length !== 5) {
    throw new Error(
      `protocol v1 must contain exactly 5 repositories, got ${String(repositorySet.repositories.length)}`,
    );
  }
  if (taskSet.tasks.length !== 13) {
    throw new Error(
      `protocol v1 must contain exactly 13 tasks, got ${String(taskSet.tasks.length)}`,
    );
  }

  return {
    manifest,
    repositories: repositorySet.repositories,
    tasks: taskSet.tasks,
  };
}

export function taskById(protocol: ProtocolBundle, taskId: string): TaskDefinition {
  const task = protocol.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) {
    throw new Error(`no protocol task with id ${JSON.stringify(taskId)}`);
  }
  return task;
}

export function repositoryById(protocol: ProtocolBundle, repositoryId: string): RepositoryPin {
  const repository = protocol.repositories.find((candidate) => candidate.id === repositoryId);
  if (repository === undefined) {
    throw new Error(`no protocol repository with id ${JSON.stringify(repositoryId)}`);
  }
  return repository;
}
