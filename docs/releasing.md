# Releasing Agent-Ready

Release steps:

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
   `pnpm test:package` on Node 20 and 22 where practical.
4. Open a PR, confirm the GitHub Actions OS matrix and composite-action dogfood
   job pass, then merge.
5. Create an annotated `v<version>` tag at the merge commit:
   `git tag -a v<version> -m "v<version>"`
6. Push the tag (this also pushes the commit if it hasn't been pushed yet):
   `git push origin v<version>`
7. The `.github/workflows/publish.yml` workflow triggers on the tag push and
   runs typecheck, tests, build, package smoke test, tag-version verification,
   and `npm publish --provenance --access public`.

The composite action and npm package are reproducible from the same tagged
commit. Publishing requires an `NPM_TOKEN` secret configured in the repository
settings. Use an **Automation** token type (not a user-bound publish token) so
2FA does not block CI publishes.
