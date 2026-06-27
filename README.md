# Flowmark

Flowmark is a small Rust compiler for HTML-like templates with
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
import { renderValue } from "@flowmark/runtime";

export function render(context) {
  let output = "";
  const __items0 = Array.from(context.products ?? []);
  // ...
  return output;
}
```

## Status

Flowmark is experimental and pre-stable. The public shape is intentionally
small, but syntax and generated output may still change before a stable release.

The current milestone is the inline Astro authoring path: Flowmark control flow
inside `<template flowmark is:raw context={...}>` regions in normal `.astro`
files.
Standalone `.flow` imports remain supported, but broader Vite and server-runtime
usage is a later milestone after the Astro integration and core syntax are
reliable.

## What Flowmark Is

- A Rust compiler crate: `flowmark-compiler`
- A Rust CLI: `flowmark`
- A tiny TypeScript runtime package: `@flowmark/runtime`
- A Vite plugin: `@flowmark/vite`
- An Astro integration: `@flowmark/astro`
- A separate events compiler: Flowmark Events (`@flowmark/dom`, `@flowmark/astro-events`)
- A framework-agnostic template experiment
- A monorepo with a working Astro demo

## What Flowmark Is Not

Flowmark does not provide:

- Components
- Hydration
- Signals
- DOM events in the HTML compiler (browser events are handled by the separate Flowmark Events compiler)
- Directives
- Dependency injection
- A virtual DOM
- A built-in React or Hono integration
- Angular compatibility or Angular dependencies

## Why It Exists

Modern control-flow syntax such as `@if`, `@for`, and `@switch` is productive
inside templates, but it is usually tied to a full UI framework. Flowmark
explores whether that authoring style can compile into plain JavaScript render
functions that are easy to run from any host environment.

## Supported Syntax

Flowmark currently supports:

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

`track` is accepted as reserved syntax for future integrations. Since Flowmark
currently renders strings and does not diff DOM nodes, `track` has no runtime
effect today.

The render data is always available inside a Flowmark template as `context`.
There is no implicit `ctx` alias. In Astro, `context={value}` supplies the value
and the template reads it as `context.*`.

To render syntax markers literally in text, escape the leading character:
`\@if`, `\{{`, and `\}`.

Control-flow markers are recognized in template content, not inside HTML tag
attributes, HTML comments, `<script>`, or `<style>` elements. An `@` embedded in
a word, such as `contact@if.example`, is also plain text.

## Security Model

`.flow` files are trusted source code. Flowmark preserves expressions as
JavaScript source strings and emits them into the generated render function.
Do not compile user-submitted templates unless you sandbox the generated code
yourself.

Values interpolated from `context` are escaped by default through
`@flowmark/runtime`.

HTML escaping is safe for normal text and quoted HTML attribute values. Flowmark
rejects interpolation in unquoted attributes and rejects mixed text plus
interpolation inside a single quoted attribute value. Escaping is not URL, CSS,
or JavaScript sanitization. Do not interpolate untrusted values into
`<script>` or `<style>` content, event-handler attributes, or URL-bearing
attributes without validation appropriate to that context.

## Repository Layout

```text
flowmark/
├── crates/
│   ├── flowmark-compiler/   # Rust compiler library
│   └── flowmark-cli/        # Rust CLI binary
├── packages/
│   ├── runtime/             # TypeScript runtime helpers
│   ├── vite/                # Standalone .flow imports
│   ├── astro/               # Astro integration
│   └── vscode-flowmark/     # Editor support
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
import flowmark from "@flowmark/vite";

export default {
  plugins: [flowmark()],
};
```

The plugin compiles `.flow` imports at build time using the prebuilt CLI. In
the monorepo it discovers the local Rust binary automatically; installed usage
resolves `flowmark` from `PATH`. `compilerPath` remains available as an advanced
override.

TypeScript projects that import `.flow` files can add the bundled module
declaration to their `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@flowmark/vite/client"]
  }
}
```

## Use With Hono or Plain Node.js

Flowmark generates a plain `render(context)` function, so it works with any
server runtime. Add `@flowmark/vite` to your Vite build, import the compiled
`.flow` file, and call `render` inside the request handler.

### Hono

```ts
import { Hono } from "hono";
import { render } from "./page.flow";

const app = new Hono();

app.get("/", (context) => {
  const html = render({
    title: "Hello from Flowmark",
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
    const html = render({ title: "Hello from Flowmark" });
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
pnpm --filter @flowmark/astro-demo exec playwright install chromium
pnpm run test:e2e:demo
```

## Flowmark Events

Flowmark Events is the separate compiler and Astro integration for Angular-style
event bindings such as `(click)="save($event)"`. It is not part of the core HTML
compiler. The implementation packages are currently named `@flowmark/dom` and
`@flowmark/astro-events`.

## Run The Astro Demo

```sh
pnpm run demo
```

The demo is also the [official Flowmark landing page](examples/astro-demo/).
It uses Astro, Tailwind CSS 4, `@andersseen/web-components`, and the local
`@flowmark/astro` integration. Inline Flowmark templates can be authored with
the editor-compatible `<template flowmark is:raw>` wrapper:

```text
<template flowmark is:raw context={context}>
  <main>
    <h1>{{ context.title }}</h1>
    @if (context.featured) {
      <span>Featured</span>
    }
  </main>
</template>
```

The integration transforms embedded Flowmark templates before Astro parses the
page. `is:raw` is included in the recommended Astro authoring form so Astro's
Language Server treats the custom syntax as inert; the Flowmark integration
replaces the entire element before the application build. The integration
discovers the monorepo compiler automatically and otherwise uses the prebuilt
`flowmark` CLI from `PATH`. `compilerPath` is only needed as an advanced
override. The integration never runs Cargo and sends templates over stdin, so
it does not create temporary source files.

## Editor Support

The repository includes a local VS Code language support package at
`packages/vscode-flowmark`. It contributes:

- `.flow` syntax highlighting
- Flowmark snippets
- basic highlighting for `<template flowmark>` blocks inside `.astro` files

## Run The CLI

Compile a `.flow` file to stdout:

```sh
cargo run -p flowmark-cli -- compile examples/basic/for.flow
```

The CLI also accepts stdin, which is the supported integration boundary:

```sh
printf '<h1>{{ context.title }}</h1>' | flowmark compile - --display-name inline.flow
```

Compile to a file:

```sh
cargo run -p flowmark-cli -- compile examples/basic/for.flow --out for.js
```

Use a custom runtime import path:

```sh
cargo run -p flowmark-cli -- compile examples/basic/for.flow --runtime "#flowmark/runtime"
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## Specification

See [docs/flowmark-spec.md](./docs/flowmark-spec.md) for the draft
specification and integration roadmap.

## Security

See [SECURITY.md](./SECURITY.md) for the security policy and template trust
model.

## License

MIT. See [LICENSE](./LICENSE).
