# flowview

flowview is a small Rust compiler for HTML-like templates with
Angular-inspired control flow syntax. It is not a framework. It transforms
`.flow` files into plain JavaScript render functions.

```text
<main>
  <h1>{{ context.title }}</h1>

  @for (product of context.products; track product.id) {
    <article>{{ product.title }}</article>
  } @empty {
    <p>No products found.</p>
  }
</main>
```

```js
import { renderValue } from "@flowview/runtime";

export function render(context) {
  let output = "";
  const __items0 = Array.from(context.products ?? []);
  // ...
  return output;
}
```

## Status

flowview is experimental and pre-stable. The public shape is intentionally
small, but syntax and generated output may still change before a stable release.

The current milestone is the inline Astro authoring path: flowview control flow
inside `<template flowview={...} is:raw>` regions in normal `.astro`
files.
Standalone `.flow` imports remain supported, but broader Vite and server-runtime
usage is a later milestone after the Astro integration and core syntax are
reliable.

## What flowview Is

- A Rust compiler crate: `flowview-compiler`
- A Rust CLI: `flowview`
- A tiny TypeScript runtime package: `@flowview/runtime`
- A Vite plugin: `@flowview/vite`
- An Astro integration: `@flowview/astro`
- A separate events compiler: flowview Events (`@flowview/events`, `@flowview/astro-events`)
- A Prettier plugin: `@flowview/prettier` (formats `.astro` files while preserving flowview regions)
- A framework-agnostic template experiment
- A monorepo with a working Astro demo

## What flowview Is Not

flowview does not provide:

- Components
- Hydration
- Signals
- DOM events in the HTML compiler (browser events are handled by the separate flowview Events compiler)
- Directives
- Dependency injection
- A virtual DOM
- A built-in React or Hono integration
- Angular compatibility or Angular dependencies

## Why It Exists

Modern control-flow syntax such as `@if`, `@for`, and `@switch` is productive
inside templates, but it is usually tied to a full UI framework. flowview
explores whether that authoring style can compile into plain JavaScript render
functions that are easy to run from any host environment.

## Supported Syntax

flowview currently supports:

- Plain text and HTML-like markup
- Escaped interpolation: `{{ context.title }}`
- Conditional blocks:
  - `@if (condition) { ... }`
  - `@else if (condition) { ... }`
  - `@else { ... }`
- Iteration blocks:
  - `@for (item of items) { ... }`
  - `@for (item of items; track item.id) { ... }`
  - `@empty { ... }`
- Switch blocks:
  - `@switch (expr) { @case ('a') { ... } @default { ... } }`

Iterables are normalized with `Array.from`, so arrays, sets, maps, generators,
and array-like objects can be rendered.

`track` is accepted as reserved syntax for future integrations. Since flowview
currently renders strings and does not diff DOM nodes, `track` has no runtime
effect today.

The render data is always available inside a flowview template as `context`.
There is no implicit `ctx` alias. In Astro, `context={value}` supplies the value
and the template reads it as `context.*`.

To render syntax markers literally in text, escape the leading character:
`\@if`, `\{{`, and `\}`.

Control-flow markers are recognized in template content, not inside HTML tag
attributes, HTML comments, `<script>`, or `<style>` elements. An `@` embedded in
a word, such as `contact@if.example`, is also plain text.

## Security Model

`.flow` files are trusted source code. flowview preserves expressions as
JavaScript source strings and emits them into the generated render function.
Do not compile user-submitted templates unless you sandbox the generated code
yourself.

Values interpolated from `context` are escaped by default through
`@flowview/runtime`.

HTML escaping is safe for normal text and quoted HTML attribute values. flowview
rejects interpolation in unquoted attributes and rejects mixed text plus
interpolation inside a single quoted attribute value. Escaping is not URL, CSS,
or JavaScript sanitization. Do not interpolate untrusted values into
`<script>` or `<style>` content, event-handler attributes, or URL-bearing
attributes without validation appropriate to that context.

## Repository Layout

