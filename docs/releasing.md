# Releasing Agent-Ready

Releases are intentionally manual while the project is pre-1.0.

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
   `pnpm test:package` on Node 20 and 22 where practical.
4. Confirm the GitHub Actions OS matrix and composite-action dogfood job pass.
5. Commit the release, then create an annotated `v<version>` tag at that commit.
6. Push the commit and tag to the canonical remote.

The composite action and npm package must be reproducible from the same tagged
commit. Automated publication remains out of scope; introducing it requires a
separate decision and threat review.
