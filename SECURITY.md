# Security Policy

## Scope

Agent-Ready's current foundation (Phase 0/1) parses, validates,
normalizes, and inspects a local `agent-ready.yaml` contract. It does not
execute repository commands, does not run a network service, and does not
handle authentication or user accounts. See
[docs/security/threat-model.md](docs/security/threat-model.md) for the
full threat model, trust boundaries, and known limitations.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Instead, report it privately using one of:

- GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
  feature on this repository (Security tab → "Report a vulnerability"),
  if enabled.
- If that is not available, open an issue titled only "Security contact
  needed" with no vulnerability details, and a maintainer will follow up
  with a private channel.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, including a minimal `agent-ready.yaml` or CLI
  invocation if applicable.
- The Agent-Ready version, Node.js version, and OS.

## What to report here

In scope:

- Path traversal or absolute-path escapes not caught by the validator
  (see [docs/specification/paths-and-globs.md](docs/specification/paths-and-globs.md)).
- Any way for parsing or validating an `agent-ready.yaml` contract to
  result in code execution, arbitrary file read/write outside the
  intended repository boundary, or a crash exploitable for denial of
  service (e.g. an amplification attack the YAML-safety measures don't
  catch).
- Dependency vulnerabilities with a demonstrated impact on this project's
  usage of them (not just a CVE ID with no relevant code path — CI runs
  `pnpm audit` and dependency updates are tracked via Dependabot, see
  `.github/dependabot.yml`).

Out of scope (by design, not oversight — see the threat model for
rationale):

- "The CLI doesn't execute repository commands" — that's intentional in
  this phase, not a bug.
- Issues requiring local, already-privileged filesystem access to exploit
  (this is a local CLI; the threat model assumes the operator controls
  their own machine).

## Response expectations

This is an early-stage, volunteer-maintained project (see
[GOVERNANCE.md](GOVERNANCE.md)). There is no formal SLA yet; a maintainer
will acknowledge reports as soon as reasonably possible and coordinate
disclosure timing with the reporter.
