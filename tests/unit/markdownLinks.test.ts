import { describe, expect, it } from "vitest";
import { extractMarkdownLinks } from "../../src/analyze/markdownLinks.js";

describe("extractMarkdownLinks", () => {
  it("extracts inline, image, angle-bracket, and reference-definition destinations", () => {
    const links = extractMarkdownLinks(
      [
        "[Guide](docs/guide.md)",
        '![Diagram](images/flow.png "Flow")',
        "[Draft](<docs/notes (draft).md>)",
        '[reference]: docs/reference.md "Reference"',
      ].join("\n"),
    );

    expect(links.map((link) => link.destination)).toEqual([
      "docs/guide.md",
      "images/flow.png",
      "docs/notes (draft).md",
      "docs/reference.md",
    ]);
    expect(links.map(({ line, column }) => ({ line, column }))).toEqual([
      { line: 1, column: 9 },
      { line: 2, column: 12 },
      { line: 3, column: 10 },
      { line: 4, column: 14 },
    ]);
  });

  it("ignores link-shaped content in fenced and inline code", () => {
    const links = extractMarkdownLinks(
      ["`[inline](missing.md)`", "```md", "[fenced](missing.md)", "```", "[real](present.md)"].join(
        "\n",
      ),
    );
    expect(links.map((link) => link.destination)).toEqual(["present.md"]);
  });

  it("handles balanced parentheses and Markdown escapes", () => {
    const links = extractMarkdownLinks("[one](docs/function_(draft).md) [two](docs/a\\(b\\).md)");
    expect(links.map((link) => link.destination)).toEqual([
      "docs/function_(draft).md",
      "docs/a(b).md",
    ]);
  });

  it("does not treat an unclosed destination as a link", () => {
    expect(extractMarkdownLinks("[broken](docs/file.md")).toEqual([]);
    expect(extractMarkdownLinks("[invalid](docs/my file.md)")).toEqual([]);
    expect(extractMarkdownLinks("ordinary text ](not-a-link.md)")).toEqual([]);
    expect(extractMarkdownLinks("\\[escaped\\](not-a-link.md)")).toEqual([]);
  });
});
