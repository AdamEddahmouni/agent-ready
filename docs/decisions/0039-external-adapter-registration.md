# ADR-0039: External adapter registration

## Status

Accepted. Targeted at v0.8.0.

## Context

Agent-Ready ships five adapter renderers (`agentsMd`, `claude`, `cursor`,
`copilot`, `gemini`). Each is a pure function `(contract: NormalizedContract)
=> GeneratedFile`, registered in a module-level `RENDERERS` map in
`src/generate/generate.ts` and selected by the contract's `adapters` block.
Adding a sixth means editing Agent-Ready's source, publishing a release, and
waiting for it — which is the entire adoption barrier for anyone whose agent
tool is not one of the five.

[ROADMAP.md](../../ROADMAP.md)'s own "Long-term open-source direction"
anticipated this: "an adapter/plugin interface, once there is more than one
concrete [downstream consumer]". `plugin/adapter loading` is currently listed
among the strict non-goals, so this ADR formally reopens that non-goal —
narrowly, and updates ROADMAP.md's list in the same PR as required by
[ROADMAP-TO-1.0.md](../../ROADMAP-TO-1.0.md)'s guiding rule.

The narrowness matters. "Plugin system" in the usual sense means lifecycle
hooks, middleware chains, event buses, and a versioned plugin API — a
permanent maintenance surface and a permanent compatibility obligation. None
of that is needed to render a sixth Markdown file. What is needed is one
function call, which the codebase's existing `AdapterRenderer` type already
describes exactly.

Two shipped invariants stand in the way, and both are load-bearing rather
than incidental. Naming them precisely is most of this decision:

1. **Output paths are adapter-hardcoded.** `GeneratedFile.relativePath` is
   documented as "always adapter-hardcoded (e.g. `AGENTS.md`), never
   contract-supplied," and `planGeneration` carries a defense-in-depth
   containment check it describes as "expected unreachable in practice, since
   renderers never take path input from the contract"
   ([ADR-0010](0010-generate-write-boundary.md)). A custom adapter must
   declare where its file goes, so that check stops being unreachable and
   becomes a real, reachable boundary.
2. **`planGeneration` is synchronous and file-system-pure** — "never reads or
   writes disk." Loading an external module requires dynamic `import()`,
   which is asynchronous and is itself a read of the file system. Making
   `planGeneration` async to accommodate it would push a boundary violation
   into the one function whose purity the generate pipeline's testability
   rests on.

Checked directly rather than assumed: `RendererRegistry` is already an
exported public type (`Partial<Readonly<Record<AdapterName, AdapterRenderer>>>`),
and `AdapterRenderer` is already the exact signature an external renderer
needs. The seam this ADR needs mostly exists; it is simply not yet a
parameter.

## Decision

Add an optional, additive `adapters.custom` declaration within contract
`version: 1`, and load its renderer through the **existing**
`AdapterRenderer`/`RendererRegistry` types rather than a new plugin
abstraction.

```yaml
adapters:
  claude:
    enabled: true
  custom:
    enabled: true
    renderer: "./agent-ready-adapters/my-adapter.js"
    output: "MY-AGENT.md"
```

### Contract surface

- `adapters.custom` is a new optional key on the existing `adapters` object,
  which is `additionalProperties: false` with five fixed keys today. Adding a
  sixth optional key is additive per
  [ADR-0009](0009-pre-1.0-stability-policy.md): every contract that validates
  today continues to validate, and a contract without `custom` produces
  byte-identical output to v0.7.0.
- Its shape is **not** the shared `adapterDeclaration` `$def` the other five
  use — it adds two required fields, `renderer` and `output`, so it gets its
  own `$def`. Overloading `adapterDeclaration` would make `renderer`/`output`
  syntactically legal on `claude`, where they are meaningless.
- `renderer` is a literal repository-relative path to an ES module. `output`
  is a literal repository-relative output path. Neither accepts globs,
  variables, or absolute paths.
- `AdapterName` widens from the five-name union to include `"custom"`.
  Exactly one custom adapter is supported. A list of them is a
  reconsideration trigger below, not v0.8.0 scope.

### Path validation

Both paths are validated at **semantic-validation time**, before any module
is loaded and before `generate` runs at all, reusing the containment logic
already hardened for this purpose rather than adding a parallel check:

