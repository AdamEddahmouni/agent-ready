---
name: Feature request
about: Propose a new feature or enhancement for Agent-Ready
title: "[feature] "
labels: enhancement
body:
  - type: markdown
    attributes:
      value: |
        Thanks for the feature request! Please check
        [ROADMAP.md](https://github.com/AdamEddahmouni/agent-ready-repo/blob/main/ROADMAP.md)
        first — items listed under "Strict non-goals" are intentionally out
        of scope for the current phase.
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What problem does this feature solve? What's the current workaround?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
      description: Describe what you'd like to see, and how it would work.
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: What other approaches have you considered?
    validations:
      required: false
  - type: dropdown
    id: surface
    attributes:
      label: Affected surface
      description: Which part of Agent-Ready does this touch?
      multiple: true
      options:
        - CLI command
        - JSON Schema / contract
        - Diagnostic codes
        - Adapters (AGENTS.md, CLAUDE.md, .cursorrules, Copilot, Gemini)
        - Documentation
        - CI / GitHub Action
        - Other
    validations:
      required: true
---
