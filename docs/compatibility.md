# Compatibility

What FlowView promises, and the CI job that proves each promise. Three things
are deliberately kept apart:

- **Repository development requirements** — what you need to build and test
  this repo.
- **Published package compatibility** — what a consumer of the npm packages can
  rely on.
- **Versions actively tested in CI** — the evidence. A promise without a CI case
  is not made.

`scripts/compatibility.json` is the single source of truth for the tested
versions. `node scripts/check-compatibility.mjs` (run in CI) fails if a peer
range, the CI matrix, or these docs disagree with it, so declared
compatibility cannot drift from tested compatibility.

## Published packages

| Surface             | Supported      | CI job(s)                                                            |
| ------------------- | -------------- | -------------------------------------------------------------------- |
| Node.js             | 22.12 or newer | `Node minimum (22.12.0)`; Node 24 for Astro 7's current engine floor |
| Vite                | 6, 7, 8        | `Vite compatibility (6)`, `(7)`, `(8)`                               |
| Astro               | 5, 6, 7        | `Astro compatibility (5)`, `(6)`, `(7)`                              |
| Prettier            | 3 (`^3.0.0`)   | `Prettier compatibility (3.0.0)` (floor), `(^3.0.0)` (latest 3.x)    |
| Rust (native crate) | stable         | `Rust` and `Rust portability` jobs (not part of the npm contract)    |

Notes:

- **Node.js.** 22.12.0 is the FlowView JS tooling floor (compiler WASM loader,
  Vite plugin, Astro integration, Events plugins, Prettier plugin). CI tests
  this floor with Vite 8, Astro 6 and Prettier. Astro 7 currently requires
  Node `>=22.23.4`, so its compatibility job and the cross-OS consumer jobs
  use Node 24. Consumers must also satisfy the selected host tool's own engine
  requirement.
  Older Node releases are untested and unsupported even where a host tool such
  as Vite 6 would run on them. No `engines` field is declared: the runtime
  helpers (`@flowview/runtime`, `reactive`, `dom`, the Events browser runtime)
  also execute in browsers and edge runtimes, and an `engines` field would
  needlessly block those installs. There is no upper bound.
- **Vite.** `@flowview/vite` and `@flowview/vite-events` peer on
  `^6.0.0 || ^7.0.0 || ^8.0.0`. Each major is exercised with
  `@flowview/vite` + `@flowview/vite-events`: `.flow` compilation in a dev
  transform and SSR load, a production build, source map, the `.flow`
  TypeScript declaration, `(click)` binding output (`data-flow-on-click`,
  `data-flow-scope`, registration module, no leftover `<script data-flowview>`).
- **Astro.** `@flowview/astro` and `@flowview/astro-events` peer on
  `>=5 <8`. Each major builds a site with a standalone `.flow` import, an
  embedded `<template flowview={...} is:raw>` (escaped interpolation, `@if`,
  `@for`), and an Events page, and passes `astro check`.
- **Prettier.** `@flowview/prettier` peers on `^3.0.0`; the floor release and
  the latest 3.x both format a FlowView `.astro` file without touching the
  template region.
- **Rust.** Only needed to build the native crate/CLI. The npm packages never
  require Rust, `cargo`, `wasm-pack`, or a native FlowView binary; every
  consumer test removes them from `PATH` and blocks the process spawns.

## How the compatibility tests work

Compatibility tests install the **packed tarballs** (the same files `npm`
users receive) into fresh temporary projects. They never use `workspace:*`,
monorepo links, or source imports, and the consumer's lockfile is checked to
pin every `@flowview/*` package to a tarball with the sha512 recorded when the
tarballs were packed.

The matrix is deliberately bounded and split by concern:

| Concern                          | Dimension                                                      | Where                                      |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| OS portability                   | Linux / macOS / Windows (Node 24)                              | `Packed npm consumer (<os>)`               |
| Dependency-version compatibility | Vite 6/7/8, Astro 5/6 (Node 22), Astro 7 (Node 24), Prettier 3 | `<Tool> compatibility (<version>)`, Ubuntu |
| Node floor                       | 22.12.0                                                        | `Node minimum (22.12.0)`                   |

There is no cross product of these axes. The Node-minimum job runs the latest
Vite 8 and Astro 6 consumers plus the Prettier consumer on 22.12.0. Astro 7 is
tested separately on Node 24 to meet Astro's current engine floor.

## Release artifacts

`Release artifacts` validates the complete publishable surface (every
non-private package under `packages/` not ignored by Changesets), derived from
the workspace rather than a hardcoded list. For each tarball it checks that:

- `package.json` is present with `name`, `version`, `license`, `description`,
  `repository`;
- every `exports`/`main`/`module`/`types`/`bin` target exists inside the
  tarball and stays inside it;
- `@flowview/compiler` ships its WASM payload (`pkg/*.wasm` and bindings) and
  `@flowview/vite` ships `client.d.ts`;
- no `workspace:`/`file:`/`link:` protocol survives, and every internal
  `@flowview/*` dependency has a packed tarball whose version satisfies the
  published range;
- no text file references the checkout's absolute path;
- `npm publish <tarball> --dry-run` succeeds (no credentials, nothing is
  published).

## Reproduce locally

```bash
pnpm install --frozen-lockfile
pnpm run build   # or the per-package build:* scripts
pnpm run pack:release-artifacts "$TMPDIR/fv-artifacts"   # directory must be empty
pnpm run verify:release-artifacts "$TMPDIR/fv-artifacts"
pnpm run check:compatibility

for v in 6 7 8; do pnpm run verify:packed-vite-consumer "$TMPDIR/fv-artifacts" --vite $v; done
for v in 5 6 7; do pnpm run verify:packed-astro-consumer "$TMPDIR/fv-artifacts" --astro $v; done
pnpm run verify:packed-prettier-consumer "$TMPDIR/fv-artifacts" --prettier 3.0.0
```

For the Node floor, put a Node 22.12.0 first on `PATH` (for example from
`npm install node@22.12.0`) and run the same consumer scripts.
