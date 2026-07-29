# python-fastapi-example

Minimal FastAPI service used to exercise a non-Node `agent-ready.yaml`
contract: a `python` runtime declaration, `pip`-based commands, and all five
adapters enabled.

`environment.packageManager` is intentionally absent from `agent-ready.yaml`.
That field's `name` is schema-restricted to `npm`, `pnpm`, and `yarn` — the
package managers `agent-ready doctor` currently knows how to probe.
Multi-language package manager probing is a planned future release. Declaring
the install command as `commands.install: pip install -r requirements.txt`
needs no schema support at all, since commands are inert, unparsed strings.

`doctor` probes the declared `python` runtime against the `python` binary on
`PATH` ([ADR-0038](../../docs/decisions/0038-multi-language-runtime-probing.md)),
so `agent-ready doctor` reports a `runtime-python` row that passes when the
installed interpreter satisfies the declared range. A missing `python` binary
now fails the run with `RUNTIME_PROBE_UNAVAILABLE` rather than warning — the
same treatment `node` already gets. Note that `doctor` probes `python`
specifically, not `python3`; on a distribution that installs only `python3`,
the probe reports the runtime as unavailable.

The contract itself is fully valid regardless of what is installed:
`agent-ready validate` passes, and `agent-ready generate` produces all five
adapter files without error.
