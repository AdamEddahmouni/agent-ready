# Adapter output compatibility

Agent-Ready publishes a versioned compatibility corpus under
`compatibility/adapter-output/`. It lets downstream adapter implementations
check their generated files against the reference implementation without
depending on internal TypeScript modules or human-readable CLI output.

Each corpus contains a manifest, complete input repositories, and byte-exact
expected outputs for every declared adapter. Corpus paths and file contents are
portable data; running the corpus never requires network access or command
execution.

Within a corpus version, existing cases and expected bytes are immutable. New
cases may be added when they clarify behavior without changing an existing
expectation. An intentional output change requires a new corpus version and a
changelog entry. v2 adds architecture-only, agents-only, and combined
adversarial cases; v1 remains in the package and is run unchanged as the
byte-identity proof for v0.4 contracts.

The corpus is shipped in the npm package and tested by the reference
implementation in `tests/compatibility/adapterOutput.test.ts`.
