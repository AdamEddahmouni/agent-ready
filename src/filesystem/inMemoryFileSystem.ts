import type { FileStat, FileSystem } from "./types.js";
import { FileSystemError } from "./types.js";

/**
 * In-memory FileSystem implementation. Used by tests to exercise
 * discovery and validation deterministically without touching disk, and
 * available for embedding scenarios that want to validate a contract
 * without a real repository on disk.
 *
 * Paths are plain strings compared verbatim; callers should use a
 * consistent absolute-path style (e.g. "/repo/agent-ready.yaml").
 * Directories are inferred from the ancestors of every registered file.
 */
export class InMemoryFileSystem implements FileSystem {
  readonly cwd: string;
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  constructor(cwd: string) {
    this.cwd = cwd;
    this.addDirectory(cwd);
  }

  addFile(absolutePath: string, content: string): void {
    this.files.set(absolutePath, content);
    for (const dir of ancestorsOf(absolutePath)) {
      this.directories.add(dir);
    }
  }

  addDirectory(absolutePath: string): void {
    this.directories.add(absolutePath);
    for (const dir of ancestorsOf(absolutePath)) {
      this.directories.add(dir);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async readTextFile(absolutePath: string): Promise<string> {
    const content = this.files.get(absolutePath);
    if (content === undefined) {
      throw new FileSystemError(`Failed to read file: ${absolutePath}`, absolutePath);
    }
    return content;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async stat(absolutePath: string): Promise<FileStat | undefined> {
    if (this.files.has(absolutePath)) {
      return { isFile: true, isDirectory: false, isSymbolicLink: false };
    }
    if (this.directories.has(absolutePath)) {
      return { isFile: false, isDirectory: true, isSymbolicLink: false };
    }
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async realPath(absolutePath: string): Promise<string> {
    return absolutePath;
  }
}

function ancestorsOf(absolutePath: string): string[] {
  const result: string[] = [];
  let current = absolutePath;
  for (let i = 0; i < 128; i++) {
    const lastSeparatorIndex = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
    if (lastSeparatorIndex <= 0) {
      break;
    }
    current = current.slice(0, lastSeparatorIndex);
    result.push(current);
  }
  return result;
}
