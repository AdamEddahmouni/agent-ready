import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type {
  Condition,
  ProtocolBundle,
  ProtocolManifest,
  ProtocolVersion,
  RepositoryPin,
  TaskDefinition,
} from "./types.js";

export const PROTOCOL_VERSIONS: readonly ProtocolVersion[] = [1, 2, 3];

function protocolDir(version: ProtocolVersion): string {
  return fileURLToPath(
    new URL(
      `../../../docs/research/phase1-benchmark-protocol/v${String(version)}/`,
      import.meta.url,
    ),
  );
}

export const DEFAULT_PROTOCOL_DIR = protocolDir(1);

/** Directory of a frozen protocol version. */
export function protocolDirFor(version: ProtocolVersion): string {
  return protocolDir(version);
}

export const CONDITIONS: readonly Condition[] = ["raw", "agent-ready"];

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

/**
 * Loads one frozen protocol version as a typed bundle. The frozen validator is
 * the authority for field-level invariants; this loader checks only that the
 * files describe a supported version and the cardinality the harness executes.
 */
export async function loadProtocol(
  protocolDirectory = DEFAULT_PROTOCOL_DIR,
): Promise<ProtocolBundle> {
  const manifest = (await readJson(join(protocolDirectory, "manifest.json"))) as ProtocolManifest;
  const repositorySet = (await readJson(join(protocolDirectory, "repositories.json"))) as {
    readonly repositories: readonly RepositoryPin[];
  };
  const taskSet = (await readJson(join(protocolDirectory, "tasks.json"))) as {
    readonly tasks: readonly TaskDefinition[];
  };

  const manifestVersion: unknown = manifest.protocolVersion;
  if (manifestVersion !== 1 && manifestVersion !== 2 && manifestVersion !== 3) {
    throw new Error(`unsupported protocol version: ${String(manifestVersion)}`);
  }
  if (repositorySet.repositories.length !== 5) {
    throw new Error(
      `protocol v${String(manifestVersion)} must contain exactly 5 repositories, got ${String(repositorySet.repositories.length)}`,
    );
  }
  if (taskSet.tasks.length !== 13) {
    throw new Error(
      `protocol v${String(manifestVersion)} must contain exactly 13 tasks, got ${String(taskSet.tasks.length)}`,
    );
  }

  return {
    manifest,
    repositories: repositorySet.repositories,
    tasks: taskSet.tasks,
  };
}

/** Loads the frozen protocol for a version the run manifest cites. */
export async function loadProtocolForVersion(version: ProtocolVersion): Promise<ProtocolBundle> {
  const protocol = await loadProtocol(protocolDirFor(version));
  if (protocol.manifest.protocolVersion !== version) {
    throw new Error(
      `loaded protocol v${String(protocol.manifest.protocolVersion)} but expected v${String(version)}`,
    );
  }
  return protocol;
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
