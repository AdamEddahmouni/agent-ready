import { describe, expect, it } from "vitest";
import semver from "semver";
import { normalizeVersion } from "../../src/binary/nodeBinaryClient.js";

/**
 * Version-string normalization for every `BinaryTarget`. The fixture
 * strings are the literal first lines these binaries print, so a change in
 * normalization that would break a real `doctor` run fails here first.
 *
 * Doctor feeds `normalizeVersion`'s result straight to `semver.satisfies`
 * (ADR-0023), so the non-git targets additionally assert that the result is
 * range-comparable rather than merely string-equal.
 */
describe("normalizeVersion", () => {
  describe("git (ADR-0023: keeps the literal `git version` prefix)", () => {
    it("passes through the prefixed form verbatim", () => {
      expect(normalizeVersion("git", "git version 2.43.0\n")).toBe("git version 2.43.0");
    });

    it("adds the prefix when the binary omits it", () => {
      expect(normalizeVersion("git", "2.43.0\n")).toBe("git version 2.43.0");
    });

    it("keeps platform suffixes git appends on some builds", () => {
      expect(normalizeVersion("git", "git version 2.43.0.windows.1\n")).toBe(
        "git version 2.43.0.windows.1",
      );
    });
  });

  describe("generic targets (pnpm/npm/yarn/python/cargo)", () => {
    it.each([
      ["pnpm", "10.5.0\n", "10.5.0"],
      ["npm", "10.9.2\n", "10.9.2"],
      ["yarn", "4.6.0\n", "4.6.0"],
      // Older package managers printed `<name> <version>`.
      ["pnpm", "pnpm 8.15.4\n", "8.15.4"],
      // ADR-0038 confirmed these two already fit the generic branch with no
      // target-specific code — these cases are what that claim rests on.
      ["python", "Python 3.13.14\n", "3.13.14"],
      ["cargo", "cargo 1.96.0 (30a34c682 2026-05-25)\n", "1.96.0"],
    ] as const)("normalizes %s output %j to %j", (target, raw, expected) => {
      expect(normalizeVersion(target, raw)).toBe(expected);
    });

    it("takes only the first line when the binary prints trailing content", () => {
      expect(normalizeVersion("pnpm", "9.0.0\nUpdate available!\n")).toBe("9.0.0");
    });

    it("returns an empty string for empty output rather than throwing", () => {
      expect(normalizeVersion("pnpm", "")).toBe("");
    });
  });

  describe("go (ADR-0038: `go version goX.Y.Z OS/ARCH`)", () => {
    it.each([
      ["go version go1.22.0 linux/amd64\n", "1.22.0"],
      ["go version go1.25.3 windows/amd64\n", "1.25.3"],
      ["go version go1.24.1 darwin/arm64\n", "1.24.1"],
    ] as const)("extracts the version from %j", (raw, expected) => {
      expect(normalizeVersion("go", raw)).toBe(expected);
    });

    it("appends a patch component to Go's two-component initial releases", () => {
      // Go ships `go1.21` before any `go1.21.1` exists, and
      // `semver.satisfies` rejects a bare two-component version.
      expect(normalizeVersion("go", "go version go1.21 linux/amd64\n")).toBe("1.21.0");
    });

    it("does not mistake the literal word `version` for the version", () => {
      // The generic branch would return "version" here — this is precisely
      // why `go` needs its own branch.
      expect(normalizeVersion("go", "go version go1.22.0 linux/amd64\n")).not.toBe("version");
    });
  });

  describe("results are semver-range comparable, as doctor requires", () => {
    it.each([
      ["python", "Python 3.13.14\n", ">=3.10"],
      ["cargo", "cargo 1.96.0 (30a34c682 2026-05-25)\n", ">=1.90"],
      ["go", "go version go1.22.0 linux/amd64\n", ">=1.22"],
      ["go", "go version go1.21 linux/amd64\n", ">=1.21"],
      ["pnpm", "10.5.0\n", "10"],
    ] as const)("%s output %j satisfies %j", (target, raw, range) => {
      const version = normalizeVersion(target, raw);
      expect(semver.valid(version), `${version} should be valid semver`).not.toBeNull();
      expect(semver.satisfies(version, range, { includePrerelease: true })).toBe(true);
    });
  });
});
