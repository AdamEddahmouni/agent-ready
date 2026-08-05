import { describe, expect, it } from "vitest";
import { extractImportSpecifiers } from "../../src/analyze/importSpecifiers.js";

describe("extractImportSpecifiers", () => {
  it("extracts the bounded import forms with their positions", () => {
    const found = extractImportSpecifiers(
      [
        'import a from "./a.js";',
        'import "./side-effect.js";',
        'export { b } from "./b.js";',
        'const c = require("./c.js");',
        'const d = await import("./d.js");',
      ].join("\n"),
    );

    expect(found.map((entry) => entry.specifier)).toEqual([
      "./a.js",
      "./side-effect.js",
      "./b.js",
      "./c.js",
      "./d.js",
    ]);
    expect(found.map(({ line, column }) => ({ line, column }))).toEqual([
      { line: 1, column: 16 },
      { line: 2, column: 9 },
      { line: 3, column: 20 },
      { line: 4, column: 20 },
      { line: 5, column: 25 },
    ]);
  });

  it("extracts a named-import clause that spans lines", () => {
    const found = extractImportSpecifiers(
      ["import {", "  first,", "  second,", '} from "./multi.js";'].join("\n"),
    );

    expect(found.map((entry) => entry.specifier)).toEqual(["./multi.js"]);
    expect(found[0]?.line).toBe(4);
  });

  it("ignores import-shaped content in comments and string literals", () => {
    const found = extractImportSpecifiers(
      [
        '// import x from "./commented.js";',
        "/*",
        ' import y from "./blocked.js";',
        "*/",
        'const doc = "import z from \\"./quoted.js\\"";',
        'import real from "./real.js";',
      ].join("\n"),
    );

    expect(found.map((entry) => entry.specifier)).toEqual(["./real.js"]);
  });

  it("does not pair an earlier statement with a later unrelated from", () => {
    const found = extractImportSpecifiers(
      ['export const table = "rows";', 'const q = builder.from("users");'].join("\n"),
    );

    expect(found).toEqual([]);
  });

  it("ignores non-literal dynamic specifiers rather than guessing", () => {
    const found = extractImportSpecifiers(
      ["const name = './dynamic.js';", "const mod = await import(name);", "require(name);"].join(
        "\n",
      ),
    );

    expect(found).toEqual([]);
  });

  it("extracts bare specifiers as written, leaving classification to the caller", () => {
    const found = extractImportSpecifiers(
      ['import { readFile } from "node:fs/promises";', 'import express from "express";'].join("\n"),
    );

    expect(found.map((entry) => entry.specifier)).toEqual(["node:fs/promises", "express"]);
  });

  it("reports each import of the same module separately", () => {
    const found = extractImportSpecifiers(
      ['import type { A } from "./types.js";', 'import { b } from "./types.js";'].join("\n"),
    );

    expect(found.map(({ specifier, line }) => ({ specifier, line }))).toEqual([
      { specifier: "./types.js", line: 1 },
      { specifier: "./types.js", line: 2 },
    ]);
  });

  it("does not let an unterminated quote swallow later imports", () => {
    const found = extractImportSpecifiers(
      ['const broken = "oops;', 'import real from "./after.js";'].join("\n"),
    );

    expect(found.map((entry) => entry.specifier)).toContain("./after.js");
  });
});
