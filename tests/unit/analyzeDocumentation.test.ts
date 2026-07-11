import { describe, expect, it } from "vitest";
import {
  analyzeDocumentation,
  MAX_INSTRUCTION_SOURCE_BYTES,
} from "../../src/analyze/analyzeDocumentation.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { FileSystemError } from "../../src/filesystem/types.js";

function fileSystem(files: Readonly<Record<string, string>>): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  for (const [path, content] of Object.entries(files)) fs.addFile(`/repo/${path}`, content);
  return fs;
}

describe("analyzeDocumentation", () => {
  it("checks local files and directories while ignoring remote links and anchors", async () => {
    const fs = fileSystem({
      "README.md": [
        "[guide](docs/guide.md#usage)",
        "[docs](docs/)",
        "[site](https://example.com/missing)",
        "[anchor](#local)",
      ].join("\n"),
      "docs/guide.md": "# Guide\n",
      "docs/index.md": "# Index\n",
    });
    const result = await analyzeDocumentation(fs, "/repo", ["README.md"]);
    expect(result.linksChecked).toBe(2);
    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports missing local targets with deterministic resolution and location", async () => {
    const fs = fileSystem({ "docs/guide.md": "See [missing](../api/missing.md).\n" });
    const result = await analyzeDocumentation(fs, "/repo", ["docs/guide.md"]);
    expect(result.findings).toEqual([
      {
        kind: "broken",
        sourcePath: "docs/guide.md",
        destination: "../api/missing.md",
        resolvedPath: "api/missing.md",
        line: 1,
        column: 15,
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe("DOCUMENTATION_LINK_BROKEN");
  });

  it("rejects lexical traversal above the repository root", async () => {
    const fs = fileSystem({ "README.md": "[secret](../secret.txt)\n" });
    const result = await analyzeDocumentation(fs, "/repo", ["README.md"]);
    expect(result.findings[0]).toMatchObject({
      kind: "outside-repository",
      destination: "../secret.txt",
    });
    expect(result.diagnostics[0]?.code).toBe("DOCUMENTATION_LINK_OUTSIDE_REPOSITORY");
  });

  it("preserves instruction-source declaration order", async () => {
    const fs = fileSystem({
      "docs/b.md": "[missing](missing-b.md)\n",
      "docs/a.md": "[missing](missing-a.md)\n",
    });
    const result = await analyzeDocumentation(fs, "/repo", ["docs/b.md", "docs/a.md"]);
    expect(result.sources.map((source) => source.path)).toEqual(["docs/b.md", "docs/a.md"]);
    expect(result.findings.map((finding) => finding.resolvedPath)).toEqual([
      "docs/missing-b.md",
      "docs/missing-a.md",
    ]);
  });

  it("reports source-read and target-inspection failures", async () => {
    class FailingFileSystem extends InMemoryFileSystem {
      override async readTextFile(absolutePath: string): Promise<string> {
        if (absolutePath.endsWith("unreadable.md")) {
          throw new FileSystemError("access denied", absolutePath);
        }
        return super.readTextFile(absolutePath);
      }

      override async stat(absolutePath: string) {
        if (absolutePath.endsWith("locked.md")) {
          throw new FileSystemError("access denied", absolutePath);
        }
        return super.stat(absolutePath);
      }
    }

    const fs = new FailingFileSystem("/repo");
    fs.addFile("/repo/README.md", "[locked](locked.md)\n");
    fs.addFile("/repo/unreadable.md", "unreachable\n");
    const result = await analyzeDocumentation(fs, "/repo", ["README.md", "unreadable.md"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "DOCUMENTATION_LINK_CHECK_FAILED",
      "DOCUMENTATION_SOURCE_READ_FAILED",
    ]);
  });

  it("accepts an instruction source exactly at the per-source size limit", async () => {
    const fs = fileSystem({ README: "x".repeat(MAX_INSTRUCTION_SOURCE_BYTES) });
    const result = await analyzeDocumentation(fs, "/repo", ["README"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.sources).toEqual([{ path: "README", linksChecked: 0 }]);
  });

  it("rejects an oversized instruction source before reading its content", async () => {
    class ReadTrackingFileSystem extends InMemoryFileSystem {
      readAttempted = false;

      override async readTextFile(absolutePath: string): Promise<string> {
        this.readAttempted = true;
        return super.readTextFile(absolutePath);
      }
    }

    const fs = new ReadTrackingFileSystem("/repo");
    fs.addFile("/repo/README.md", "x".repeat(MAX_INSTRUCTION_SOURCE_BYTES + 1));
    const result = await analyzeDocumentation(fs, "/repo", ["README.md"]);

    expect(fs.readAttempted).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "INSTRUCTION_SOURCE_TOO_LARGE",
      metadata: {
        sizeBytes: MAX_INSTRUCTION_SOURCE_BYTES + 1,
        maxSizeBytes: MAX_INSTRUCTION_SOURCE_BYTES,
      },
    });
  });
});
