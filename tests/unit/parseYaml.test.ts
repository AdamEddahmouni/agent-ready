import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_YAML_DEPTH,
  MAX_CONTRACT_BYTES,
  parseYaml,
} from "../../src/contract/parseYaml.js";

describe("parseYaml", () => {
  it("parses a valid document into a plain JS value", () => {
    const result = parseYaml("a: 1\nb:\n  - x\n  - y\n", "/repo/agent-ready.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual({ a: 1, b: ["x", "y"] });
    }
  });

  it("rejects malformed YAML", () => {
    const result = parseYaml("a: [1, 2\n", "/repo/agent-ready.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("YAML_PARSE_FAILED");
    }
  });

  it("detects duplicate mapping keys instead of silently overwriting", () => {
    const result = parseYaml("a: 1\na: 2\n", "/repo/agent-ready.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("YAML_DUPLICATE_KEY");
      expect(result.diagnostics[0]?.location?.line).toBe(2);
    }
  });

  it("rejects input larger than the maximum contract size", () => {
    const huge = "a: " + "x".repeat(MAX_CONTRACT_BYTES + 1);
    const result = parseYaml(huge, "/repo/agent-ready.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("CONTRACT_READ_FAILED");
    }
  });

  it("does not execute or specially resolve custom YAML tags", () => {
    const result = parseYaml("a: !!js/function 'function () {}'\n", "/repo/agent-ready.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The tag is not resolved to executable code; it is treated as inert data.
      expect(typeof (result.value.value as { a: unknown }).a).not.toBe("function");
    }
  });

  it("provides a source location for a nested field via locate()", () => {
    const yaml = "project:\n  name: foo\ncommands:\n  lint:\n    run: pnpm lint\n";
    const result = parseYaml(yaml, "/repo/agent-ready.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const location = result.value.locate("/commands/lint/run");
      expect(location).toEqual({ line: 5, column: 10 });
    }
  });

  it("returns undefined location for a pointer that does not exist", () => {
    const result = parseYaml("a: 1\n", "/repo/agent-ready.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.locate("/does/not/exist")).toBeUndefined();
    }
  });

  it("accepts a document exactly at a configured nesting limit", () => {
    const result = parseYaml("a:\n  b: 1\n", "/repo/agent-ready.yaml", { maxDepth: 3 });
    expect(result.ok).toBe(true);
  });

  it("rejects a document deeper than a configured nesting limit", () => {
    const result = parseYaml("a:\n  b: 1\n", "/repo/agent-ready.yaml", { maxDepth: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "YAML_NESTING_TOO_DEEP",
        metadata: { observedDepth: 3, maxDepth: 2 },
      });
    }
  });

  it("rejects deeply nested non-aliased YAML at the default limit", () => {
    const nested = `${"{a: ".repeat(DEFAULT_MAX_YAML_DEPTH)}1${"}".repeat(DEFAULT_MAX_YAML_DEPTH)}`;
    const result = parseYaml(nested, "/repo/agent-ready.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("YAML_NESTING_TOO_DEEP");
    }
  });
});
