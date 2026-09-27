import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FileSystemError } from "../../src/filesystem/types.js";
import type {
  FileStat,
  FileSystem,
  FileSystemEntry,
  WriteTextFileOptions,
} from "../../src/filesystem/types.js";
import type { DiscoveryProbe, ProbeResult } from "../../src/discover/probe.js";
import type { FactId, JsonValue, KnownFactKind } from "../../src/discover/types.js";

/**
 * Counts every file-system call so a test can assert that discovery performed
 * no writes, no directory creation, and no deletions. The counters are the
 * assertion mechanism: there is no way for a mutating call to happen without
 * incrementing one of them.
 */
export class RecordingFileSystem implements FileSystem {
  readonly inner: InMemoryFileSystem;
  readonly calls: string[] = [];

  constructor(cwd: string) {
    this.inner = new InMemoryFileSystem(cwd);
  }

  get cwd(): string {
    return this.inner.cwd;
  }

  addFile(absolutePath: string, content: string): void {
    this.inner.addFile(absolutePath, content);
  }

  addDirectory(absolutePath: string): void {
    this.inner.addDirectory(absolutePath);
  }

  addSymbolicLink(linkPath: string, targetPath: string): void {
    this.inner.addSymbolicLink(linkPath, targetPath);
  }

  async readTextFile(absolutePath: string): Promise<string> {
    this.calls.push(`read:${absolutePath}`);
    return this.inner.readTextFile(absolutePath);
  }

  async stat(absolutePath: string): Promise<FileStat | undefined> {
    this.calls.push(`stat:${absolutePath}`);
    return this.inner.stat(absolutePath);
  }

  async realPath(absolutePath: string): Promise<string> {
    this.calls.push(`realpath:${absolutePath}`);
    return this.inner.realPath(absolutePath);
  }

  async listDirectory(absolutePath: string): Promise<readonly FileSystemEntry[]> {
    this.calls.push(`listdir:${absolutePath}`);
    return this.inner.listDirectory(absolutePath);
  }

  async writeTextFile(
    absolutePath: string,
    content: string,
    _options?: WriteTextFileOptions,
  ): Promise<void> {
    this.calls.push(`write:${absolutePath}`);
    return this.inner.writeTextFile(absolutePath, content);
  }

  /** Every recorded call that could mutate state. Discovery must produce none. */
  mutatingCalls(): string[] {
    return this.calls.filter((call) => call.startsWith("write:"));
  }
}

/**
 * A file system whose reads of specific paths fail. Used to prove that an
 * inspection which could not be completed is reported differently from an
 * inspection that completed and found nothing.
 */
export class FaultyFileSystem implements FileSystem {
  readonly inner: InMemoryFileSystem;
  private readonly failing = new Set<string>();
  readonly failureMessage: string;

  constructor(cwd: string, failureMessage = "EACCES: permission denied") {
    this.inner = new InMemoryFileSystem(cwd);
    this.failureMessage = failureMessage;
  }

  get cwd(): string {
    return this.inner.cwd;
  }

  addFile(absolutePath: string, content: string): void {
    this.inner.addFile(absolutePath, content);
  }

  addDirectory(absolutePath: string): void {
    this.inner.addDirectory(absolutePath);
  }

  /** Make every subsequent read and stat of `absolutePath` fail. */
  failOn(absolutePath: string): void {
    this.failing.add(absolutePath);
  }

  private guard(absolutePath: string): void {
    if (this.failing.has(absolutePath)) {
      throw new FileSystemError(`Injected failure: ${absolutePath}`, absolutePath);
    }
  }

  async readTextFile(absolutePath: string): Promise<string> {
    this.guard(absolutePath);
    return this.inner.readTextFile(absolutePath);
  }

  async stat(absolutePath: string): Promise<FileStat | undefined> {
    this.guard(absolutePath);
    return this.inner.stat(absolutePath);
  }

  async realPath(absolutePath: string): Promise<string> {
    this.guard(absolutePath);
    return this.inner.realPath(absolutePath);
  }

