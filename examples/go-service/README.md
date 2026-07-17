# go-service-example

Minimal Go microservice used to exercise an `agent-ready.yaml` contract built
around the Go toolchain: a `go` runtime declaration and `lint`/`test`/`build`
commands. Like the Rust example, there is no `environment.packageManager`
field — Go modules aren't one of the three package managers (`npm`, `pnpm`,
`yarn`) that field's schema currently accepts, and `commands` alone fully
describes the pipeline.

Because `doctor` does not yet probe the `go` runtime, running `agent-ready
doctor` against this contract reports `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` as
a non-blocking warning (exit code 0). The contract itself is fully valid:
`agent-ready validate` passes, and `agent-ready generate` produces all five
adapter files without error.
