import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import type { FileStat, FileSystem } from "./types.js";
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
      const result = await stat(absolutePath);
      return {
        isFile: result.isFile(),
        isDirectory: result.isDirectory(),
        isSymbolicLink: result.isSymbolicLink(),
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

  async realPath(absolutePath: string): Promise<string> {
    try {
      return await realpath(absolutePath);
    } catch (error) {
      throw new FileSystemError(`Failed to resolve real path: ${absolutePath}`, absolutePath, {
        cause: error,
      });
    }
  }

  async writeTextFile(absolutePath: string, content: string): Promise<void> {
    try {
      await writeFile(absolutePath, content, "utf8");
    } catch (error) {
      throw new FileSystemError(`Failed to write file: ${absolutePath}`, absolutePath, {
        cause: error,
      });
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
