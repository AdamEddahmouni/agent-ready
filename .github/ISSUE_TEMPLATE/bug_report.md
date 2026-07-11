---
name: Bug report
about: Report a bug in the Agent-Ready CLI, schema, or documentation
title: "[bug] "
labels: bug
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to file a bug report! Before submitting,
        please search existing issues to avoid duplicates.
  - type: textarea
    id: description
    attributes:
      label: Description
      description: A clear description of the bug and what you expected to happen.
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Reproduction
      description: |
        Minimal steps to reproduce. Include the `agent-ready.yaml` contract
        (or a minimal version) and the exact command you ran.
      value: |
        ```yaml
        # agent-ready.yaml (minimal reproduction)
        ```
        ```sh
        agent-ready <command> [flags]
        ```
    validations:
      required: true
  - type: textarea
    id: output
    attributes:
      label: Diagnostic output
      description: |
        Paste the full `--json` output if applicable. This helps us pinpoint
        the exact diagnostic code and field.
    validations:
      required: false
  - type: input
    id: version
    attributes:
      label: Agent-Ready version
      description: Run `agent-ready --version` or check `package.json`.
      placeholder: "0.4.0-beta.4"
    validations:
      required: true
  - type: input
    id: environment
    attributes:
      label: Environment
      description: OS and Node.js version.
      placeholder: "Ubuntu 24.04, Node 22.4.0"
    validations:
      required: true
---
