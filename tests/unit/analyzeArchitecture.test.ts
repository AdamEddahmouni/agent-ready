import { describe, expect, it } from "vitest";
import { analyzeArchitecture } from "../../src/analyze/analyzeArchitecture.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";

function fileSystem(files: Readonly<Record<string, string>>): InMemoryFileSystem {
  const fs = new InMemoryFileSystem("/repo");
  for (const [path, content] of Object.entries(files)) fs.addFile(`/repo/${path}`, content);
  return fs;
}

describe("analyzeArchitecture", () => {
  it("reports an import that crosses a declared boundary", async () => {
    const fs = fileSystem({
      "src/contract/pipeline.ts": 'import { render } from "../cli/render.js";\n',
      "src/cli/render.ts": "export const render = () => {};\n",
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      sourcePath: "src/contract/pipeline.ts",
      specifier: "../cli/render.js",
      resolvedPath: "src/cli/render.js",
      from: "src/contract",
      mustNotImport: "src/cli",
      line: 1,
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["ARCHITECTURE_BOUNDARY_VIOLATED"]);
    expect(result.importsChecked).toBe(1);
    expect(result.filesScanned).toBe(1);
  });

  it("accepts imports that stay inside the boundary", async () => {
    const fs = fileSystem({
      "src/contract/pipeline.ts": 'import { parse } from "./parseYaml.js";\n',
      "src/contract/parseYaml.ts": "export const parse = () => {};\n",
      "src/cli/render.ts": "export const render = () => {};\n",
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);

    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.filesScanned).toBe(2);
  });

  it("matches on path segments, not string prefixes", async () => {
    const fs = fileSystem({
      "src/contract/pipeline.ts": 'import { x } from "../contracts-legacy/x.js";\n',
      "src/contracts-legacy/x.js": "export const x = 1;\n",
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/contracts"] },
    ]);

    expect(result.findings).toEqual([]);
  });

  it("ignores bare module specifiers in this release", async () => {
    const fs = fileSystem({
      "src/contract/pipeline.ts": [
        'import { readFile } from "node:fs/promises";',
        'import commander from "commander";',
      ].join("\n"),
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["node:fs"] },
    ]);

    expect(result.findings).toEqual([]);
    expect(result.importsChecked).toBe(0);
  });

  it("scans nested directories under the origin", async () => {
    const fs = fileSystem({
      "src/contract/deep/nested/bad.ts": 'import { r } from "../../../cli/render.js";\n',
      "src/cli/render.ts": "export const r = 1;\n",
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.sourcePath).toBe("src/contract/deep/nested/bad.ts");
  });

  it("only scans JavaScript and TypeScript sources", async () => {
    const fs = fileSystem({
      "src/contract/notes.md": 'import { r } from "../cli/render.js";\n',
      "src/contract/data.json": '{"import": "../cli/render.js"}\n',
      "src/contract/real.mjs": 'import { r } from "../cli/render.js";\n',
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);

    expect(result.filesScanned).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.sourcePath).toBe("src/contract/real.mjs");
  });

  it("excludes declared generated and ignored paths", async () => {
    const fs = fileSystem({
      "src/contract/dist/bundle.js": 'import { r } from "../../cli/render.js";\n',
      "src/contract/real.ts": "export const ok = 1;\n",
    });

    const result = await analyzeArchitecture(
      fs,
      "/repo",
      [{ from: "src/contract", mustNotImport: ["src/cli"] }],
      ["src/contract/dist/**"],
    );

    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(1);
  });

  it("reports a scan failure when the declared origin does not exist", async () => {
    const fs = fileSystem({ "src/cli/render.ts": "export const r = 1;\n" });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/missing", mustNotImport: ["src/cli"] },
    ]);

    expect(result.diagnostics.map((d) => d.code)).toEqual(["ARCHITECTURE_ANALYSIS_SCAN_FAILED"]);
    expect(result.findings).toEqual([]);
  });

  it("reports every violating import, without suppression", async () => {
    const fs = fileSystem({
      "src/contract/a.ts": 'import { r } from "../cli/render.js";\n',
      "src/contract/b.ts": 'import { r } from "../cli/render.js";\n',
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);

    expect(result.findings.map((f) => f.sourcePath)).toEqual([
      "src/contract/a.ts",
      "src/contract/b.ts",
    ]);
  });

  it("reports one finding per import even when several targets could match", async () => {
    const fs = fileSystem({
      "src/contract/a.ts": 'import { r } from "../cli/nested/render.js";\n',
    });

    const result = await analyzeArchitecture(fs, "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli", "src/cli/nested"] },
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.mustNotImport).toBe("src/cli");
  });

  it("produces deterministic results across runs", async () => {
    const files = {
      "src/contract/b.ts": 'import { r } from "../cli/render.js";\n',
      "src/contract/a.ts": 'import { r } from "../cli/render.js";\n',
      "src/contract/nested/c.ts": 'import { r } from "../../cli/render.js";\n',
    };

    const first = await analyzeArchitecture(fileSystem(files), "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);
    const second = await analyzeArchitecture(fileSystem(files), "/repo", [
      { from: "src/contract", mustNotImport: ["src/cli"] },
    ]);

    expect(first.findings).toEqual(second.findings);
    expect(first.findings.map((f) => f.sourcePath)).toEqual([
      "src/contract/a.ts",
      "src/contract/b.ts",
      "src/contract/nested/c.ts",
    ]);
  });
});