- `renderer` and `output` both resolve inside the repository root, using the
  same lexical-traversal rejection `normalizePathPattern`
  (`src/contract/paths.ts`) already applies, per
  [ADR-0005](0005-path-and-glob-semantics.md).
- `output` additionally goes through the write-boundary enforcement in
  `src/filesystem/nodeFileSystem.ts` — real-parent resolution and symlink-target
  refusal — exactly as the five built-in output paths do. A custom adapter
  gets **no** weaker write boundary than a built-in one.
- Failure emits `CUSTOM_ADAPTER_OUTPUT_INVALID` at validation time. A
  contract that names an escaping path fails `agent-ready validate`, not just
  `generate`.

This is the point where `planGeneration`'s containment check stops being
"expected unreachable." Its comment and
[ADR-0010](0010-generate-write-boundary.md)'s wording are updated to say so:
the check is now a reachable boundary for `custom` and remains unreachable
for the five built-ins.

### Loading, and why `planGeneration` stays synchronous

The module is loaded via dynamic `import()` in the **CLI layer**, before
planning begins, and injected through a new optional `renderers` parameter on
`planGeneration` that defaults to the existing built-in map:

```ts
planGeneration(contract, repoRoot, renderers?: RendererRegistry): GenerationPlan;
```

`planGeneration` therefore stays synchronous and file-system-pure, and the
one async, disk-touching step lives at the boundary that already owns I/O.
This also means the whole feature is testable with an in-memory registry and
no module loading at all — the same reason `BinaryClient` and `FileSystem`
exist as boundaries.

The renderer contract is deliberately minimal:

- The module must export `render` as a function
  `(contract: NormalizedContract) => GeneratedFile`.
- It is called exactly once per `generate` run. No lifecycle hooks, no
  ordering guarantees relative to built-in adapters, no access to the file
  system, no access to the CLI, no configuration object beyond the contract.
- `GeneratedFile.relativePath` returned by a custom renderer is **ignored**
  in favor of the contract's `output`. The declared path is authoritative, so
  a renderer cannot redirect its own output — this is what keeps path
  authority in the contract, where it can be validated ahead of time.

### Diagnostics

Four new codes. Each is a distinct failure with distinct remediation, in the
same spirit as the existing `PACKAGE_MANAGER_UNAVAILABLE` /
`PACKAGE_MANAGER_VERSION_MISMATCH` split — a single
`CUSTOM_ADAPTER_FAILED` would force one `explain` entry to describe four
unrelated fixes:

- `CUSTOM_ADAPTER_OUTPUT_INVALID` — `renderer` or `output` fails path
  validation. Emitted at validation time.
- `CUSTOM_ADAPTER_LOAD_FAILED` — dynamic `import()` throws, or the module
  loads but exports no `render`, or exports a `render` that is not a
  function. **No silent fallback and no skip**: generation fails. This is
  deliberately unlike `ADAPTER_NOT_YET_IMPLEMENTED`, which warns and skips —
  that code means "Agent-Ready hasn't written this renderer yet," whereas a
  declared custom renderer that won't load is a broken contract.
- `CUSTOM_ADAPTER_RENDER_FAILED` — `render` throws, or returns something
  other than an object with a string `content`.
- `CUSTOM_ADAPTER_MARKER_MISSING` — the rendered content does not contain
  `GENERATED_FILE_MARKER`. Without this check the failure surfaces one run
  later and looks unrelated: the first `--write` succeeds, and the second
  refuses its own output as `unmanaged` (ADR-0010). Failing immediately, with
  a message naming the marker, is the difference between a five-second fix
  and a debugging session.

All four are errors, not warnings.

### Escaping and public API

Markdown-escaping is the custom renderer's responsibility — Agent-Ready
cannot know the target format's escaping rules, and silently escaping on the
renderer's behalf would corrupt a renderer emitting a non-Markdown format.
To make that responsibility dischargeable, `src/index.ts` gains the three
helpers the built-in adapters already use, from
`src/generate/adapters/escape.ts`:

- `escapeMarkdownText`
- `wrapCodeSpan`
- `renderMarkdownLink`

plus `GENERATED_FILE_MARKER`, which is already exported. These carry the same
pre-1.0 experimental-stability caveat as the rest of the public API.

### Security

The renderer is a local file the repository already contains, executed by a
developer running `agent-ready generate` in a checkout they already trust.
That is the same trust boundary as any `devDependency`, any
`package.json` lifecycle script, and any linter plugin — code in the tree
runs when you run the tooling. It is **not** a remote-code-loading
mechanism: `renderer` cannot be a URL, cannot be an absolute path, cannot
escape the repository root, and is never fetched.

