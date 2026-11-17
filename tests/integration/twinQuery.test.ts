import { describe, expect, it, vi } from "vitest";
import { runTwinQuery } from "../../src/cli/commands/twinQuery.js";
import { InMemoryFileSystem } from "../../src/filesystem/inMemoryFileSystem.js";
import { loadCorpus, runCase } from "../../src/conformance/discovery.js";

describe("twin query is snapshot-only", () => {
  it("answers from a snapshot after the repository is gone from the filesystem", async () => {
    const entry = loadCorpus(1).find((candidate) => candidate.metadata.name === "minimal-package");
    if (entry === undefined) throw new Error("minimal-package case missing");
    const snapshotText = await runCase(entry);
    const fs = new InMemoryFileSystem("/");
    fs.addFile("/only.snapshot.json", snapshotText);

    const outcome = await runTwinQuery(fs, {
      snapshot: "/only.snapshot.json",
      kind: "summary",
      json: true,
    });
    expect(outcome.exitCode).toBe(0);
    const body = JSON.parse(outcome.stdout) as { result: { complete?: boolean } };
    expect(body.result.complete).toBe(true);
  });

  it("does not read the repository when querying", async () => {
    const entry = loadCorpus(1).find((candidate) => candidate.metadata.name === "minimal-package");
    if (entry === undefined) throw new Error("minimal-package case missing");
    const snapshotText = await runCase(entry);
    const fs = new InMemoryFileSystem("/");
    fs.addFile("/snap.json", snapshotText);
    const readSpy = vi.spyOn(fs, "readTextFile");
    await runTwinQuery(fs, {
      snapshot: "/snap.json",
      kind: "packages",
      json: true,
    });
    expect(readSpy.mock.calls.map((call) => call[0])).toEqual(["/snap.json"]);
    readSpy.mockRestore();
  });
});

describe("twin query epistemic preservation", () => {
  it("returns the command inventory fact without flattening package manager state", async () => {
    const entry = loadCorpus(1).find(
      (candidate) => candidate.metadata.name === "package-manager-conflict",
    );
    if (entry === undefined) throw new Error("package-manager-conflict case missing");
    const fs = new InMemoryFileSystem("/");
    fs.addFile("/snap.json", await runCase(entry));
    const outcome = await runTwinQuery(fs, {
      snapshot: "/snap.json",
      kind: "package",
      parameter: ".",
      json: true,
    });
    expect(outcome.exitCode).toBe(0);
    const body = JSON.parse(outcome.stdout) as { result: Record<string, unknown> };
    expect(body.result["path"]).toBe(".");
  });
});
