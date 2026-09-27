/**
 * Narrow file-system boundary. Domain logic depends on this interface, not
 * on `node:fs` or `process.cwd()` directly, so contract discovery and
 * validation can be tested against fixtures or in-memory state without
 * touching the real file system.
 */
export interface FileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  /** File size in bytes. Directories and other non-file entries report 0. */
  readonly sizeBytes: number;
}

export interface FileSystem {
  readonly cwd: string;
  /** Reads a file as UTF-8 text. Throws FileSystemError if it cannot be read. */
  readTextFile(absolutePath: string): Promise<string>;
  /** Returns file metadata, or undefined if nothing exists at that path. */
  stat(absolutePath: string): Promise<FileStat | undefined>;
  /**
   * Lists the immediate entries of a directory, in a deterministic order
   * (code-unit by name). Returns an empty list for a directory with no
   * entries. Throws FileSystemError if the path cannot be read, and never
   * recurses.
   *
   * Added for repository discovery's workspace-pattern expansion, which cannot
   * resolve a pattern such as `packages/*` from `stat` alone. Like `readTextFile`
   * and `stat` it is a pure read: it adds no write, process, Git, or network
   * capability, so ADR-0044's read-only guarantee is unaffected. See ADR-0045.
   */
  listDirectory(absolutePath: string): Promise<readonly FileSystemEntry[]>;
  /** Resolves symlinks to their real, absolute target path. */
  realPath(absolutePath: string): Promise<string>;
  /**
   * Writes UTF-8 text to a file, creating it if it does not exist and
   * overwriting it if it does. Never creates directories. Throws
   * FileSystemError if the write fails. The only write path in the
   * FileSystem interface — used by `agent-ready generate --write`,
   * `agent-ready upgrade --write`, and `agent-ready verify --execute --record`
   * (see ADR-0015).
   */
  writeTextFile(
    absolutePath: string,
    content: string,
    options?: WriteTextFileOptions,
  ): Promise<void>;
}

export interface FileSystemEntry {
  /** Entry name only, with no directory part. */
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

export interface WriteTextFileOptions {
  /** Reject writes whose real parent directory is outside this root. */
  readonly allowedRoot?: string;
}

export class FileSystemError extends Error {
  readonly absolutePath: string;

  constructor(message: string, absolutePath: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FileSystemError";
    this.absolutePath = absolutePath;
  }
}
