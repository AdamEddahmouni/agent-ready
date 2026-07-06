import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/commands/init.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";

function fs(): InMemoryFileSystem {
  const f = new InMemoryFileSystem("/repo");
  f.addDirectory("/repo/.git");
  return f;
}

describe("init — adversarial: pathological package.json", () => {
  it("handles package.json with a project name containing YAML-significant characters", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "has:colon" }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    // The generated YAML should quote the name to avoid ambiguous YAML.
    expect(outcome.stdout).toContain('name: "has:colon"');
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles a project name that is a YAML boolean literal", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "true" }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.stdout).toContain('name: "true"');
  });

  it("handles a project name starting with a digit", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "123-project" }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.stdout).toContain('name: "123-project"');
  });

  it("handles a package.json description with embedded newlines in JSON", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        description: "Line one.\nLine two.",
      }),
    );
    // Should not crash; the description is handled as-is from JSON.
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles package.json with null scripts field", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", scripts: null }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).not.toContain("commands:");
  });

  it("handles package.json with scripts as an array (not object)", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", scripts: ["lint", "test"] }),
    );
    // Should not crash — scripts detection gracefully handles non-object.
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles package.json with engines as a string instead of object", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", engines: ">=20" }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).not.toContain("environment:");
  });

  it("handles a very long project description near 500 chars", async () => {
    const fsys = fs();
    const longDesc = "A".repeat(500);
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "test", description: longDesc }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // The long description should appear (possibly quoted).
    expect(outcome.stdout).toMatch(/description:/);
  });
});

describe("init — adversarial: scripts with shell metacharacters", () => {
  it("handles a script value containing backticks", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        scripts: { lint: "echo `date`" },
      }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // Should contain the run value (possibly quoted for YAML safety).
    expect(outcome.stdout).toMatch(/run: .*echo.*date/);
  });

  it("handles a script value containing dollar signs", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        scripts: { build: "echo $HOME && tsc" },
      }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles a script value containing semicolons", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        scripts: { test: "vitest; echo done" },
      }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles a script value containing quotes", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        scripts: { lint: "eslint --rule 'no-console: \"error\"' ." },
      }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });
});

describe("init — adversarial: broken/missing inputs", () => {
  it("handles completely empty repo (no files at all)", async () => {
    const fsys = fs();
    // Only .git directory exists (from fs() helper).
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("version: 1");
    expect(outcome.stdout).toContain("name: repo");
  });

  it("handles a broken package.json (invalid JSON)", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", "{ not valid json }");
    const outcome = await runInit(fsys, { json: false, write: false });
    // Should not crash — readPackageJson gracefully returns undefined.
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("version: 1");
  });

  it("handles package.json that is an array instead of object", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", "[]");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles package.json that is a string instead of object", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", '"just a string"');
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles package.json that is null", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", "null");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles empty .gitignore gracefully", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles .gitignore with only comments and blank lines", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile(
      "/repo/.gitignore",
      "# All commented\n# Nothing useful\n\n",
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).not.toContain("paths:");
  });

  it("handles .nvmrc with trailing whitespace", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.nvmrc", "  20  \n");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain(">=20 <21");
  });

  it("handles .nvmrc with non-numeric version", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.nvmrc", "lts/iron");
    const outcome = await runInit(fsys, { json: false, write: false });
    // Should fall back gracefully.
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("handles .node-version with only a 'v' prefix", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.node-version", "v20.10.0");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.stdout).toContain(">=20.10.0 <21");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });
});

describe("init — adversarial: .gitignore edge cases", () => {
  it("handles .gitignore with unbalanced bracket patterns gracefully", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "node_modules/\n[a-z\n");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // The unbalanced bracket pattern should be skipped.
    expect(outcome.stdout).toContain("node_modules/");
    expect(outcome.stdout).toContain("1 skipped");
  });

  it("handles .gitignore with brace expansion patterns", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile(
      "/repo/.gitignore",
      "node_modules/\n*.{js,ts}\n",
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // Brace patterns should be included since braces are balanced.
    expect(outcome.stdout).toContain("*.{js,ts}");
  });

  it("handles .gitignore with extglob patterns", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile(
      "/repo/.gitignore",
      "node_modules/\n@(dist|build)\n+(cache)\n",
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // Extglob patterns should be skipped.
    expect(outcome.stdout).toContain("node_modules/");
  });

  it("handles .gitignore with CRLF line endings", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", JSON.stringify({ name: "test" }));
    fsys.addFile("/repo/.gitignore", "node_modules/\r\ndist/\r\n.env\r\n");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("node_modules/");
    expect(outcome.stdout).toContain("dist/");
    expect(outcome.stdout).toContain('".env*"');
  });
});

describe("init — adversarial: YAML generation safety", () => {
  it("quotes a project name containing a hash", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "c#project" }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.stdout).toContain('name: "c#project"');
  });

  it("quotes a project name containing ampersand", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({ name: "build&test" }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.stdout).toContain('name: "build&test"');
  });

  it("handles a directory name containing YAML-significant characters", async () => {
    const fsys = new InMemoryFileSystem("/my-repo:test");
    fsys.addDirectory("/my-repo:test/.git");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("does not produce empty strings for project name in any case", async () => {
    // Directory name with only special characters should sanitize to "my-project".
    const fsys = new InMemoryFileSystem("/hash-repo");
    fsys.addDirectory("/hash-repo/.git");
    fsys.addFile("/hash-repo/package.json", JSON.stringify({ name: "@#&" }));
    const outcome = await runInit(fsys, { json: false, write: false });
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    // Should contain a non-empty name.
    expect(outcome.stdout).toContain("name:");
    expect(outcome.stdout).not.toMatch(/name: \"\"\n/);
  });

  it("handles a description containing double quotes", async () => {
    const fsys = fs();
    fsys.addFile(
      "/repo/package.json",
      JSON.stringify({
        name: "test",
        description: 'A "quoted" description.',
      }),
    );
    const outcome = await runInit(fsys, { json: false, write: false });
    // Should be quoted with escaped double quotes.
    expect(outcome.stdout).toContain("description:");
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("always generates an exit code even in worst-case input", async () => {
    const fsys = fs();
    fsys.addFile("/repo/package.json", "{broken json,}");
    fsys.addFile("/repo/.gitignore", "@(unbalanced[extglob\n");
    fsys.addFile("/repo/.nvmrc", "garbage-version");
    const outcome = await runInit(fsys, { json: false, write: false });
    expect([ExitCode.SUCCESS, ExitCode.VALIDATION_FAILED, ExitCode.INTERNAL_ERROR]).toContain(
      outcome.exitCode,
    );
  });
});
