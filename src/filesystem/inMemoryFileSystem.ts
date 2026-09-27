import type { FileStat, FileSystem, FileSystemEntry } from "./types.js";
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
  private readonly symlinks = new Map<string, string>();

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

  /**
   * Registers a symbolic link at `linkPath` pointing at `targetPath`.
   *
   * `lstat` semantics are preserved: the link is reported as a symlink and
   * never as the file or directory it resolves to, which is what makes
   * `realPath` and any symlink-escape guard testable without a real
   * filesystem. Registration also creates the link's parent directories, so a
   * test does not have to declare them separately.
   */
  addSymbolicLink(linkPath: string, targetPath: string): void {
    this.symlinks.set(linkPath, targetPath);
    for (const dir of ancestorsOf(linkPath)) {
      this.directories.add(dir);
    }
  }

  /**
   * Synchronous views of the two accessors, for tests that need to copy or
   * inspect a whole tree.
   *
   * `listDirectorySync` and `readTextSync` are deliberately *not* on the
   * `FileSystem` interface. Discovery must not be able to enumerate a repository
   * without going through the async, failure-distinguishing boundary, and adding
   * a synchronous convenience to the interface would hand every caller a way to
   * bypass the absent-versus-failed distinction those methods preserve. This
   * class is a test double, so exposing the views here widens no production
   * surface.
   */
  listDirectorySync(absolutePath: string): readonly FileSystemEntry[] {
    return this.entriesOf(absolutePath);
  }

  readTextSync(absolutePath: string): string {
    const content = this.files.get(absolutePath);
    if (content === undefined) {
      throw new FileSystemError(`Failed to read file: ${absolutePath}`, absolutePath);
    }
    return content;
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
    if (this.symlinks.has(absolutePath)) {
      return {
        isFile: false,
        isDirectory: false,
        isSymbolicLink: true,
        sizeBytes: 0,
      };
    }
    if (this.files.has(absolutePath)) {
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        sizeBytes: Buffer.byteLength(this.files.get(absolutePath) ?? "", "utf8"),
      };
    }
    if (this.directories.has(absolutePath)) {
      return { isFile: false, isDirectory: true, isSymbolicLink: false, sizeBytes: 0 };
    }
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async listDirectory(absolutePath: string): Promise<readonly FileSystemEntry[]> {
    if (!this.directories.has(absolutePath) || this.symlinks.has(absolutePath)) {
      throw new FileSystemError(`Failed to list directory: ${absolutePath}`, absolutePath);
    }
    return this.entriesOf(absolutePath);
  }

  /** The immediate entries of a directory, code-unit sorted by name. */
  private entriesOf(absolutePath: string): readonly FileSystemEntry[] {
    const prefix = absolutePath.endsWith("/") ? absolutePath : `${absolutePath}/`;
    const names = new Set<string>();
    for (const candidate of [...this.files.keys(), ...this.directories, ...this.symlinks.keys()]) {
      if (!candidate.startsWith(prefix)) {
        continue;
      }
      const remainder = candidate.slice(prefix.length);
      if (remainder.length === 0 || remainder.includes("/")) {
        continue;
      }
      names.add(remainder);
    }
    return [...names]
      .map((name): FileSystemEntry => {
        const child = prefix + name;
        const isSymbolicLink = this.symlinks.has(child);
        return {
          name,
          isFile: !isSymbolicLink && this.files.has(child),
          isDirectory: !isSymbolicLink && this.directories.has(child),
          isSymbolicLink,
        };
      })
      .sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async realPath(absolutePath: string): Promise<string> {
    return this.resolveSymlinks(absolutePath);
  }

  /**
   * Walks the link chain to a final, non-link path, then canonicalizes it the
   * way a real `realpath` does: `.` segments resolved, repeated separators
   * collapsed, no trailing separator.
   *
   * Canonicalization matters for fidelity rather than convenience. A test
   * double that returned its input unchanged would make `<root>/.`` compare
   * unequal to `<root>`, and a caller with a containment check would reject
   * every legitimate child. A double that behaves differently from the real
   * implementation is how a bug survives a green test suite.
   */
  private resolveSymlinks(absolutePath: string): string {
    let current = absolutePath;
    for (let hops = 0; hops < 40; hops++) {
      const target = this.symlinks.get(current);
      if (target === undefined) {
        break;
      }
      current = target.startsWith("/") ? target : `${parentOf(current)}/${target}`;
    }
    const segments: string[] = [];
    for (const segment of current.split("/")) {
      if (segment === "" || segment === ".") {
        continue;
      }
      segments.push(segment);
    }
    return `/${segments.join("/")}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async writeTextFile(absolutePath: string, content: string): Promise<void> {
    this.addFile(absolutePath, content);
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

function parentOf(absolutePath: string): string {
  const trimmed = absolutePath.replace(/[/\\]+$/, "");
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSeparator <= 0) {
    return trimmed.length === 0 ? "/" : trimmed;
  }
  return trimmed.slice(0, lastSeparator);
}
