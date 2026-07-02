import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGenerate } from "../../src/cli/commands/generate.js";
import { NodeFileSystem } from "../../src/filesystem/nodeFileSystem.js";
import { ExitCode } from "../../src/diagnostics/exitCodes.js";
import { GENERATED_FILE_MARKER } from "../../src/generate/marker.js";
import { createTestRepo } from "./testRepo.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function repo(files: Record<string, string>) {
  const testRepo = await createTestRepo(files);
  cleanups.push(testRepo.cleanup);
  return testRepo;
}

const CONTRACT = [
  "version: 1",
  "project:",
  "  name: generate-example",
  "adapters:",
  "  agentsMd:",
  "    enabled: true",
  "  claude:",
  "    enabled: true",
  "",
].join("\n");

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

describe("agent-ready generate (CLI composition)", () => {
  it("dry run reports would-write and writes nothing", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: false, check: false, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    expect(outcome.stdout).toContain("AGENTS.md [agentsMd]: would-write");
    expect(outcome.stdout).toContain("CLAUDE.md [claude]: would-write");
    expect(await readIfExists(join(root, "AGENTS.md"))).toBeUndefined();
    expect(await readIfExists(join(root, "CLAUDE.md"))).toBeUndefined();
  });

  it("--write creates both files with the managed marker", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: true, check: false, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const agentsMd = await readIfExists(join(root, "AGENTS.md"));
    const claudeMd = await readIfExists(join(root, "CLAUDE.md"));
    expect(agentsMd).toContain(GENERATED_FILE_MARKER);
    expect(claudeMd).toContain(GENERATED_FILE_MARKER);
  });

  it("--write is idempotent on re-run", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const fs = new NodeFileSystem();
    await runGenerate(fs, { json: false, write: true, check: false, force: false }, root);
    const second = await runGenerate(
      fs,
      { json: false, write: true, check: false, force: false },
      root,
    );
    expect(second.exitCode).toBe(ExitCode.SUCCESS);
    expect(second.stdout).toContain("AGENTS.md [agentsMd]: up-to-date");
    expect(second.stdout).toContain("CLAUDE.md [claude]: up-to-date");
  });

  it("--write refuses an existing file without the managed marker", async () => {
    const { root } = await repo({
      "agent-ready.yaml": CONTRACT,
      "AGENTS.md": "hand-written, not managed",
    });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: true, check: false, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stdout).toContain("GENERATE_TARGET_UNMANAGED");
    const content = await readIfExists(join(root, "AGENTS.md"));
    expect(content).toBe("hand-written, not managed");
  });

  it("--write --force overwrites an unmanaged file", async () => {
    const { root } = await repo({
      "agent-ready.yaml": CONTRACT,
      "AGENTS.md": "hand-written, not managed",
    });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: true, check: false, force: true },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
    const content = await readIfExists(join(root, "AGENTS.md"));
    expect(content).toContain(GENERATED_FILE_MARKER);
  });

  it("--check exits non-zero when files are missing", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: false, check: true, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(await readIfExists(join(root, "AGENTS.md"))).toBeUndefined();
  });

  it("--check exits 0 once files are up to date", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const fs = new NodeFileSystem();
    await runGenerate(fs, { json: false, write: true, check: false, force: false }, root);
    const outcome = await runGenerate(
      fs,
      { json: false, write: false, check: true, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);
  });

  it("--check --write together is rejected before the pipeline runs", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: true, check: true, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.VALIDATION_FAILED);
    expect(outcome.stderr).toContain("--check and --write cannot be used together");
    expect(await readIfExists(join(root, "AGENTS.md"))).toBeUndefined();
  });

  it("--json reports a stable shape across dry-run, write, and check modes", async () => {
    const { root } = await repo({ "agent-ready.yaml": CONTRACT });
    const fs = new NodeFileSystem();

    const dryRun = await runGenerate(
      fs,
      { json: true, write: false, check: false, force: false },
      root,
    );
    const dryRunBody = JSON.parse(dryRun.stdout) as {
      ok: boolean;
      mode: string;
      files: { adapter: string; relativePath: string; status: string }[];
    };
    expect(dryRunBody).toMatchObject({ ok: true, mode: "dry-run" });
    expect(dryRunBody.files).toHaveLength(2);

    const write = await runGenerate(
      fs,
      { json: true, write: true, check: false, force: false },
      root,
    );
    const writeBody = JSON.parse(write.stdout) as { ok: boolean; mode: string };
    expect(writeBody).toMatchObject({ ok: true, mode: "write" });

    const check = await runGenerate(
      fs,
      { json: true, write: false, check: true, force: false },
      root,
    );
    const checkBody = JSON.parse(check.stdout) as { ok: boolean; mode: string };
    expect(checkBody).toMatchObject({ ok: true, mode: "check" });
  });

  it("produces no output file for a disabled adapter", async () => {
    const { root } = await repo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: generate-example",
        "adapters:",
        "  agentsMd:",
        "    enabled: false",
        "  claude:",
        "    enabled: true",
        "",
      ].join("\n"),
    });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: true, write: true, check: false, force: false },
      root,
    );
    const body = JSON.parse(outcome.stdout) as { files: { adapter: string }[] };
    expect(body.files.map((f) => f.adapter)).toEqual(["claude"]);
    expect(await readIfExists(join(root, "AGENTS.md"))).toBeUndefined();
  });

  it("matches the golden fixtures for a fully populated contract", async () => {
    const { root } = await repo({
      "agent-ready.yaml": await readFile(
        join(process.cwd(), "examples/complete-phase-1/agent-ready.yaml"),
        "utf8",
      ),
      "README.md": "",
      "docs/architecture.md": "",
      // A pre-existing .github/ directory, as in this repo itself, so the
      // copilot adapter's nested output path has somewhere to land.
      ".github/workflows/ci.yml": "",
    });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: true, check: false, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);

    const [
      agentsMd,
      claudeMd,
      cursorrules,
      copilotInstructions,
      geminiMd,
      expectedAgentsMd,
      expectedClaudeMd,
      expectedCursor,
      expectedCopilot,
      expectedGemini,
    ] = await Promise.all([
      readFile(join(root, "AGENTS.md"), "utf8"),
      readFile(join(root, "CLAUDE.md"), "utf8"),
      readFile(join(root, ".cursorrules"), "utf8"),
      readFile(join(root, ".github/copilot-instructions.md"), "utf8"),
      readFile(join(root, "GEMINI.md"), "utf8"),
      readFile(join(process.cwd(), "tests/fixtures/generate/expected-agents-md.txt"), "utf8"),
      readFile(join(process.cwd(), "tests/fixtures/generate/expected-claude-md.txt"), "utf8"),
      readFile(join(process.cwd(), "tests/fixtures/generate/expected-cursor.txt"), "utf8"),
      readFile(
        join(process.cwd(), "tests/fixtures/generate/expected-copilot-instructions.txt"),
        "utf8",
      ),
      readFile(join(process.cwd(), "tests/fixtures/generate/expected-gemini-md.txt"), "utf8"),
    ]);
    expect(agentsMd).toBe(expectedAgentsMd);
    expect(claudeMd).toBe(expectedClaudeMd);
    expect(cursorrules).toBe(expectedCursor);
    expect(copilotInstructions).toBe(expectedCopilot);
    expect(geminiMd).toBe(expectedGemini);
  });

  it("matches the golden fixtures for a contract with adversarial Markdown content", async () => {
    const { root } = await repo({
      "agent-ready.yaml": await readFile(
        join(process.cwd(), "examples/adversarial-content/agent-ready.yaml"),
        "utf8",
      ),
      "docs/notes (draft).md": await readFile(
        join(process.cwd(), "examples/adversarial-content/docs/notes (draft).md"),
        "utf8",
      ),
      ".github/workflows/ci.yml": "",
    });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: false, write: true, check: false, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.SUCCESS);

    const [
      agentsMd,
      claudeMd,
      cursorrules,
      copilotInstructions,
      geminiMd,
      expectedAgentsMd,
      expectedClaudeMd,
      expectedCursor,
      expectedCopilot,
      expectedGemini,
    ] = await Promise.all([
      readFile(join(root, "AGENTS.md"), "utf8"),
      readFile(join(root, "CLAUDE.md"), "utf8"),
      readFile(join(root, ".cursorrules"), "utf8"),
      readFile(join(root, ".github/copilot-instructions.md"), "utf8"),
      readFile(join(root, "GEMINI.md"), "utf8"),
      readFile(
        join(process.cwd(), "tests/fixtures/generate/expected-adversarial-agents-md.txt"),
        "utf8",
      ),
      readFile(
        join(process.cwd(), "tests/fixtures/generate/expected-adversarial-claude-md.txt"),
        "utf8",
      ),
      readFile(
        join(process.cwd(), "tests/fixtures/generate/expected-adversarial-cursor.txt"),
        "utf8",
      ),
      readFile(
        join(
          process.cwd(),
          "tests/fixtures/generate/expected-adversarial-copilot-instructions.txt",
        ),
        "utf8",
      ),
      readFile(
        join(process.cwd(), "tests/fixtures/generate/expected-adversarial-gemini-md.txt"),
        "utf8",
      ),
    ]);
    expect(agentsMd).toBe(expectedAgentsMd);
    expect(claudeMd).toBe(expectedClaudeMd);
    expect(cursorrules).toBe(expectedCursor);
    expect(copilotInstructions).toBe(expectedCopilot);
    expect(geminiMd).toBe(expectedGemini);
  });

  it("reports GENERATE_WRITE_FAILED when copilot's target directory doesn't exist", async () => {
    const { root } = await repo({
      "agent-ready.yaml": [
        "version: 1",
        "project:",
        "  name: generate-example",
        "adapters:",
        "  copilot:",
        "    enabled: true",
        "",
      ].join("\n"),
    });
    const outcome = await runGenerate(
      new NodeFileSystem(),
      { json: true, write: true, check: false, force: false },
      root,
    );
    expect(outcome.exitCode).toBe(ExitCode.INTERNAL_ERROR);
    expect(outcome.stdout).toContain("GENERATE_WRITE_FAILED");
    const body = JSON.parse(outcome.stdout) as { files: { status: string }[] };
    expect(body.files.map((f) => f.status)).toEqual(["refused"]);
    expect(await readIfExists(join(root, ".github/copilot-instructions.md"))).toBeUndefined();
  });
});
