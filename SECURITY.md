# Security Policy

## Scope

Agent-Ready parses, validates, normalizes, inspects, and generates files from
a local `agent-ready.yaml` contract. It can inspect Git state, probe declared
tool versions, and execute the contract's declared verification pipeline only
when the operator explicitly runs `agent-ready verify --execute`. Other
commands do not execute contract-declared commands. Agent-Ready does not run a
network service, perform runtime network requests, or handle authentication or
user accounts. See
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
- Any way for parsing, validating, or otherwise processing an
  `agent-ready.yaml` contract to cause unexpected command execution;
  arbitrary file read/write outside the intended repository boundary; or a
  crash exploitable for denial of service (for example, an amplification
  attack the YAML-safety measures do not catch).
- Command-selection or process-termination flaws in `verify --execute` that
  cause commands outside `verification.required` to run, allow a timed-out
  process tree to remain active, or execute without explicit opt-in.
- Dependency vulnerabilities with a demonstrated impact on this project's
  usage of them (not just a CVE ID with no relevant code path — CI runs
  `pnpm audit` and dependency updates are tracked via Dependabot, see
  `.github/dependabot.yml`).

Out of scope (by design, not oversight — see the threat model for
rationale):

- `verify --execute` running the commands explicitly named by the contract's
  `verification.required` list. This is intentional, opt-in behavior; report
  execution outside those boundaries.
- Issues requiring local, already-privileged filesystem access to exploit
  (this is a local CLI; the threat model assumes the operator controls
  their own machine).

## Response expectations

This is an early-stage, volunteer-maintained project (see
[GOVERNANCE.md](GOVERNANCE.md)). There is no formal SLA yet; a maintainer
will acknowledge reports as soon as reasonably possible and coordinate
disclosure timing with the reporter.