```text
flowview/
├── crates/
│   ├── flowview-compiler/   # Rust compiler library
│   └── flowview-cli/        # Rust CLI binary
├── packages/
│   ├── runtime/             # TypeScript runtime helpers
│   ├── vite/                # Standalone .flow imports
│   ├── astro/               # Astro integration
│   └── vscode-flowview/     # Editor support
├── examples/
│   ├── basic/               # Small .flow examples
│   └── astro-demo/          # Astro demo site
├── Cargo.toml
├── package.json
└── pnpm-workspace.yaml
```

## Requirements

- Node.js 22 or newer
- pnpm 10.30.1 or compatible
- Rust stable

## Install

```sh
pnpm install
```

Cargo fetches Rust dependencies automatically when Rust commands run.

## Build

```sh
pnpm run build
```

Individual builds:

```sh
pnpm run build:rust
pnpm run build:runtime
pnpm run build:vite
pnpm run build:demo
```

## Use With Vite

```ts
import flowview from "@flowview/vite";

export default {
  plugins: [flowview()],
};
```

The plugin compiles `.flow` imports at build time using the prebuilt CLI. In
the monorepo it discovers the local Rust binary automatically; installed usage
resolves `flowview` from `PATH`. `compilerPath` remains available as an advanced
override.

TypeScript projects that import `.flow` files can add the bundled module
declaration to their `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@flowview/vite/client"]
  }
}
```

## Use With Hono or Plain Node.js

flowview generates a plain `render(context)` function, so it works with any
server runtime. Add `@flowview/vite` to your Vite build, import the compiled
`.flow` file, and call `render` inside the request handler.

### Hono

```ts
import { Hono } from "hono";
import { render } from "./page.flow";

const app = new Hono();

app.get("/", (context) => {
  const html = render({
    title: "Hello from flowview",
    items: ["a", "b", "c"],
  });
  return context.html(html);
});

export default app;
```

### Plain Node.js

```ts
import { createServer } from "node:http";
import { render } from "./page.flow";

createServer((_, response) => {
  const html = render({ title: "Hello" });
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(3000);
```

### Cloudflare Workers

```ts
import { render } from "./page.flow";

export default {
  async fetch() {
    const html = render({ title: "Hello from flowview" });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
```

## Test

```sh
pnpm run test
```

Individual suites:

```sh
pnpm run test:rust
pnpm run test:runtime
pnpm run test:vite
pnpm run test:astro
pnpm run test:demo
```

The Astro demo also has a Playwright suite:

```sh
pnpm --filter @flowview/astro-demo exec playwright install chromium
pnpm run test:e2e:demo
```

## flowview Events

flowview Events is the separate compiler for Angular-style event bindings such
as `(click)="save($event)"`. It is not part of the core HTML compiler. The
core package is `@flowview/events`; `@flowview/astro-events` wires it into
Astro, and `@flowview/vite-events` wires it into a plain Vite project (Hono,
Node.js, Cloudflare Workers — no Astro required).

Handlers are declared in a `<script data-flowview>` block, which is ordinary
client-side JavaScript: normal imports, module-level state, and closures all
work exactly as they would in any other `<script>` tag.

```astro
<button (click)="save($event)">Save</button>
<button (click)="removeItem('item-1', $el)">Remove</button>

<script data-flowview>
  function save(event) {
    console.log(event.type);
  }

  function removeItem(id, element) {
    element.setAttribute("disabled", "true");
  }
</script>
```

At build time, `@flowview/astro-events` validates that every `(event)="handler()"`
binding resolves to a function declared in that block, rewrites the bindings to
`data-flow-on-<event>` / `data-flow-scope` / `data-flow-args` attributes, and
appends a `registerFlowHandlers(scope, handlers, events)` call to the script.
The runtime (`@flowview/events/runtime`) attaches one delegated `document`
listener per event type and resolves the handler at dispatch time, so elements
added to the DOM later (view transitions, `@for` re-renders) work without
rebinding. `data-flowview` (not `flowview`) is required because `<script>`
attributes are strictly typed in Astro's JSX namespace, and only `data-*`
attributes are permitted to hold arbitrary custom markers.

