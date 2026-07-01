import { describe, expect, it } from "vitest";
import { normalizePathPattern } from "../../src/contract/paths.js";

function normalize(raw: string, allowGlob = true) {
  return normalizePathPattern(raw, "/paths/protected", { allowGlob });
}

describe("normalizePathPattern", () => {
  it("normalizes a simple relative path", () => {
    const result = normalize("src/index.ts");
    expect(result).toEqual({ normalized: "src/index.ts" });
  });

  it("converts backslashes to forward slashes", () => {
    const result = normalize("src\\utils\\foo.ts");
    expect(result).toEqual({ normalized: "src/utils/foo.ts" });
  });

  it("collapses repeated separators and '.' segments", () => {
    const result = normalize("src//./utils///foo.ts");
    expect(result).toEqual({ normalized: "src/utils/foo.ts" });
  });

  it("collapses internal '..' segments that stay within the pattern", () => {
    const result = normalize("src/tmp/../utils/foo.ts");
    expect(result).toEqual({ normalized: "src/utils/foo.ts" });
  });

  it("preserves a leading negation marker", () => {
    const result = normalize("!dist/**");
    expect(result).toEqual({ normalized: "!dist/**" });
  });

  it("rejects an empty pattern", () => {
    const result = normalize("");
    expect(result).toHaveProperty("diagnostics");
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_PATTERN_INVALID");
    }
  });

  it("rejects a whitespace-only pattern", () => {
    const result = normalize("   ");
    expect("diagnostics" in result).toBe(true);
  });

  it("rejects POSIX absolute paths", () => {
    const result = normalize("/etc/passwd");
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_ABSOLUTE_DISALLOWED");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects Windows drive-letter paths", () => {
    const result = normalize("C:\\Windows\\System32");
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_ABSOLUTE_DISALLOWED");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects UNC paths", () => {
    const result = normalize("\\\\server\\share\\file.txt");
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_ABSOLUTE_DISALLOWED");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects paths that traverse above the repository root", () => {
    const result = normalize("../outside/file.txt");
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_TRAVERSAL_DISALLOWED");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects deep traversal that nets negative depth", () => {
    const result = normalize("a/../../b");
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_TRAVERSAL_DISALLOWED");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects a pattern that normalizes to the repository root", () => {
    const result = normalize(".");
    expect("diagnostics" in result).toBe(true);
  });

  it("allows glob syntax when allowGlob is true", () => {
    const result = normalize("src/**/*.ts", true);
    expect(result).toEqual({ normalized: "src/**/*.ts" });
  });

  it("allows brace alternation", () => {
    const result = normalize("src/{a,b}/*.ts", true);
    expect(result).toEqual({ normalized: "src/{a,b}/*.ts" });
  });

  it("rejects glob syntax when allowGlob is false", () => {
    const result = normalize("src/*.ts", false);
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_PATTERN_INVALID");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects extglob syntax", () => {
    const result = normalize("src/@(a|b).ts", true);
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_PATTERN_INVALID");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects unbalanced brackets", () => {
    const result = normalize("src/[abc.ts", true);
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_PATTERN_INVALID");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects unbalanced braces", () => {
    const result = normalize("src/{a,b.ts", true);
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_PATTERN_INVALID");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("rejects control characters", () => {
    const result = normalize("src/foo.ts", true);
    if ("diagnostics" in result) {
      expect(result.diagnostics[0]?.code).toBe("PATH_PATTERN_INVALID");
    } else {
      throw new Error("expected diagnostics");
    }
  });

  it("produces equal normalized output for equivalent inputs", () => {
    const a = normalize("src/./a/../b/foo.ts");
    const b = normalize("src/b/foo.ts");
    expect(a).toEqual(b);
  });

  it("applies Unicode NFC normalization", () => {
    const decomposed = "src/é.ts"; // e + combining acute accent
    const precomposed = "src/é.ts"; // é precomposed
    expect(normalize(decomposed)).toEqual(normalize(precomposed));
  });
});
