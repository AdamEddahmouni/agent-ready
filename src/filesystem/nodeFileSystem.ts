import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { FileStat, FileSystem, FileSystemEntry, WriteTextFileOptions } from "./types.js";
import { FileSystemError } from "./types.js";

/**
 * Real, process-global file-system implementation backed by `node:fs`.
 */
export class NodeFileSystem implements FileSystem {
  get cwd(): string {
    return process.cwd();
  }

  async readTextFile(absolutePath: string): Promise<string> {
    try {
      return await readFile(absolutePath, "utf8");
    } catch (error) {
      throw new FileSystemError(`Failed to read file: ${absolutePath}`, absolutePath, {
        cause: error,
      });
    }
  }

  async stat(absolutePath: string): Promise<FileStat | undefined> {
    try {
      const result = await lstat(absolutePath);
      return {
        isFile: result.isFile(),
        isDirectory: result.isDirectory(),
        isSymbolicLink: result.isSymbolicLink(),
        sizeBytes: result.isFile() ? result.size : 0,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw new FileSystemError(`Failed to stat path: ${absolutePath}`, absolutePath, {
        cause: error,
      });
    }
  }

  /**
   * Lists a directory's immediate entries via `readdir` with `withFileTypes`,
   * then sorts by name in code-unit order.
   *
   * The sort is not cosmetic. `readdir` order is filesystem-dependent and
   * differs between platforms and between runs on the same machine, so
   * anything a caller derives from this list would be non-deterministic
   * without it. Sorting here means every consumer inherits determinism
   * instead of having to remember it.
   *
   * Symlinks are reported as symlinks and never followed: the caller decides
   * whether to traverse one, and a discovery walk declines to.
   */
  async listDirectory(absolutePath: string): Promise<readonly FileSystemEntry[]> {
    let dirents;
    try {
      dirents = await readdir(absolutePath, { withFileTypes: true });
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw new FileSystemError(`Failed to list directory: ${absolutePath}`, absolutePath, {
        cause: error,
      });
    }
    return dirents
      .map((dirent): FileSystemEntry => {
        // `Dirent` reports the entry's own type, so a symlink is never
        // misreported as the file or directory it points at.
        const isSymbolicLink = dirent.isSymbolicLink();
        return {
          name: dirent.name,
          isFile: !isSymbolicLink && dirent.isFile(),
          isDirectory: !isSymbolicLink && dirent.isDirectory(),
          isSymbolicLink,
        };
      })
      .sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
  }

  async realPath(absolutePath: string): Promise<string> {
    try {
      return await realpath(absolutePath);
    } catch (error) {
      throw new FileSystemError(`Failed to resolve real path: ${absolutePath}`, absolutePath, {
        cause: error,
      });
    }
  }

  async writeTextFile(
    absolutePath: string,
    content: string,
    options: WriteTextFileOptions = {},
  ): Promise<void> {
    try {
      const targetStat = await lstatIfPresent(absolutePath);
      if (targetStat?.isSymbolicLink() === true) {
        throw new Error("Refusing to write through a symbolic link.");
      }

      if (options.allowedRoot !== undefined) {
        const [rootRealPath, parentRealPath] = await Promise.all([
          realpath(options.allowedRoot),
          realpath(dirname(absolutePath)),
        ]);
        if (!isWithinRoot(rootRealPath, parentRealPath)) {
          throw new Error(`Refusing to write outside the allowed root: ${options.allowedRoot}`);
        }
      }

      // O_NOFOLLOW closes the lstat/open race on platforms that support it.
      // Windows does not expose O_NOFOLLOW in Node, so the immediately preceding
      // lstat plus real-parent containment check is the strongest portable guard.
      const noFollow =
        (constants as Readonly<Record<string, number | undefined>>)["O_NOFOLLOW"] ?? 0;
      const handle = await open(
        absolutePath,
        constants.O_WRONLY | constants.O_CREAT | noFollow,
        0o666,
      );
      try {
        await handle.truncate(0);
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      const reason = error instanceof Error ? ` ${error.message}` : "";
      throw new FileSystemError(`Failed to write file: ${absolutePath}.${reason}`, absolutePath, {
        cause: error,
      });
    }
  }
}

async function lstatIfPresent(absolutePath: string) {
  try {
    return await lstat(absolutePath);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
