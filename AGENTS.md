# Flowview agent guide

Flowview is a small HTML template compiler, not a framework. Do not add routing, Markdown, components, layouts/partials, a server runtime, or consumer-specific APIs.

## Layout

- `crates/flowview-compiler` – Rust library: **one parser, one AST**, two backends: JavaScript codegen and the native static HTML backend (`compile_static` / `render_static`). Must stay usable without Node.
- `crates/flowview-cli`, `crates/flowview-wasm` – CLI and WASM wrappers over the compiler.
- `packages/*` – TypeScript runtime, DOM/reactive/events, compiler bindings, Vite/Astro integrations, Prettier plugin. `examples/*` – demos with Playwright E2E.
- Canonical language spec: `docs/flowview-spec.md`. Rust embedding guide: `docs/embedding-rust.md`. Release process: `RELEASE.md`.
- Shared JS/static parity fixtures: `crates/flowview-compiler/tests/fixtures/*parity.json`.

## Agent tooling

Skills, MCP entries and hooks under `.claude/` and `.agents/` are owned by Agentyx (`.agentyx.json`, `.agentyx.lock.json`). Never hand-edit provider copies; change the config and run `pnpm exec agentyx install` (CLI pinned in `package.json`).

## Verification gate

```
cargo fmt --all -- --check && cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked && cargo doc -p flowview-compiler --no-deps
pnpm install --frozen-lockfile && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

Browser E2E is separate: `pnpm run test:e2e:demo` and `pnpm run test:e2e:hono-demo` (see `.github/workflows/ci.yml`). Add a changeset (`pnpm exec changeset`) for npm-visible changes.
