# rust-cli-example

Minimal Rust CLI used to exercise an `agent-ready.yaml` contract built around
`cargo`: a `rust` runtime declaration and `format`/`lint`/`test`/`build`
commands, with no `environment.packageManager` field at all — Cargo is not one
of the three package managers (`npm`, `pnpm`, `yarn`) that field's schema
currently accepts, and a build tool doesn't need that field to be represented;
`commands` alone fully describes the pipeline.

Because `doctor` does not yet probe the `rust` runtime, running
`agent-ready doctor` against this contract reports
`RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` as a non-blocking warning (exit code 0).
The contract itself is fully valid: `agent-ready validate` passes, and
`agent-ready generate` produces all five adapter files without error.
