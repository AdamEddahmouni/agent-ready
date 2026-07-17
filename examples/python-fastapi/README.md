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

Because `doctor` does not yet probe the `python` runtime, running
`agent-ready doctor` against this contract reports
`RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED` as a non-blocking warning (exit code 0).
The contract itself is fully valid: `agent-ready validate` passes, and
`agent-ready generate` produces all five adapter files without error.
