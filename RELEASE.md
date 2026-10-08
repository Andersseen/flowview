# Release process

This monorepo uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishes to npm under the `@flowview` scope. Rust crates can also be published to crates.io, but npm is the primary distribution path.

## Quick scripts from root

```bash
# Primary: publish npm packages under @flowview
pnpm run publish:npm

# Optional: publish Rust crates (flowview-compiler + flowview-cli)
pnpm run publish:rust
```

## npm (primary)

Requires npm login with access to the `@flowview` scope.

```bash
cd /Users/andriipap/Andersseen/Web/Projects/flowview
pnpm run publish:npm
```

This builds runtime, events, compiler, Vite, Astro, Astro Events, and Prettier packages, then runs `changeset publish`.

Verify with:

```bash
npm view @flowview/runtime version
npm view @flowview/events version
npm view @flowview/compiler version
npm view @flowview/vite version
npm view @flowview/astro version
npm view @flowview/astro-events version
npm view @flowview/prettier version
```

## Rust crates

Rust crates are versioned independently from the npm packages (`[workspace.package]`
and each crate's `version` in `Cargo.toml`). `flowview-wasm` is bundled into
the npm compiler package and is `publish = false`.

Order matters: `flowview-compiler` first, then `flowview-cli` (which depends on it).

1. Bump `version` in `crates/flowview-compiler/Cargo.toml` and
   `crates/flowview-cli/Cargo.toml`, and the `version = "…"` of the
   `flowview-compiler` dependency in the CLI (and wasm) manifests. Commit and merge.
2. Quality gate (also what the **Rust release** workflow runs):

   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --locked -- -D warnings
   cargo test --workspace --locked
   cargo doc -p flowview-compiler --no-deps
   cargo publish --dry-run --workspace --exclude flowview-wasm --locked
   ```

3. Publish. Preferred: run the **Rust release** workflow (Actions → Rust release →
   Run workflow) with `dry_run: false`. It needs the `CARGO_REGISTRY_TOKEN`
   repository secret and runs `scripts/publish-rust.sh`: it publishes `flowview-compiler`,
   polls the crates.io index (bounded, 30 × 10 s) until that exact version resolves, then
   publishes `flowview-cli`. Reruns are safe: a version already public with a matching
   package checksum is skipped; a checksum mismatch fails the run. Manually, with `cargo login`:

   ```bash
   pnpm run publish:rust
   ```

4. Verify:

   ```bash
   cargo search flowview-compiler
   cargo search flowview-cli
   ```

Downstream Rust tools should depend on `flowview-compiler = "<released-version>"`,
not a Git branch. Never put the registry token in repository files.

## Subsequent npm releases (automated)

1. Add a changeset for any code change that should bump a version:

   ```bash
   pnpm exec changeset
   ```

2. Push the changeset markdown file in a PR / commit.
3. The `release.yml` GitHub workflow will open a "Version Packages" PR when the changeset is merged to `main`.
4. Merging the "Version Packages" PR triggers the workflow again, which publishes the new npm versions using `NPM_TOKEN`.

### Required repository secrets

- `NPM_TOKEN` — npm access token with publish permission for the `@flowview` scope.
