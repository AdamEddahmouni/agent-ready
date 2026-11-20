import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentReadyCliError,
  BUILD_INFO_FILE,
  packageRootOf,
  verifyAgentReadyCli,
} from "../../research/phase1-benchmark/harness/agentReadyCli.js";
import { removeTree } from "../../src/filesystem/removeTree.js";

const PIN = "2a0515e1f01af61d1379dfe8149b30227769d533";

interface FixtureOptions {
  readonly commit?: string;
  readonly dirty?: boolean;
  readonly stamp?: boolean;
  readonly name?: string;
}

async function makePackage(options: FixtureOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase1-cli-"));
  await mkdir(join(root, "dist", "cli"), { recursive: true });
  await writeFile(join(root, "dist", "cli", "index.js"), "#!/usr/bin/env node\n", "utf8");
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: options.name ?? "@adameddahmouni/agent-ready", version: "0.6.1" })}\n`,
    "utf8",
  );
  if (options.stamp !== false) {
    await writeFile(
      join(root, BUILD_INFO_FILE),
      `${JSON.stringify({ commit: options.commit ?? PIN, dirty: options.dirty ?? false, version: "0.6.1" })}\n`,
      "utf8",
    );
  }
  return root;
}

describe("agent-ready CLI pin", () => {
  it("accepts a stamped build of the pinned commit", async () => {
    const root = await makePackage();
    try {
      const verified = await verifyAgentReadyCli({
        cliPath: join(root, "dist", "cli", "index.js"),
        pinnedCommit: PIN,
      });
      expect(verified.packageRoot).toBe(root);
      expect(verified.buildInfo.commit).toBe(PIN);
      expect(verified.buildInfo.dirty).toBe(false);
      expect(packageRootOf(verified.cliPath)).toBe(root);
    } finally {
      await removeTree(root);
    }
  });

  it("refuses a dist with no build stamp", async () => {
    const root = await makePackage({ stamp: false });
    try {
      await expect(
        verifyAgentReadyCli({ cliPath: join(root, "dist", "cli", "index.js"), pinnedCommit: PIN }),
      ).rejects.toThrow(/carries no/);
    } finally {
      await removeTree(root);
    }
  });

  it("refuses a build of another commit", async () => {
    const root = await makePackage({ commit: "b".repeat(40) });
    try {
      await expect(
        verifyAgentReadyCli({ cliPath: join(root, "dist", "cli", "index.js"), pinnedCommit: PIN }),
      ).rejects.toThrow(/manifest pins/);
    } finally {
      await removeTree(root);
    }
  });

  it("refuses a dirty build of the right commit", async () => {
    const root = await makePackage({ dirty: true });
    try {
      await expect(
        verifyAgentReadyCli({ cliPath: join(root, "dist", "cli", "index.js"), pinnedCommit: PIN }),
      ).rejects.toThrow(/modified tree/);
    } finally {
      await removeTree(root);
    }
  });

  it("refuses a path that is not an agent-ready build", async () => {
    const root = await makePackage();
    try {
      await expect(
        verifyAgentReadyCli({ cliPath: join(root, "dist"), pinnedCommit: PIN }),
      ).rejects.toThrow(AgentReadyCliError);
      await expect(
        verifyAgentReadyCli({
          cliPath: join(root, "missing", "cli", "index.js"),
          pinnedCommit: PIN,
        }),
      ).rejects.toThrow(/no CLI at/);
      const other = await makePackage({ name: "not-agent-ready" });
      try {
        await expect(
          verifyAgentReadyCli({
            cliPath: join(other, "dist", "cli", "index.js"),
            pinnedCommit: PIN,
          }),
        ).rejects.toThrow(/does not look like/);
      } finally {
        await removeTree(other);
      }
    } finally {
      await removeTree(root);
    }
  });
});