`docs/security/threat-model.md` states this explicitly rather than leaving it
implied, and records the one genuinely new exposure: a contributor who can
modify `agent-ready.yaml` and add a file can cause code execution on a
maintainer's machine at `generate` time. Mitigation is review, not
mechanism — the same mitigation that applies to a malicious `postinstall`.
The threat model records why a sandbox is not attempted: a renderer needs the
contract and nothing else, but Node offers no supported in-process sandbox
that is actually a security boundary, and pretending otherwise would be worse
than documenting the trust assumption plainly.

## Alternatives considered

- **A full plugin system** (lifecycle hooks, middleware, event bus,
  registration API): rejected as a permanent maintenance and compatibility
  surface for a problem that is one function call. Explicitly out of scope
  now and permanently, per the non-goals update below.
- **Making `planGeneration` async** so it can `import()` the renderer itself:
  rejected. It would put file-system access inside the one generate-pipeline
  function documented as pure with respect to the file system, and would make
  every caller and test async for a step that belongs at the I/O boundary.
  Loading in the CLI layer and injecting through the existing
  `RendererRegistry` seam gets the same capability with no boundary change.
- **Honoring the renderer's own `GeneratedFile.relativePath`** instead of the
  contract's `output`: rejected. Path authority would move into loaded code,
  where it cannot be validated before that code runs — the exact inversion
  ADR-0010's write boundary exists to prevent.
- **Reusing `adapterDeclaration` for `custom`**: rejected; it would make
  `renderer` and `output` syntactically valid on the five built-in adapters,
  where they have no meaning.
- **Auto-injecting the managed-file marker** into custom renderer output
  rather than requiring it: rejected. Agent-Ready cannot know where in an
  arbitrary output format a comment is syntactically legal — injecting
  an HTML comment at the top of a YAML or JSON adapter output would produce a
  broken file. Requiring the renderer to place it, and failing loudly when it
  doesn't, keeps that decision with the code that knows the format.
- **Supporting a list of custom adapters** in v0.8.0: deferred. One covers
  the motivating case; the list generalization is cheap to add later and
  costs nothing to defer.

## Consequences

- ROADMAP.md's `plugin/adapter loading` non-goal is narrowed rather than
  deleted: single-function render-call registration is now supported;
  lifecycle hooks, middleware, and event systems remain permanently out of
  scope. Updated in the same PR, per ROADMAP-TO-1.0.md's rule.
- `AdapterName` gains `"custom"`. Any exhaustive `switch` over `AdapterName`
  in the codebase must handle it — the compiler will find these.
- `planGeneration`'s signature gains an optional third parameter. Existing
  callers are unaffected.
- `GeneratedFile.relativePath`'s "always adapter-hardcoded, never
  contract-supplied" docstring becomes false as written and is corrected, as
  is `planGeneration`'s "expected unreachable in practice" comment.
- Four new diagnostic codes, each with an `explain` entry (enforced by the
  existing `DIAGNOSTIC_CODES` ↔ `EXPLANATION_REGISTRY` parity test).
- Three escaping helpers become public API surface, and therefore become
  things that cannot be renamed casually before 1.0.
- The compatibility corpus gains a custom-adapter fixture. The five built-in
  adapters' output is unchanged, byte for byte, for every existing contract.

## Reconsideration trigger

- If more than one custom adapter per contract is genuinely needed, revisit
  the single-`custom`-key shape — most likely as
  `adapters.custom: [{ name, renderer, output }, ...]`, which would also give
  each one a stable name for diagnostics.
- If a custom renderer needs anything beyond the contract — repository file
  access, other adapters' output, configuration of its own — stop and write a
  new ADR rather than widening the `render` signature incrementally. That
  need is the actual signal that a real plugin interface is warranted, and it
  should be decided deliberately rather than arrived at one parameter at a
  time.
- If custom renderers in the wild routinely forget `GENERATED_FILE_MARKER`,
  reconsider whether a format-aware marker injection is feasible after all.
- If a hosted or CI context ever needs to run `generate` against an untrusted
  contributor's contract, the "same trust boundary as a devDependency"
  reasoning does not hold, and custom-adapter loading must be gated off in
  that context. This is the trigger to revisit the no-sandbox decision.
