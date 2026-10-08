# flowview

[![CI](https://github.com/andersseen/flowview/actions/workflows/ci.yml/badge.svg)](https://github.com/andersseen/flowview/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40flowview%2Fvite.svg?label=%40flowview%2Fvite)](https://www.npmjs.com/package/@flowview/vite)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-flowview--demo.pages.dev-4c1)](https://flowview-demo.pages.dev/)

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

## Contents

- [Status](#status)
- [What flowview Is](#what-flowview-is)
- [What flowview Is Not](#what-flowview-is-not)
- [Why It Exists](#why-it-exists)
- [Supported Syntax](#supported-syntax)
- [Security Model](#security-model)
- [Repository Layout](#repository-layout)
- [Requirements](#requirements)
- [Install](#install)
- [Build](#build)
- [Use With Vite](#use-with-vite)
- [Use In The Browser](#use-in-the-browser)
- [Optional Reactivity](#optional-reactivity)
- [Use With Hono or Plain Node.js](#use-with-hono-or-plain-nodejs)
- [Test](#test)
- [flowview Events](#flowview-events)
- [Run The Astro Demo](#run-the-astro-demo)
- [Run The Hono Demo](#run-the-hono-demo)
- [Editor Support](#editor-support)
- [Run The CLI](#run-the-cli)
- [Contributing](#contributing)
- [Specification](#specification)
- [Security](#security)
- [License](#license)

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
- A tiny browser DOM runtime package: `@flowview/dom`
- An optional, dependency-free reactive primitives package: `@flowview/reactive` (`signal`/`computed`/`effect`)
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
- Signals built into the compiler or DOM runtime (an optional `@flowview/reactive` package exists; nothing requires it)
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
- Explicit raw HTML interpolation: `{{{ context.contentHtml }}}` (see
  [Raw HTML interpolation](#raw-html-interpolation))
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

Binding attributes: `[disabled]` (and `hidden`, `checked`, `selected`,
`required`, `readonly`, `multiple`, `open`), `[attr.name]="expr"`, and
`[class.name]="expr"`. Full-value interpolation (`href="{{ expr }}"`) is also
supported.

In the JavaScript target, iterables are normalized with `Array.from`, so
arrays, sets, maps, generators, and array-like objects can be rendered.

`track` is accepted as reserved syntax for future integrations. Since flowview
currently renders strings and does not diff DOM nodes, `track` has no runtime
effect today.

The render data is always available inside a flowview template as `context`.
There is no implicit `ctx` alias. In Astro, `context={value}` supplies the value
and the template reads it as `context.*`.

To render syntax markers literally in text, escape the leading character:
`\@if`, `\{{`, `\{{{`, and `\}`.

Control-flow markers are recognized in template content, not inside HTML tag
attributes, HTML comments, `<script>`, or `<style>` elements. An `@` embedded in
a word, such as `contact@if.example`, is also plain text.

### Raw HTML interpolation

```text
{{ value }}     → escaped interpolation (the default, always safe in text)
{{{ value }}}   → explicit raw HTML interpolation
```

`{{{ expression }}}` inserts a value verbatim, without escaping, so a caller
that already owns trusted HTML can compose it into a flowview layout:

```text
<main>
  <h1>{{ context.title }}</h1>
  <article>{{{ context.bodyHtml }}}</article>
</main>
```

- It is a content feature. It works in element content and inside `@if`,
  `@for`, and `@switch` branches. It is rejected (`FV0022`) inside tag names,
  attribute names, and attribute values.
- Only strings are inserted. `null`, `undefined`, and `false` render as an empty
  string; numbers, `true`, arrays, and objects are an error (a `TypeError` from
  the JavaScript target, `FV0025` from the static target), never silently
  stringified.
- flowview does not sanitize, inspect, or "fix" raw values. You assert the
  value is trusted or already sanitized; sanitize before passing it in. There is
  no global switch that disables escaping.
- Use `\{{{` for a literal `{{{`. An expression that starts with an object
  literal needs a space or parentheses (`{{ { a: 1 }.a }}`), because `{{{` always
  starts raw interpolation.

See [Security Model](#security-model) before using it.

## Security Model

`.flow` files are trusted source code. flowview preserves expressions as
JavaScript source strings and emits them into the generated render function.
Do not compile user-submitted templates unless you sandbox the generated code
yourself.

Values interpolated from `context` with `{{ ... }}` are escaped by default
through `@flowview/runtime`.

`{{{ ... }}}` is the only way to insert unescaped HTML, and it is opt-in at the
exact template location where it is written. It means: _the template author
asserts this value is already trusted or sanitized HTML._ flowview does not
sanitize it. Rendering untrusted input with `{{{ context.userSuppliedHtml }}}`
is a cross-site scripting (XSS) vulnerability. Raw interpolation does not
weaken `{{ ... }}`, which escapes exactly as before. See
[SECURITY.md](./SECURITY.md).

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
│   ├── flowview-cli/        # Rust CLI binary
│   └── flowview-wasm/       # WASM wrapper for the compiler
├── packages/
│   ├── runtime/             # TypeScript runtime helpers
│   ├── reactive/            # Optional signal/computed/effect primitives
│   ├── dom/                 # Browser DOM view helper
│   ├── compiler/            # WASM wrapper used by the plugins
│   ├── vite/                # Standalone .flow imports
│   ├── astro/               # Astro integration
│   ├── events/              # Browser event bindings compiler
│   ├── astro-events/        # Astro integration for event bindings
│   ├── vite-events/         # Vite integration for event bindings
│   ├── prettier/            # Prettier plugin for .astro files
│   └── vscode-flowview/     # Editor support
├── examples/
│   ├── basic/               # Small .flow examples
│   ├── astro-demo/          # Astro demo site
│   └── hono-demo/          # Vite + Hono demo site
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

The plugin compiles `.flow` imports at build time with the bundled Rust-to-WASM
compiler and returns a Source Map v3 for generated render functions. Dynamic
expressions and control-flow conditions resolve to their original `.flow`
locations in errors and devtools. Astro's inline integration maps embedded
expressions back to the host `.astro` file. The monorepo discovers a native
`flowview` binary for development; `compilerPath` and
`FLOWVIEW_COMPILER_PATH` remain available as explicit native overrides.

Rust callers can request a map without paying the generation cost by default:

```rust
let output = flowview_compiler::compile(
    "<h1>{{ context.title }}</h1>",
    flowview_compiler::CompileOptions::new("@flowview/runtime")
        .with_filename("src/page.flow")
        .with_source_map(true),
)?;
let source_map_json = output.source_map.expect("requested source map");
```

The CLI's `--source-map` option writes a JSON object containing `code` and
`sourceMap` to stdout; with `--out`, it writes a `.map` sidecar.

TypeScript projects that import `.flow` files can add the bundled module
declaration to their `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@flowview/vite/client"]
  }
}
```

## Use In The Browser

`@flowview/dom` connects an already-compiled flowview render function to a
native DOM element. It does not own state, add reactivity, diff DOM nodes, or
compile templates at runtime.

```ts
import { createView } from "@flowview/dom";
import { render } from "./items.flow";

const view = createView("#items", render);

view.render({
  items: [],
});

view.update({
  items: [{ id: 1, name: "Ship flowview" }],
});
```

Both `render()` and `update()` currently replace the target contents with the
compiled HTML. They are separate public concepts so the update strategy can
improve later without changing application code.

When a `.flow` file uses flowview Events, import its virtual events module from
the client entry so delegated handlers are registered once:

```ts
import "virtual:flowview-events/src/views/items.flow.ts";
```

## Optional Reactivity

Explicit updates are always valid on their own:

```ts
view.update({
  loading: true,
  items,
});
```

`@flowview/reactive` is an optional package for applications that would
rather not track by hand which UI-relevant values changed. It exports
`signal()`, `computed()`, `effect()`, and `untracked()` — a small,
dependency-free, fine-grained reactive core with no relation to Flowview's
compiler or DOM runtime.

```ts
import { effect, signal } from "@flowview/reactive";
import { createView } from "@flowview/dom";
import { render } from "./items.flow";

const state = signal({
  loading: false,
  items: [],
});

const view = createView("#items", render);

effect(() => {
  view.update(state());
});

state.update((current) => ({ ...current, loading: true }));
```

- Signals are optional. Nothing in the compiler, `@flowview/dom`, or
  Flowview Events requires them, and neither depends on the `@flowview/reactive`
  package.
- Flowview does not own application state; `signal()` just holds a value your
  code reads and writes.
- There is no component model or lifecycle, no automatic hydration, and no
  `connect(view, ...)` adapter. `effect()` is a generic reactive primitive,
  not a rendering lifecycle — calling `view.update()` from inside one is
  ordinary application code, not a Flowview feature.
- The `client-dom` example (`examples/astro-demo/src/pages/client-dom.astro`
  and `src/state/client-state.ts`) shows the full pattern: a Flowview Events
  handler updates a signal, and the one `effect()` in the page is what turns
  that into a `view.update()` call.

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
- highlighting for raw interpolation (`{{{ ... }}}`) alongside `{{ ... }}`

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

## Static HTML Output

Besides the JavaScript module, the same parser and AST can render a template
straight to HTML from a JSON context, natively in Rust (no Node.js, browser, or
JavaScript engine):

```sh
flowview compile page.flow --target static-html --data context.json --out page.html
```

Without `--data` the context is `{}`. From Rust:

```rust
use flowview_compiler::{render_static, StaticRenderOptions};

let out = render_static(template, &serde_json::json!({"title": "Hi"}), StaticRenderOptions::default())?;
println!("{}", out.html);
```

`render_static()` is the one-off convenience. To render the same template many
times, compile it once; parsing, validation, and expression lowering then
happen a single time and each `render` only evaluates against the context:

```rust
use flowview_compiler::compile_static;

let template = compile_static(layout_source, Default::default())?; // compile errors
for context in contexts {
    let html = template.render(&context)?; // context-dependent errors only
}
// template.warnings() holds compile-time warnings (e.g. the `track` warning).
```

Static rendering supports all control flow and attribute bindings, but only a
deterministic expression subset: `context`, loop variables, member access
(`a.b`, `a['b']`, `a[0]`), `.length`, literals, `!`, `&&`, `||`, `??`, and
comparisons. Function calls and other JavaScript fail with diagnostic
`FV0016`. See the spec for the exact subset. flowview is a renderer, not a
static-site generator; routing, Markdown, and multi-page builds are up to the
caller. The WASM/`@flowview/compiler` wrapper does not expose static rendering
yet.

Raw interpolation works in both targets with the same contract. In static mode
`{{{ context.contentHtml }}}` emits the JSON string verbatim, so a caller can
compose HTML it already trusts into a layout:

```sh
echo '{"title":"<A>","bodyHtml":"<h2>Hi</h2>"}' > context.json
printf '<h1>{{ context.title }}</h1>{{{ context.bodyHtml }}}' \
  | flowview compile - --target static-html --data context.json
# <h1>&lt;A&gt;</h1><h2>Hi</h2>
```

Static raw interpolation does not widen the expression subset:
`{{{ sanitize(context.body) }}}` still fails with `FV0016`. Sanitize before
calling flowview.

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
