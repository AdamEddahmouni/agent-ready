import { describe, expect, it } from "vitest";
import { validateSchema } from "../../src/contract/schema.js";

const noopLocate = (): undefined => undefined;

const minimalValid = {
  version: 1,
  project: { name: "example" },
};

describe("validateSchema", () => {
  it("accepts a minimal valid contract", () => {
    const result = validateSchema(minimalValid, "/repo/agent-ready.yaml", noopLocate);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const result = validateSchema(
      { ...minimalValid, unknownField: true },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("CONTRACT_SCHEMA_INVALID");
    }
  });

  it("rejects unknown nested fields", () => {
    const result = validateSchema(
      { ...minimalValid, project: { name: "x", unknown: 1 } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = validateSchema({ version: 1 }, "/repo/agent-ready.yaml", noopLocate);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty project name", () => {
    const result = validateSchema(
      { version: 1, project: { name: "" } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer version", () => {
    const result = validateSchema(
      { version: "1", project: { name: "x" } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
  });

  it("maps command-key errors to COMMAND_IDENTIFIER_INVALID", () => {
    const result = validateSchema(
      { ...minimalValid, commands: { Invalid_Name: { run: "echo hi" } } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "COMMAND_IDENTIFIER_INVALID")).toBe(true);
    }
  });

  it("rejects a command with an empty run string", () => {
    const result = validateSchema(
      { ...minimalValid, commands: { lint: { run: "" } } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty verification.required array", () => {
    const result = validateSchema(
      { ...minimalValid, verification: { required: [] } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
  });

  it("maps runtime errors to RUNTIME_DECLARATION_INVALID", () => {
    const result = validateSchema(
      { ...minimalValid, environment: { runtimes: {} } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "RUNTIME_DECLARATION_INVALID")).toBe(true);
    }
  });

  it("rejects an unknown package manager name", () => {
    const result = validateSchema(
      {
        ...minimalValid,
        environment: { packageManager: { name: "bun", version: "1" } },
      },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "PACKAGE_MANAGER_INVALID")).toBe(true);
    }
  });

  it("rejects an unknown adapter name", () => {
    const result = validateSchema(
      { ...minimalValid, adapters: { unknownAdapter: { enabled: true } } },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "ADAPTER_DECLARATION_INVALID")).toBe(true);
    }
  });

  it("accepts a fully populated Phase 1 contract", () => {
    const result = validateSchema(
      {
        version: 1,
        project: { name: "full-example", description: "A fully populated contract." },
        environment: {
          runtimes: { node: ">=20 <23" },
          packageManager: { name: "pnpm", version: "10" },
        },
        commands: {
          install: { run: "pnpm install --frozen-lockfile" },
          lint: { run: "pnpm lint" },
          test: { run: "pnpm test" },
        },
        verification: { required: ["lint", "test"] },
        paths: {
          protected: [".env*"],
          generated: ["src/generated/**"],
          ignored: ["node_modules/**", "dist/**"],
        },
        instructions: { sources: ["README.md"] },
        adapters: { agentsMd: { enabled: true }, claude: { enabled: true } },
      },
      "/repo/agent-ready.yaml",
      noopLocate,
    );
    expect(result.ok).toBe(true);
  });
});
