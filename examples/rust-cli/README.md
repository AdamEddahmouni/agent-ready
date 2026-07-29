# rust-cli-example

Minimal Rust CLI used to exercise an `agent-ready.yaml` contract built around
`cargo`: a `rust` runtime declaration and `format`/`lint`/`test`/`build`
commands, with no `environment.packageManager` field at all — Cargo is not one
of the three package managers (`npm`, `pnpm`, `yarn`) that field's schema
currently accepts, and a build tool doesn't need that field to be represented;
`commands` alone fully describes the pipeline.

`doctor` probes the declared `rust` runtime against the **`cargo`** binary
([ADR-0038](../../docs/decisions/0038-multi-language-runtime-probing.md)) —
there is no `rust` executable, and `cargo` is what this contract's declared
commands actually invoke. `agent-ready doctor` reports a `runtime-rust` row
that passes when the installed `cargo` satisfies the declared range; a missing
toolchain now fails the run with `RUNTIME_PROBE_UNAVAILABLE` rather than
warning.

The contract itself is fully valid regardless of what is installed:
`agent-ready validate` passes, and `agent-ready generate` produces all five
adapter files without error.
