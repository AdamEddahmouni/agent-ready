import { describe, expect, it } from "vitest";
import { validateSemantics } from "../../src/contract/semantic.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import type { RawContract } from "../../src/contract/types.js";

function baseContract(overrides: Partial<RawContract> = {}): RawContract {
  return {
    version: 1,
    project: { name: "example" },
    ...overrides,
  };
}

function context(fs?: InMemoryFileSystem) {
  const filesystem = fs ?? new InMemoryFileSystem("/repo");
  return { fs: filesystem, repoRoot: "/repo", sourcePath: "/repo/agent-ready.yaml" };
}

describe("validateSemantics", () => {
  it("passes for a minimal valid contract", async () => {
    const diagnostics = await validateSemantics(baseContract(), context());
    expect(diagnostics).toEqual([]);
  });

  it("rejects an unsupported contract version", async () => {
    const diagnostics = await validateSemantics(baseContract({ version: 2 }), context());
    expect(diagnostics.some((d) => d.code === "CONTRACT_VERSION_UNSUPPORTED")).toBe(true);
  });

  it("rejects a verification reference to an undeclared command", async () => {
    const diagnostics = await validateSemantics(
      baseContract({
        commands: { lint: { run: "pnpm lint" } },
        verification: { required: ["test"] },
      }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "COMMAND_REFERENCE_INVALID")).toBe(true);
  });

  it("accepts a verification reference to a declared command", async () => {
    const diagnostics = await validateSemantics(
      baseContract({
        commands: { lint: { run: "pnpm lint" } },
        verification: { required: ["lint"] },
      }),
      context(),
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects a duplicate verification reference", async () => {
    const diagnostics = await validateSemantics(
      baseContract({
        commands: { lint: { run: "pnpm lint" } },
        verification: { required: ["lint", "lint"] },
      }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "COMMAND_REFERENCE_INVALID")).toBe(true);
  });

  it("rejects an invalid runtime version range", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ environment: { runtimes: { node: "not-a-range" } } }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "RUNTIME_DECLARATION_INVALID")).toBe(true);
  });

  it("accepts a valid runtime version range", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ environment: { runtimes: { node: ">=20 <23" } } }),
      context(),
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects an invalid package manager version", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ environment: { packageManager: { name: "pnpm", version: "not-a-version" } } }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "PACKAGE_MANAGER_INVALID")).toBe(true);
  });

  it("rejects an absolute path in a path category", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ paths: { protected: ["/etc/passwd"] } }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "PATH_ABSOLUTE_DISALLOWED")).toBe(true);
  });

  it("rejects a traversal attempt in a path category", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ paths: { ignored: ["../outside"] } }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "PATH_TRAVERSAL_DISALLOWED")).toBe(true);
  });

  it("rejects the same normalized pattern appearing in two categories", async () => {
    const diagnostics = await validateSemantics(
      baseContract({
        paths: { protected: ["dist/**"], generated: ["dist/**"] },
      }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "PATH_CATEGORY_CONFLICT")).toBe(true);
  });

  it("rejects the same normalized pattern duplicated within one category", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ paths: { ignored: ["dist/**", "dist/**"] } }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "PATH_CATEGORY_CONFLICT")).toBe(true);
  });

  it("allows different patterns across categories", async () => {
    const diagnostics = await validateSemantics(
      baseContract({
        paths: { protected: [".env*"], generated: ["src/generated/**"], ignored: ["dist/**"] },
      }),
      context(),
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects a missing instruction source document", async () => {
    const diagnostics = await validateSemantics(
      baseContract({ instructions: { sources: ["docs/missing.md"] } }),
      context(),
    );
    expect(diagnostics.some((d) => d.code === "INSTRUCTION_SOURCE_INVALID")).toBe(true);
  });

  it("accepts an instruction source that exists on disk", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile("/repo/README.md", "# hello");
    const diagnostics = await validateSemantics(
      baseContract({ instructions: { sources: ["README.md"] } }),
      context(fs),
    );
    expect(diagnostics).toEqual([]);
  });

  it("rejects a duplicate instruction source", async () => {
    const fs = new InMemoryFileSystem("/repo");
    fs.addFile("/repo/README.md", "# hello");
    const diagnostics = await validateSemantics(
      baseContract({ instructions: { sources: ["README.md", "README.md"] } }),
      context(fs),
    );
    expect(diagnostics.some((d) => d.code === "INSTRUCTION_SOURCE_INVALID")).toBe(true);
  });
});
