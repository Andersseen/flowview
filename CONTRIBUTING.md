# Contributing

Thanks for your interest in flowview. This project is still early, so the best
contributions are small, well-scoped changes that make the compiler easier to
trust.

## Development Setup

Requirements:

- Node.js 22 or newer
- pnpm 10.30.1 or compatible
- Rust stable

Install dependencies:

```sh
pnpm install
```

## Adversarial compiler checks

The bounded `proptest` and HTML corpus suites run in the normal Rust test
command. Events properties run with `pnpm run test:events` and are part of the
normal Vitest suite. Fuzz inputs live in `fuzz/corpus/compiler/`; generated
crashes under `fuzz/artifacts/` are ignored by Git.

Install cargo-fuzz and run the compiler target with nightly Rust:

```sh
cargo install cargo-fuzz --locked
cargo +nightly fuzz run compiler -- -max_len=8192 -timeout=10 -rss_limit_mb=4096
```

Replay a saved crash by passing its artifact path as a corpus input:

```sh
cargo +nightly fuzz run compiler fuzz/artifacts/compiler/crash-<hash>
```

Any bug found by fuzzing must be minimized when practical, captured as a
deterministic regression test, and fixed before the fuzz finding is considered
resolved.

Run the main checks:

```sh
pnpm run build
pnpm run test
```

Run the Astro demo:

```sh
pnpm run demo
```

Run the Hono demo (flowview Events without Astro):

```sh
pnpm run demo:hono
```

## Repository Layout

- `crates/flowview-compiler`: Rust compiler library
- `crates/flowview-cli`: Rust CLI
- `packages/runtime`: TypeScript runtime helpers
- `packages/vite-events`: flowview Events plugin for plain Vite (no Astro)
- `examples/astro-demo`: Astro demo site
- `examples/hono-demo`: Vite + Hono demo for flowview Events without Astro
- `examples/basic`: small `.flow` examples

## Contribution Guidelines

- Keep compiler changes covered by Rust tests.
- Keep runtime changes covered by Vitest tests.
- Keep demo-only changes inside `examples/astro-demo`.
- Every language or Astro integration change must update the Astro demo and its
  browser assertions so the supported authoring path remains visible.
- Every flowview Events integration change must also update `examples/hono-demo`
  and its Playwright assertions, mirroring the existing rule for the Astro demo.
- Do not add framework features to the compiler unless the project scope changes.
- Document syntax changes in `README.md`.
- Prefer clear diagnostics over panics.

## Pull Requests

Before opening a pull request:

```sh
pnpm run format
pnpm run test
pnpm run build
```

For language and Astro integration changes, also run:

```sh
pnpm run build:demo
pnpm --filter @flowview/astro-demo run test:unit
pnpm run test:e2e:demo
```

For flowview Events changes, also run the Hono demo's suite:

```sh
pnpm run test:hono-demo
pnpm run build:hono-demo
pnpm run test:e2e:hono-demo
```

Playwright browser binaries are not committed. Install them locally before
running either demo's end-to-end suite:

```sh
pnpm --filter @flowview/astro-demo exec playwright install chromium
pnpm --filter @flowview/astro-demo run test:e2e

pnpm --filter hono-demo exec playwright install chromium
pnpm --filter hono-demo run test:e2e
```
