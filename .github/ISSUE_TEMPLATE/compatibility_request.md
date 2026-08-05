---
name: Compatibility or adapter request
about: Report an incompatibility with a coding agent, runtime, platform, or repository shape
title: "[compat] "
labels: enhancement, compatibility
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting a compatibility issue or requesting adapter
        support. Before submitting, please check
        [ROADMAP.md](https://github.com/AdamEddahmouni/agent-ready/blob/main/ROADMAP.md)
        and the [adapter list](https://github.com/AdamEddahmouni/agent-ready/blob/main/README.md#vendor-neutral)
        — some adapters are declarable-but-unimplemented by design.
  - type: textarea
    id: target
    attributes:
      label: Target tool / environment
      description: |
        Which coding agent, runtime, operating system, or repository shape is
        incompatible or unsupported? Name the exact tool and version.
      placeholder: "e.g. Cursor 1.2 on Windows 11, or a monorepo with nested package.json files"
    validations:
      required: true
  - type: textarea
    id: problem
    attributes:
      label: What goes wrong
      description: |
        What did you expect, and what actually happened? Include the exact
        command you ran and any error or diagnostic output.
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Reproduction
      description: |
        A minimal `agent-ready.yaml` (or a link to a public reproduction
        repository) that demonstrates the problem.
      value: |
        ```yaml
        # agent-ready.yaml (minimal reproduction)
        ```
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Agent-Ready version
      description: Run `agent-ready --version` or check `package.json`.
      placeholder: "0.6.0"
    validations:
      required: true
  - type: input
    id: environment
    attributes:
      label: Environment
      description: OS, Node.js version, and (if relevant) the target tool's version.
      placeholder: "Ubuntu 24.04, Node 22.4.0, Cursor 1.2"
    validations:
      required: true
  - type: markdown
    attributes:
      value: |
        **Security note:** if your report describes a security
        vulnerability (for example, contract content causing unintended
        file writes or command execution), do **not** post it here — use
        the private process in [SECURITY.md](https://github.com/AdamEddahmouni/agent-ready/blob/main/SECURITY.md).
        Only share non-sensitive reproduction details in this issue.
---
