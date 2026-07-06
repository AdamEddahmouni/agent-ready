import { describe, expect, it } from "vitest";
import { normalizeContract } from "../../src/contract/normalize.js";
import type { RawContract } from "../../src/contract/types.js";
import {
  escapeMarkdownText,
  renderMarkdownLink,
  wrapCodeSpan,
} from "../../src/generate/adapters/escape.js";
import { renderAgentsMd } from "../../src/generate/adapters/agentsMd.js";
import { renderClaude } from "../../src/generate/adapters/claude.js";
import { renderCopilot } from "../../src/generate/adapters/copilot.js";
import { renderCursor } from "../../src/generate/adapters/cursor.js";
import { renderGemini } from "../../src/generate/adapters/gemini.js";
import { GENERATED_FILE_MARKER } from "../../src/generate/marker.js";

describe("escapeMarkdownText", () => {
  it.each([
    ["# heading", "\\# heading"],
    ["   # indented heading", "   \\# indented heading"],
    ["- list item", "\\- list item"],
    ["+ list item", "\\+ list item"],
    ["1. ordered item", "\\1. ordered item"],
    ["1) ordered item", "\\1) ordered item"],
    ["> blockquote", "\\> blockquote"],
    ["```fence", "\\`\\`\\`fence"],
    ["~~~fence", "\\~\\~\\~fence"],
    ["plain text", "plain text"],
    ["#hashtag-no-space", "#hashtag-no-space"],
  ])("escapes block-starting marker in %j", (input, expected) => {
    expect(escapeMarkdownText(input)).toBe(expected);
  });

  it.each([
    ["contains ` backtick", "contains \\` backtick"],
    ["contains * emphasis *", "contains \\* emphasis \\*"],
    ["contains _ emphasis _", "contains \\_ emphasis \\_"],
    ["contains [brackets]", "contains \\[brackets\\]"],
    ["contains <tags>", "contains \\<tags\\>"],
    ["contains ~strike~", "contains \\~strike\\~"],
    ["contains \\ backslash", "contains \\\\ backslash"],
  ])("escapes inline-significant characters in %j", (input, expected) => {
    expect(escapeMarkdownText(input)).toBe(expected);
  });

  it("collapses embedded newlines into a single space", () => {
    expect(escapeMarkdownText("line one\nline two")).toBe("line one line two");
    expect(escapeMarkdownText("line one\r\nline two")).toBe("line one line two");
    expect(escapeMarkdownText("line one\rline two")).toBe("line one line two");
  });

  it("neutralizes the literal managed-file marker string", () => {
    const escaped = escapeMarkdownText(GENERATED_FILE_MARKER);
    expect(escaped).not.toBe(GENERATED_FILE_MARKER);
    expect(escaped.includes(GENERATED_FILE_MARKER)).toBe(false);
  });

  it("is the identity function for plain, unremarkable text", () => {
    expect(escapeMarkdownText("A perfectly ordinary description.")).toBe(
      "A perfectly ordinary description.",
    );
  });
});

describe("wrapCodeSpan", () => {
  it("wraps plain content in a single backtick pair", () => {
    expect(wrapCodeSpan("pnpm lint")).toBe("`pnpm lint`");
  });

  it("uses a two-backtick fence when content has one backtick", () => {
    const result = wrapCodeSpan("echo `date`");
    expect(result).toBe("`` echo `date` ``");
  });

  it("uses a longer fence than the longest run of consecutive backticks", () => {
    const result = wrapCodeSpan("a `` b ``` c");
    const fenceMatch = /^`+/.exec(result);
    expect(fenceMatch).not.toBeNull();
    const fenceLength = fenceMatch?.[0].length ?? 0;
    expect(fenceLength).toBeGreaterThan(3);
  });

  it("pads with a space when content starts or ends with a backtick", () => {
    expect(wrapCodeSpan("`leading")).toBe("`` `leading ``");
    expect(wrapCodeSpan("trailing`")).toBe("`` trailing` ``");
  });

  it("does not pad when there is no backtick in the content", () => {
    expect(wrapCodeSpan("dist/**")).toBe("`dist/**`");
  });
});

describe("renderMarkdownLink", () => {
  it("renders a plain path identically to the original format", () => {
    expect(renderMarkdownLink("README.md")).toBe("[README.md](README.md)");
  });

  it("uses the angle-bracket destination form for a path containing a space", () => {
    expect(renderMarkdownLink("docs/notes (draft).md")).toBe(
      "[docs/notes (draft).md](<docs/notes (draft).md>)",
    );
  });

  it("escapes brackets in the link text", () => {
    expect(renderMarkdownLink("docs/[draft].md")).toBe("[docs/\\[draft\\].md](docs/[draft].md)");
  });
});

const adapters = [
  { name: "agentsMd", render: renderAgentsMd },
  { name: "claude", render: renderClaude },
  { name: "cursor", render: renderCursor },
  { name: "copilot", render: renderCopilot },
  { name: "gemini", render: renderGemini },
];

describe.each(adapters)("$name adapter adversarial-content handling", ({ render }) => {
  it("does not render a contract-name heading as a real Markdown heading", () => {
    const raw: RawContract = { version: 1, project: { name: "# fake heading" } };
    const file = render(normalizeContract(raw));
    expect(file.content).not.toContain("\n# fake heading\n");
    expect(file.content).toContain("\\# fake heading");
  });

  it("does not let a description forge the managed-file marker", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example", description: GENERATED_FILE_MARKER },
    };
    const file = render(normalizeContract(raw));
    const occurrences = file.content.split(GENERATED_FILE_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("collapses an embedded newline in the description to one line", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example", description: "first line\nsecond line" },
    };
    const file = render(normalizeContract(raw));
    expect(file.content).toContain("first line second line");
  });

  it("uses a correctly-sized fence for a command.run containing backticks", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      commands: { build: { run: "echo `date`" } },
      adapters: { agentsMd: { enabled: true } },
    };
    const file = render(normalizeContract(raw));
    const fenceMatch = /- \*\*`build`\*\*: (`+) echo `date` \1/.exec(file.content);
    expect(fenceMatch).not.toBeNull();
    expect(fenceMatch?.[1]?.length ?? 0).toBeGreaterThan(1);
  });

  it("uses the angle-bracket link form for an instruction source with a space", () => {
    const raw: RawContract = {
      version: 1,
      project: { name: "example" },
      instructions: { sources: ["docs/notes (draft).md"] },
    };
    const file = render(normalizeContract(raw));
    expect(file.content).toContain("[docs/notes (draft).md](<docs/notes (draft).md>)");
  });
});
