import { spawnSync } from "node:child_process";

const USAGE =
  "Usage: node scripts/check-commit-signing.mjs [--range <rev-range>] [--base <sha>] [--head <sha>]";
const SIGNATURE_HEADER = /^gpgsig(?:-sha256)? /mu;

function parseOptions(argv) {
  const options = { head: "HEAD" };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--range", "--base", "--head"].includes(name)) {
      return { error: `Unknown option: ${name}` };
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { error: `${name} requires a value` };
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

function refExists(ref) {
  return git(["rev-parse", "--verify", "--quiet", ref]).status === 0;
}

function fail(code, message) {
  process.stderr.write(message);
  process.exitCode = code;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.error !== undefined) {
    fail(2, `${options.error}.\n${USAGE}\n`);
    return;
  }

  let range = options.range;
  let tipOnly = false;
  if (range === undefined) {
    if (options.base !== undefined) {
      range = `${options.base}..${options.head}`;
    } else if (refExists("origin/main")) {
      range = `origin/main..${options.head}`;
    } else if (refExists("main")) {
      range = `main..${options.head}`;
    } else {
      // No base branch to compare against: check the tip only rather than
      // claiming the whole history is clean. `range` is a revision here, not a
      // range, so the log has to be limited explicitly.
      range = options.head;
      tipOnly = true;
    }
  }

  const format = "--format=%H%x09%s";
  const log = tipOnly
    ? git(["log", "--max-count=1", format, range])
    : git(["log", "--reverse", format, range]);
  if (log.error !== undefined || log.status !== 0) {
    fail(2, `Could not list commits in ${range}:\n${log.error?.message ?? log.stderr.trim()}\n`);
    return;
  }

  const commits = log.stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, ...subject] = line.split("\t");
      return { sha, subject: subject.join("\t") };
    });

  if (commits.length === 0) {
    process.stdout.write(`No commits to check in ${range}.\n`);
    return;
  }

  // A commit object carries a `gpgsig` (or `gpgsig-sha256`) header when it was
  // signed. Presence only: git cannot verify an SSH signature without an
  // `allowedSignersFile`, nor a GPG signature whose key is not in the local
  // keyring, so validity stays GitHub's job.
  const unsigned = [];
  for (const commit of commits) {
    const object = git(["cat-file", "commit", commit.sha]);
    if (object.error !== undefined || object.status !== 0) {
      fail(
        2,
        `Could not read commit ${commit.sha}. A shallow clone may be missing it; fetch the full ` +
          `history (actions/checkout with fetch-depth: 0, or git fetch --unshallow).\n` +
          `${object.error?.message ?? object.stderr.trim()}\n`,
      );
      return;
    }
    if (!SIGNATURE_HEADER.test(object.stdout)) {
      unsigned.push(commit);
    }
  }

  if (unsigned.length > 0) {
    fail(
      1,
      `main requires every commit to carry a verified signature (required_signatures).\n` +
        `${String(unsigned.length)} of ${String(commits.length)} commit(s) in ${range} have no signature:\n` +
        unsigned.map((commit) => `  ${commit.sha.slice(0, 12)} ${commit.subject}`).join("\n") +
        "\n\n" +
        "Configure signing once, then re-sign the branch:\n" +
        "  git config --global gpg.format ssh\n" +
        "  git config --global user.signingkey ~/.ssh/id_ed25519.pub\n" +
        "  git config --global commit.gpgsign true\n" +
        "  git rebase --exec 'git commit --amend --no-edit -S' origin/main\n" +
        "  git push --force-with-lease\n\n" +
        "Add the public key to GitHub under Settings -> SSH and GPG keys -> New SSH key,\n" +
        "choosing the signing key type. This check only proves a signature is present;\n" +
        "GitHub still requires the key on the committing account to mark it verified.\n" +
        "https://docs.github.com/authentication/managing-commit-signature-verification\n",
    );
    return;
  }

  process.stdout.write(
    `All ${String(commits.length)} commit(s) in ${range} carry a signature.\n` +
      "Presence only: GitHub still requires the signing key on the committing account.\n",
  );
}

main();
