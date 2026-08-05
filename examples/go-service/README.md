# go-service-example

Minimal Go microservice used to exercise an `agent-ready.yaml` contract built
around the Go toolchain: a `go` runtime declaration and `lint`/`test`/`build`
commands. Like the Rust example, there is no `environment.packageManager`
field — Go modules aren't one of the three package managers (`npm`, `pnpm`,
`yarn`) that field's schema currently accepts, and `commands` alone fully
describes the pipeline.

`doctor` probes the declared `go` runtime
([ADR-0038](../../docs/decisions/0038-multi-language-runtime-probing.md)),
invoking the bare subcommand `go version` rather than the `--version` flag
every other probed binary accepts — Go's CLI rejects `--version` outright.
`agent-ready doctor` reports a `runtime-go` row that passes when the installed
toolchain satisfies the declared range; a missing `go` binary now fails the run
with `RUNTIME_PROBE_UNAVAILABLE` rather than warning.

The contract itself is fully valid regardless of what is installed:
`agent-ready validate` passes, and `agent-ready generate` produces all five
adapter files without error.