  async listDirectory(absolutePath: string): Promise<readonly FileSystemEntry[]> {
    this.guard(absolutePath);
    return this.inner.listDirectory(absolutePath);
  }

  async writeTextFile(
    absolutePath: string,
    content: string,
    _options?: WriteTextFileOptions,
  ): Promise<void> {
    return this.inner.writeTextFile(absolutePath, content);
  }
}

export function repoWith(files: Readonly<Record<string, string>>): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  for (const [path, content] of Object.entries(files)) {
    fs.addFile(`/repo/${path}`, content);
  }
  fs.addDirectory("/repo/.git");
  return fs;
}

/**
 * A repository built at an arbitrary absolute root, for the checkout-location
 * independence fixture. The root is a parameter rather than a constant so a test
 * can prove that identical content yields identical bytes wherever it lives.
 */
export function repoAt(root: string, files: Readonly<Record<string, string>>): InMemoryFileSystem {
  const fs = new InMemoryFileSystem(root);
  for (const [path, content] of Object.entries(files)) {
    fs.addFile(`${root}/${path}`, content);
  }
  fs.addDirectory(`${root}/.git`);
  return fs;
}

/**
 * A repository whose files are registered in a caller-chosen order, for the
 * path-order determinism fixture.
 *
 * `InMemoryFileSystem` already sorts every directory listing, so this exists to
 * prove that sorting is what makes the output stable rather than the insertion
 * order happening to cooperate. A caller that reverses the keys is the strongest
 * available adversarial input without reaching into the file system itself.
 */
export function repoWithReversedInsertion(
  files: Readonly<Record<string, string>>,
): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  for (const path of Object.keys(files).reverse()) {
    const content = files[path];
    if (content === undefined) {
      throw new Error(`no content supplied for ${path}`);
    }
    fs.addFile(`/repo/${path}`, content);
  }
  fs.addDirectory("/repo/.git");
  return fs;
}

/** Shorthand for a `package.json` body. */
export function manifest(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, null, 2) + "\n";
}

/** A contract declaring a different package manager than the repository shows. */
export function contractClaiming(name: string, version: string): string {
  return [
    "version: 1",
    "project:",
    "  name: fixture",
    "environment:",
    "  packageManager:",
    `    name: ${name}`,
    `    version: ${version}`,
    "commands: {}",
    "paths: {}",
    "adapters: {}",
    "",
  ].join("\n");
}

/** A minimal contract that passes the shipped schema and semantic validation. */
export const VALID_CONTRACT = [
  "version: 1",
  "project:",
  "  name: fixture",
  "environment:",
  "  packageManager:",
  "    name: pnpm",
  "    version: 10.0.0",
  "commands: {}",
  "paths: {}",
  "adapters: {}",
  "",
].join("\n");

/**
 * A probe that reports a fixed result, for exercising the substrate without
 * inventing a repository domain.
 *
 * Issue #36 ships no package, workspace, or command discovery, so contradiction
 * preservation, corroboration, and the probe-outcome algebra are proved with
 * injected probes. That is the point: the substrate has to be demonstrable
 * without a substantive domain, otherwise "the substrate works" and "the first
 * domain works" can only ever be reviewed together. Issue #37 supplies real
 * probes against real signals.
 */
export function probeReporting(
  id: string,
  factId: FactId,
  shape: "existence" | "value",
  kind: KnownFactKind,
  result: ProbeResult,
): DiscoveryProbe {
  return { id, factId, shape, kind, run: () => Promise.resolve(result) };
}

/** Convenience: an existence probe that found the thing. */
export function foundExistence(id: string, factId: FactId, source: string): DiscoveryProbe {
  return probeReporting(id, factId, "existence", "derived", {
    status: "found",
    evidence: [{ source }],
  });
}

/** Convenience: a value probe asserting `value`, cited to `source`. */
export function claimingValue(
  id: string,
  factId: FactId,
  kind: KnownFactKind,
  value: JsonValue,
  source: string,
): DiscoveryProbe {
  return probeReporting(id, factId, "value", kind, {
    status: "found",
    value,
    evidence: [{ source }],
  });
}
