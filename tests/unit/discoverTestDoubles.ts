import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FileSystemError } from "../../src/filesystem/types.js";
import type { FileStat, FileSystem, WriteTextFileOptions } from "../../src/filesystem/types.js";

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
