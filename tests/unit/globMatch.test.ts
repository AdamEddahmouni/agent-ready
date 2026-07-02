import { describe, expect, it } from "vitest";
import {
  findMatchingPattern,
  matchesAnyPattern,
  matchesGlobPattern,
} from "../../src/contract/globMatch.js";

describe("matchesGlobPattern", () => {
  it("matches a literal path exactly", () => {
    expect(matchesGlobPattern("src/index.ts", "src/index.ts")).toBe(true);
    expect(matchesGlobPattern("src/other.ts", "src/index.ts")).toBe(false);
  });

  it("matches '*' within a single segment only", () => {
    expect(matchesGlobPattern("src/index.ts", "src/*.ts")).toBe(true);
    expect(matchesGlobPattern("src/nested/index.ts", "src/*.ts")).toBe(false);
  });

  it("matches '**' across path segments", () => {
    expect(matchesGlobPattern("src/a/b/index.ts", "src/**")).toBe(true);
    expect(matchesGlobPattern("src/index.ts", "src/**")).toBe(true);
  });

  it("matches '**/' prefix at any depth, including zero", () => {
    expect(matchesGlobPattern("foo.ts", "**/foo.ts")).toBe(true);
    expect(matchesGlobPattern("a/b/foo.ts", "**/foo.ts")).toBe(true);
  });

  it("matches '/**' as zero-or-more middle segments", () => {
    expect(matchesGlobPattern("a/b", "a/**/b")).toBe(true);
    expect(matchesGlobPattern("a/x/b", "a/**/b")).toBe(true);
    expect(matchesGlobPattern("a/x/y/b", "a/**/b")).toBe(true);
    expect(matchesGlobPattern("a/x/y/c", "a/**/b")).toBe(false);
  });

  it("matches '?' as exactly one non-separator character", () => {
    expect(matchesGlobPattern("src/a.ts", "src/?.ts")).toBe(true);
    expect(matchesGlobPattern("src/ab.ts", "src/?.ts")).toBe(false);
    expect(matchesGlobPattern("src/a/b.ts", "src/?.ts")).toBe(false);
  });

  it("matches character classes", () => {
    expect(matchesGlobPattern("src/a.ts", "src/[ab].ts")).toBe(true);
    expect(matchesGlobPattern("src/c.ts", "src/[ab].ts")).toBe(false);
  });

  it("matches negated character classes", () => {
    expect(matchesGlobPattern("src/c.ts", "src/[!ab].ts")).toBe(true);
    expect(matchesGlobPattern("src/a.ts", "src/[!ab].ts")).toBe(false);
  });

  it("matches brace alternation", () => {
    expect(matchesGlobPattern("src/a/x.ts", "src/{a,b}/*.ts")).toBe(true);
    expect(matchesGlobPattern("src/b/x.ts", "src/{a,b}/*.ts")).toBe(true);
    expect(matchesGlobPattern("src/c/x.ts", "src/{a,b}/*.ts")).toBe(false);
  });

  it("treats a leading '!' as a category marker, not part of the glob body", () => {
    expect(matchesGlobPattern("dist/keep.txt", "!dist/keep.txt")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(matchesGlobPattern("SRC/index.ts", "src/index.ts")).toBe(false);
  });

  it("does not match a directory prefix against a more specific pattern", () => {
    expect(matchesGlobPattern("src", "src/*.ts")).toBe(false);
  });
});

describe("findMatchingPattern / matchesAnyPattern", () => {
  it("returns undefined when nothing matches", () => {
    expect(findMatchingPattern("src/index.ts", ["dist/**"])).toBeUndefined();
    expect(matchesAnyPattern("src/index.ts", ["dist/**"])).toBe(false);
  });

  it("returns the matching pattern", () => {
    expect(findMatchingPattern("dist/output.js", ["dist/**"])).toBe("dist/**");
    expect(matchesAnyPattern("dist/output.js", ["dist/**"])).toBe(true);
  });

  it("applies last-match-wins negation semantics", () => {
    const patterns = ["dist/**", "!dist/keep.txt"];
    expect(matchesAnyPattern("dist/output.js", patterns)).toBe(true);
    expect(matchesAnyPattern("dist/keep.txt", patterns)).toBe(false);
    expect(findMatchingPattern("dist/keep.txt", patterns)).toBeUndefined();
  });

  it("respects pattern order for last-match-wins, not list position generally", () => {
    const patterns = ["!dist/keep.txt", "dist/**"];
    // Here the broad pattern comes after the negation, so it wins back.
    expect(matchesAnyPattern("dist/keep.txt", patterns)).toBe(true);
  });
});
