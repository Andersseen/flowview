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

## Rust crates (optional)

Requires `cargo login <CRATES_IO_TOKEN>` first.

Order matters: the CLI depends on the compiler crate.

```bash
cd /Users/andriipap/Andersseen/Web/Projects/flowview
pnpm run publish:rust
```

This runs:

```bash
cargo publish -p flowview-compiler
cargo publish -p flowview-cli
```

Verify with:

```bash
cargo search flowview-compiler
cargo search flowview-cli
```

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
