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
}

export interface FileSystem {
  readonly cwd: string;
  /** Reads a file as UTF-8 text. Throws FileSystemError if it cannot be read. */
  readTextFile(absolutePath: string): Promise<string>;
  /** Returns file metadata, or undefined if nothing exists at that path. */
  stat(absolutePath: string): Promise<FileStat | undefined>;
  /** Resolves symlinks to their real, absolute target path. */
  realPath(absolutePath: string): Promise<string>;
  /**
   * Writes UTF-8 text to a file, creating it if it does not exist and
   * overwriting it if it does. Never creates directories. Throws
   * FileSystemError if the write fails. The only write path in the
   * FileSystem interface — used exclusively by `agent-ready generate --write`.
   */
  writeTextFile(absolutePath: string, content: string): Promise<void>;
}

export class FileSystemError extends Error {
  readonly absolutePath: string;

  constructor(message: string, absolutePath: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FileSystemError";
    this.absolutePath = absolutePath;
  }
}
