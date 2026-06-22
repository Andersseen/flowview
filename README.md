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
- A framework-agnostic template experiment
- A monorepo with a working Astro demo

## What Flowmark Is Not

Flowmark does not provide:

- Components
- Hydration
- Signals
- Events
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

## Security Model

`.flow` files are trusted source code. Flowmark preserves expressions as
JavaScript source strings and emits them into the generated render function.
Do not compile user-submitted templates unless you sandbox the generated code
yourself.

Values interpolated from `context` are escaped by default through
`@flowmark/runtime`.

HTML escaping is safe for normal text and quoted HTML attribute values. Flowmark
rejects interpolation in unquoted attributes. Escaping is not URL, CSS, or
JavaScript sanitization. Do not interpolate untrusted values into
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
  plugins: [flowmark({ compilerPath: "/path/to/flowmark" })],
};
```

The plugin compiles `.flow` imports at build time using the prebuilt CLI.

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

## Run The Astro Demo

```sh
pnpm run demo
```

The demo uses Astro, Tailwind CSS 4, `@andersseen/web-components`, and the
local `@flowmark/astro` integration. Inline Flowmark templates can be authored
with the editor-compatible `<template flowmark is:raw>` wrapper:

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
invokes a prebuilt `flowmark` CLI from `PATH`; pass
`flowmark({ compilerPath: "/path/to/flowmark" })` when the binary lives
elsewhere. The integration never runs Cargo and sends templates over stdin, so
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
