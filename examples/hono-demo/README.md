# hono-demo

flowview Events in a plain Vite + Hono project — no Astro involved. This is
the worked example for `@flowview/vite-events`: the same
`(click)="save($event)"` / `<script data-flowview>` authoring model that
`@flowview/astro-events` provides for Astro, wired up by hand for a
framework-less Vite + Node server.

## Stack

- [Hono](https://hono.dev/) — the HTTP handler, run under Node via
  `@hono/node-server`
- [Vite](https://vite.dev/) — dev server (middleware mode) and the client/SSR
  builds
- `@flowview/vite` — compiles `.flow` templates to `render(context): string`
- `@flowview/vite-events` — compiles `(event)="handler()"` bindings and
  serves the `<script data-flowview>` block as a virtual client module

## How the pieces fit together

- `src/pages/index.flow` is the page template. `@flowview/vite-events` runs
  first (`enforce: "pre"`), rewriting bindings to `data-flow-on-*` attributes
  and stripping the `<script data-flowview>` block; `@flowview/vite` then
  compiles the rest into a plain `render(context)` function.
- `src/entry-client.ts` is the browser bundle's entry point. Its only job is
  `import "virtual:flowview-events/src/pages/index.flow.ts"` — the virtual
  module that `@flowview/vite-events` serves, containing the compiled
  handlers plus the `registerFlowHandlers(...)` call.
- `src/server.ts` is a plain Hono app run by `tsx`. In dev it starts a Vite
  dev server in middleware mode, calls `vite.ssrLoadModule(...)` on the
  `.flow` page per request (so edits show up without a restart), and injects
  a literal `<script type="module" src="/src/entry-client.ts">` tag. In
  production it imports the prebuilt server render function and looks up the
  client entry's hashed filename in Vite's `dist/client/.vite/manifest.json`.
- This dev/prod script-tag switch and the manifest lookup are **this
  example's** responsibility, not a `@flowview/vite-events` feature — see the
  package's docs for why.

## Scripts

```sh
# Install dependencies (run from the repo root)
pnpm install

# Start the dev server (http://localhost:3000)
pnpm --filter hono-demo dev

# Type-check
pnpm --filter hono-demo typecheck

# Build the client + server bundles
pnpm --filter hono-demo build

# Run the production build
pnpm --filter hono-demo start

# Run unit tests
pnpm --filter hono-demo test

# Run the Playwright end-to-end suite
pnpm --filter hono-demo exec playwright install chromium
pnpm --filter hono-demo test:e2e
```
