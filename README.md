# Flowmark

Flowmark is a small, standalone compiler for HTML-like templates with
Angular-inspired control flow syntax. It is not a framework. It does not provide
runtime components, signals, or hydration. It only transforms `.flow` template
files into plain JavaScript render functions.

## What Flowmark Is

- A Rust template compiler crate (`flowmark-compiler`).
- A Rust CLI (`flowmark`) for compiling template files.
- A tiny TypeScript runtime package (`@flowmark/runtime`) for HTML escaping and
  render-value helpers.
- A monorepo foundation that is intentionally small and easy to extend.

## What Flowmark Is Not

- Not a framework.
- Not an Angular, React, Astro, or Hono integration.
- Not a hydration runtime.
- Not a compiler for directives, dependency injection, signals, pipes,
  components, events, or `@defer` blocks.

## Why It Exists

Modern control-flow syntax such as `@if`, `@for`, and `@switch` is productive for
templates, but it is usually tied to a full framework. Flowmark explores whether
that syntax can be compiled into plain JavaScript render functions that are
independent from any UI framework or build tool.

## Current Compiler Scope

The compiler exposes a single public function:

```rust
pub fn compile(
    source: &str,
    options: CompileOptions
) -> Result<CompileOutput, Vec<Diagnostic>>;
```

It currently supports:

- Plain text and HTML-like markup.
- Escaped interpolation: `{{ ctx.title }}`.
- Conditional blocks:
  - `@if (condition) { ... }`
  - `@else if (condition) { ... }`
  - `@else { ... }`
- Iteration blocks:
  - `@for (item of items; track item.id) { ... }`
  - `@empty { ... }` (mandatory `track` expression)
- Switch blocks:
  - `@switch (expr) { @case ('a') { ... } @default { ... } }`

Expressions are preserved as JavaScript source strings. The compiler does not
type-check or evaluate them.

## Repository Architecture

```
flowmark/
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
├── crates/
│   ├── flowmark-compiler/   # Rust compiler library
│   └── flowmark-cli/        # Rust CLI binary
├── packages/
│   └── runtime/             # TypeScript runtime
└── examples/
    ├── basic/               # Example .flow templates
    └── astro-demo/          # Astro site demo using the compiler
```

### Why Rust for the Compiler?

Rust provides a fast, safe parser and code generator that can be embedded in
build tools, CLIs, or other Rust programs without a JavaScript runtime.

### Why TypeScript for the Runtime?

The runtime is a tiny set of helpers consumed by the generated JavaScript. Using
TypeScript keeps the runtime small, typed, and tree-shakeable.

## Install Dependencies

This repository uses pnpm and Cargo. Make sure both are installed, then run:

```sh
pnpm install
```

Rust dependencies are fetched automatically by Cargo.

## Build the Project

```sh
pnpm run build
```

This builds the Rust workspace and the TypeScript runtime.

Individual builds:

```sh
pnpm run build:rust     # cargo build --workspace
pnpm run build:runtime  # pnpm --filter @flowmark/runtime build
```

## Run Tests

```sh
pnpm run test
```

Individual test suites:

```sh
pnpm run test:rust     # cargo test --workspace
pnpm run test:runtime  # pnpm --filter @flowmark/runtime test
```

## Astro Demo

The `examples/astro-demo` directory contains a working Astro site that uses the
Flowmark compiler to render `.flow` templates at build time.

```sh
cd examples/astro-demo
pnpm run dev
```

The demo compiles `src/templates/index.flow` into `src/generated/index.js` and
renders it inside an Astro page.

### Deploy the demo

Build and deploy to Cloudflare Pages from the root:

```sh
pnpm run deploy:demo
```

For CI deployment, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as
GitHub repository secrets. The workflow is defined in
`.github/workflows/deploy-demo.yml`.

## Run the CLI

Compile a `.flow` file to stdout:

```sh
cargo run -p flowmark-cli -- compile examples/basic/for.flow
```

Compile to a file:

```sh
cargo run -p flowmark-cli -- compile examples/basic/for.flow --out for.js
```

Or use the root shortcut:

```sh
pnpm run compile:example
```

## Example Flowmark Input

`examples/basic/for.flow`:

```flow
<main>
  <h1>{{ ctx.title }}</h1>

  @for (product of ctx.products; track product.id) {
    <article>{{ product.title }}</article>
  } @empty {
    <p>No products found</p>
  }
</main>
```

## Example Generated JavaScript

```js
import { escapeHtml, renderValue } from '@flowmark/runtime';

export function render(ctx) {
  let output = '';

  output += '<main>';
  output += '<h1>';
  output += renderValue(ctx.title);
  output += '</h1>';

  const __items0 = ctx.products;

  if (__items0.length === 0) {
    output += '<p>No products found</p>';
  } else {
    for (const product of __items0) {
      output += '<article>';
      output += renderValue(product.title);
      output += '</article>';
    }
  }

  output += '</main>';

  return output;
}
```

The actual compiler preserves whitespace from the template; the output above is
simplified for readability.

## Current Limitations

Flowmark is intentionally limited to control-flow compilation. It does not
support, and there are no plans to add:

- Components
- Events
- `@defer` blocks
- Signals
- Hydration
- Vite integration
- Hono integration
- Astro integration
- Angular compatibility or Angular dependencies
- Expression type-checking
- Pipes, directives, or dependency injection
- JSX or TSX

## License

MIT
