import { readFile, writeFile } from "node:fs/promises";

const [version, outputPath] = process.argv.slice(2);
if (version === undefined || outputPath === undefined) {
  throw new Error("Usage: node scripts/extract-release-notes.mjs <version> <output-path>");
}

const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const heading = new RegExp(`^## ${escapedVersion}(?:\\s+-.*)?$`, "mu");
const match = heading.exec(changelog);
if (match?.index === undefined) {
  throw new Error(`CHANGELOG.md has no section for ${version}.`);
}

const bodyStart = match.index + match[0].length;
const remainder = changelog.slice(bodyStart);
const nextHeading = /^##\s+/mu.exec(remainder);
const body = (nextHeading === null ? remainder : remainder.slice(0, nextHeading.index)).trim();
if (body.length === 0) {
  throw new Error(`CHANGELOG.md section ${version} is empty.`);
}

await writeFile(
  outputPath,
  `# Agent-Ready ${version}\n\n${body}\n\n## Release assets\n\n` +
    `- The npm-compatible package tarball contains the CLI, library, schema, and compatibility corpus.\n` +
    `- The standalone compatibility-corpus archive supports downstream adapter conformance testing.\n`,
  "utf8",
);
