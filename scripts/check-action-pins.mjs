import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const SHA_PIN = /^[^\s@]+@[0-9a-f]{40}$/u;

const files = [join(REPO_ROOT, "action.yml"), ...(await workflowFiles())];
const violations = [];

for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const match = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/u.exec(line);
    const reference = match?.[1];
    if (
      reference === undefined ||
      reference.startsWith("./") ||
      reference.startsWith("docker://") ||
      SHA_PIN.test(reference)
    ) {
      continue;
    }
    violations.push(
      `${relative(REPO_ROOT, file).replaceAll("\\", "/")}:${String(index + 1)}: ${reference}`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(
    "GitHub Action references must use immutable 40-character commit SHAs:\n" +
      violations.map((violation) => `  ${violation}`).join("\n") +
      "\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified immutable pins in ${String(files.length)} action files.\n`);
}

async function workflowFiles() {
  const directory = join(REPO_ROOT, ".github", "workflows");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && [".yml", ".yaml"].includes(extname(entry.name)))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}
