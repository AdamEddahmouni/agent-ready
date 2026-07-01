import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Creates an isolated, real temporary directory for integration tests
 * that exercise actual file-system I/O (as opposed to unit tests, which
 * use InMemoryFileSystem). Callers must call cleanup() when done.
 */
export async function createTestRepo(
  files: Readonly<Record<string, string>>,
): Promise<{ readonly root: string; readonly cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agent-ready-test-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
