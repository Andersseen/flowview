# Release process

This monorepo uses [Changesets](https://github.com/changesets/changesets) to manage independently versioned npm packages under the `@flowview` scope. Rust crates are versioned independently and published to crates.io. Browser/JavaScript and Static/Rust are both first-class distribution tracks; neither release path defines the product's primary track.

## Quick scripts from root

```bash
# Publish npm packages under @flowview
pnpm run publish:npm

# Publish Rust crates (flowview-static-runtime, flowview-compiler, flowview-cli)
pnpm run publish:rust
```

## npm packages

Requires npm login with access to the `@flowview` scope.

```bash
cd <flowview-checkout>
pnpm run publish:npm
```

This builds runtime, events, compiler, Vite, Astro, Astro Events, and Prettier packages, then runs `changeset publish`.

Releases are gated by the reusable `Release readiness` workflow
(`.github/workflows/release-readiness.yml`), which `release.yml` runs before the
Changesets job: it builds and packs every publishable package once, validates
every tarball and runs `npm publish --dry-run`, installs those same tarballs
into fresh external Vite/Astro/Prettier projects on Linux, macOS, and Windows,
runs the Vite 6/7/8, Astro 5/6/7 and Prettier compatibility cases and the
Node 22.12.0 minimum, and only then lets the release job restore that exact
build output and publish. The contract is documented in
[docs/compatibility.md](docs/compatibility.md).

To reproduce the gates locally after installing the repository dependencies and
building every package:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run pack:release-artifacts <empty-temporary-directory>
pnpm run verify:release-artifacts <same-temporary-directory>
pnpm run verify:packed-vite-consumer <same-temporary-directory> --vite 8
pnpm run verify:packed-astro-consumer <same-temporary-directory> --astro 7
```

The consumer scripts install the generated tarballs into a fresh directory under
the operating system's temporary directory. They use a separate pnpm store and
do not use the workspace lockfile for the consumer.

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

Release order follows dependencies: `flowview-static-runtime`, then
`flowview-compiler`, then `flowview-cli`. The compiler depends on the runtime;
the CLI depends on the compiler. `flowview-wasm` stays bundled and
`publish = false`.

1. Bump the coherent Rust release-line version in `[workspace.package]`,
   `crates/flowview-compiler/Cargo.toml`, `crates/flowview-cli/Cargo.toml`, and
   `crates/flowview-wasm/Cargo.toml`; keep the independently versioned runtime
   package version deliberate. Update internal compiler dependency versions in
   CLI and wasm manifests. Commit and merge.
2. Quality gate (also what the **Rust release** workflow runs):

   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --locked -- -D warnings
   cargo test --workspace --locked
   RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --locked
   cargo package --workspace --exclude flowview-wasm --locked --no-verify
   scripts/publish-rust.sh --dry-run
   scripts/verify-aot-packaged-consumer.sh
   ```

   The compiler MSRV (`rust-version` in `Cargo.toml`, currently 1.91) is tested
   on exactly that toolchain by `.github/workflows/rust-msrv.yml`, which pins the version
   and fails if it drifts from `Cargo.toml`. The static runtime's Rust 1.85 MSRV
   is tested independently. Workspace tests compile the CLI against the local
   compiler. `--dry-run` runs for the runtime first, then for the compiler only
   when its runtime version is in the registry, and for the CLI only when its
   compiler version is in the registry; skipped work is reported with the reason.

   `verify-aot-packaged-consumer.sh` creates the runtime `.crate` with Cargo,
   inspects and extracts that archive, then builds an external consumer whose
   path dependency points only at the extracted package. This is local
   candidate-package evidence; it is not a registry installation. The CI job
   runs it on Linux, macOS and Windows. A `NOT EXECUTED` downstream publish
   dry-run means the named dependency is not yet on crates.io and is not a
   passing dry-run; the release workflow must perform the exact-version
   registry consumer/install checks after publication.

3. Publish. Preferred: run the **Rust release** workflow (Actions → Rust release →
   Run workflow) with `dry_run: false`. It needs the `CARGO_REGISTRY_TOKEN`
   repository secret and runs `scripts/publish-rust.sh`: it publishes
   `flowview-static-runtime`, polls for the exact version, then runs
   `scripts/verify-aot-registry-consumer.sh`, which builds an AOT consumer pinned
   to the runtime registry version. Next it publishes `flowview-compiler`,
   polls for that version and runs `scripts/verify-registry-consumer.sh`, a
   throwaway project that depends on
   `flowview-compiler = "=<version>"` from the registry (no path/git/workspace
   dependency) and checks `compile_static` + `render` with escaped and trusted-raw
   output. Only then does it publish `flowview-cli`, and finally it
   `cargo install`s that exact CLI version from the registry. Reruns are safe: a version already public with a matching
   package checksum is skipped; a checksum mismatch fails the run. Manually, with `cargo login`:

   ```bash
   pnpm run publish:rust
   ```

4. Verify:

   ```bash
   cargo search flowview-compiler
   cargo search flowview-cli
   scripts/verify-registry-consumer.sh   # exact workspace version, registry only
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