At most one `<script data-flowview>` block is allowed per `.astro` or `.flow`
file, and every `(event)="handler()"` binding in that file must resolve to a
function declared in it; declaring handlers in Astro frontmatter is no longer
supported.

### Use flowview Events without Astro (Vite + Hono)

`@flowview/vite-events` brings the same authoring model to a plain Vite
project. It must run _before_ `@flowview/vite`, since bindings have to be
rewritten to `data-flow-on-*` attributes before the Rust compiler ever parses
the `.flow` file:

```ts
import flowviewEvents from "@flowview/vite-events";
import flowview from "@flowview/vite";

export default {
  plugins: [flowviewEvents(), flowview()],
};
```

The `<script data-flowview>` block is stripped out of the rendered HTML and
served as a virtual module instead, so it needs a real client entry to import
it into the browser bundle:

```ts
// src/entry-client.ts
import "virtual:flowview-events/src/pages/index.flow.ts";
```

Getting that entry's `<script>` tag into the HTML response is a standard Vite
SSR concern, not something the plugin automates: inject a literal
`<script type="module" src="/src/entry-client.ts">` in dev, and in production
look up the hashed filename in `dist/client/.vite/manifest.json`. See
`examples/hono-demo` for the full, working wiring — dev server, production
build, and manifest lookup included.

## Run The Astro Demo

```sh
pnpm run demo
```

The demo is also the [official flowview landing page](examples/astro-demo/).
It uses Astro, Tailwind CSS 4, `@andersseen/web-components`, and the local
`@flowview/astro` integration. Inline flowview templates can be authored with
the editor-compatible `<template flowview is:raw>` wrapper:

```text
<template flowview={context} is:raw>
  <main>
    <h1>{{ context.title }}</h1>
    @if (context.featured) {
      <span>Featured</span>
    }
  </main>
</template>
```

The integration transforms embedded flowview templates before Astro parses the
page. `is:raw` is included in the recommended Astro authoring form so Astro's
Language Server treats the custom syntax as inert; the flowview integration
replaces the entire element before the application build. The integration
discovers the monorepo compiler automatically and otherwise uses the prebuilt
`flowview` CLI from `PATH`. `compilerPath` is only needed as an advanced
override. The integration never runs Cargo and sends templates over stdin, so
it does not create temporary source files.

## Run The Hono Demo

```sh
pnpm run demo:hono
```

The demo is [`examples/hono-demo`](examples/hono-demo/), a plain Vite + Hono
project with no Astro involved. It's the worked example for
`@flowview/vite-events`: a `.flow` page with `(click)`/`(input)` bindings, a
dev server built from Vite's middleware-mode + `@hono/node-server`, and a
production build with manifest-based script injection. See its
[README](examples/hono-demo/README.md) for how the pieces fit together, and
`pnpm --filter hono-demo build && pnpm --filter hono-demo start` to run the
production build.

## Editor Support

The repository includes a local VS Code language support package at
`packages/vscode-flowview`. It contributes:

- `.flow` syntax highlighting
- flowview snippets
- basic highlighting for `<template flowview>` blocks inside `.astro` files

## Run The CLI

Compile a `.flow` file to stdout:

```sh
cargo run -p flowview-cli -- compile examples/basic/for.flow
```

The CLI also accepts stdin, which is the supported integration boundary:

```sh
printf '<h1>{{ context.title }}</h1>' | flowview compile - --display-name inline.flow
```

Compile to a file:

```sh
cargo run -p flowview-cli -- compile examples/basic/for.flow --out for.js
```

Use a custom runtime import path:

```sh
cargo run -p flowview-cli -- compile examples/basic/for.flow --runtime "#flowview/runtime"
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## Specification

See [docs/flowview-spec.md](./docs/flowview-spec.md) for the draft
specification and integration roadmap.

## Security

See [SECURITY.md](./SECURITY.md) for the security policy and template trust
model.

## License

MIT. See [LICENSE](./LICENSE).
