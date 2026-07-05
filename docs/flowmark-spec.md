# Flowmark HTML Compiler v1 Specification

## Purpose

Flowmark HTML is a small compiler that turns HTML-like templates into plain
JavaScript render functions. It is framework-agnostic, server-first, safe by
default, and keeps its runtime scope tiny.

Flowmark HTML is **not** a UI framework. It does not own components, client
hydration, events, state management, routing, signals, dependency injection, or
a virtual DOM.

## Product Definition

Flowmark HTML v1 provides a reliable authoring format for HTML-like templates
with modern control-flow syntax.

Supported usage:

- Standalone `.flow` files.
- Embedded Flowmark regions inside Astro files.
- Vite-based build pipelines.
- Server-side rendering in Node.js, Hono, Cloudflare Workers, and Astro.
- Static generation workflows.

The v1 release focuses on correctness, predictable output, useful diagnostics,
and stable integration boundaries.

## Non-Goals for v1

The following stay out of the HTML compiler v1:

- DOM events (Flowmark Events).
- Client-side behavior.
- Hydration.
- Components.
- Signals or reactive state.
- Two-way binding.
- Routers.
- Framework-specific runtime behavior.
- User-submitted template execution.
- Runtime compilation as the default production path.

DOM events belong to a separate compiler and package: Flowmark Events.

## Language Surface

The stable v1 language surface includes:

- Plain text.
- HTML-like elements.
- Quoted attributes.
- Escaped interpolation with `{{ expression }}`.
- `@if`, `@else if`, and `@else`.
- `@for`, optional `track`, and `@empty`.
- `@switch`, `@case`, and `@default`.
- Escaping syntax markers: `\@if`, `\{{`, `\}`.
- Explicit `context` as the only top-level template data binding.

Example:

```flow
<main>
  <h1>{{ context.title }}</h1>

  @if (context.featured) {
    <span>Featured</span>
  }

  @for (product of context.products; track product.id) {
    <article>{{ product.title }}</article>
  } @empty {
    <p>No products found.</p>
  }
</main>
```

## Compiler Contract

The compiler accepts:

- Template source.
- Filename or display name.
- Runtime import path.
- Line offset for embedded templates.
- Output target options when needed later.
- Source map options when implemented.

The compiler returns either generated JavaScript code or structured diagnostics.

Generated modules export:

```ts
export function render(context: Record<string, unknown>): string;
```

The compiler must not invent implicit aliases such as `ctx`.

## Runtime Contract

The runtime stays very small.

Required exports:

```ts
export function escapeHtml(value: unknown): string;
export function renderValue(value: unknown): string;

export type RenderContext = Record<string, unknown>;

export type RenderFunction<C extends RenderContext = RenderContext> = (
  context: C,
) => string;
```

Runtime behavior for v1:

- `null`, `undefined`, and `false` render as an empty string.
- Other values are converted to strings with `String(value)`.
- Interpolated values are HTML-escaped by default.
- Escaping is valid for normal text and quoted HTML attribute values.
- Escaping is not URL, CSS, JavaScript, or policy-level sanitization.

## Security Model

Flowmark templates must be treated as trusted source code.

The compiler preserves expressions as JavaScript source and emits them into
generated modules. This means templates must not come from users unless the host
application provides a sandbox.

v1 documentation must clearly explain:

- Templates are trusted source code.
- Interpolated values are escaped by default.
- Escaping does not make every HTML context safe.
- Untrusted values must not be placed into `<script>`, `<style>`, event-handler
  attributes, or URL-bearing attributes without host-side validation.
- Runtime compilation is not recommended for production.

## HTML Parsing

The compiler is not a full browser-grade HTML parser for v1, but the supported
subset is explicit and tested.

Required behavior:

- Parse normal opening and closing tags.
- Parse self-closing tags.
- Preserve static text.
- Preserve static attributes.
- Support quoted attributes.
- Reject interpolation in unquoted attributes.
- Avoid detecting Flowmark control syntax inside:
  - HTML comments.
  - `<script>`.
  - `<style>`.
  - Tag names.
  - Attribute names.
  - Attribute values unless explicitly supported.
- Treat `@` inside normal words or email-like text as plain text.
- Match HTML tag names case-insensitively.
- Preserve `<!DOCTYPE>` declarations.
- Produce clear diagnostics for malformed tags and malformed blocks.

## Expression Validation

The compiler validates JavaScript expressions used in:

- `{{ expression }}`.
- `@if (expression)`.
- `@else if (expression)`.
- `@for (item of expression)`.
- `track expression`.
- `@switch (expression)`.
- `@case (expression)`.
- Quoted attribute values: `attr="{{ expression }}"`.

Invalid JavaScript expressions fail at compile time with a diagnostic that
points to the original template location.

## Diagnostics

Each diagnostic includes:

- Human-readable message.
- Severity.
- Source filename.
- Line.
- Column.
- Start byte offset.
- End byte offset.
- Optional diagnostic code.

Diagnostic codes are stable, e.g. `FM0011` for invalid JavaScript expressions.

## Code Generation

Generated JavaScript is predictable, readable, and safe.

Required behavior:

- Static HTML is emitted efficiently.
- Dynamic values go through `renderValue`.
- Dynamic quoted attribute values go through `renderValue`.
- Generated string literals escape backslashes, quotes, newlines, carriage
  returns, tabs, Unicode line separators, and other control characters.
- `@for` normalizes iterables with `Array.from(value ?? [])`.
- `@empty` renders only when the normalized collection is empty.
- `track` remains reserved and has no string-rendering runtime effect in v1.
- `@switch` avoids accidental fallthrough.

## Vite Plugin

The Vite plugin compiles `.flow` imports at build time.

Required behavior:

- Compile `.flow` imports during dev.
- Compile `.flow` imports during production build.
- Surface compiler diagnostics as Vite errors.
- Support custom compiler path.
- Resolve the compiler automatically in monorepo development.
- Resolve installed CLI usage from `PATH`.
- Avoid runtime compilation in production builds.
- Provide TypeScript declaration support for `.flow` imports.
- Invalidate transformed modules correctly during dev.

## Astro Integration

Astro is the primary integration path for v1.

Required behavior:

- Support standalone `.flow` imports inside Astro.
- Support embedded `<template flowmark={...} is:raw>` regions.
- Accept `flowmark={expression}` as the shorthand context form and
  `context={expression}` as the explicit form; reject combining both.
- Accept regions without `is:raw` at compile time, while documenting that
  `is:raw` is required for clean `astro check` and editor diagnostics.
- Preserve Astro frontmatter.
- Preserve surrounding Astro markup.
- Compile embedded templates before Astro treats Flowmark syntax as normal Astro
  markup.
- Accept `is:raw` as the recommended editor-compatible form.
- Produce correct line offsets for embedded diagnostics.
- Avoid requiring a wrapper component.
- Avoid manual compiler API calls inside user code.
- Surface template-discovery errors as located Vite diagnostics.

## Server Usage with Hono or Plain Node.js

Because Flowmark generates a plain `render(context)` function, it can be used
from any server runtime. Import a `.flow` file through the Vite plugin (or
compile it with the CLI) and call `render(context)` inside a request handler.

### Hono example

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

### Plain Node.js example

```ts
import { createServer } from "node:http";
import { render } from "./page.flow";

createServer((_, response) => {
  const html = render({ title: "Hello" });
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(3000);
```

### Cloudflare Workers example

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

## Editor Support

v1 includes basic editor support:

- `.flow` syntax highlighting.
- Snippets for `@if`, `@for`, `@empty`, and `@switch`.
- A Prettier plugin (`@flowview/prettier`) that wraps prettier-plugin-astro
  and preserves Flowmark template regions byte-for-byte, so no
  `prettier-ignore` comments are needed.
- Embedded highlighting for `<template flowmark is:raw>` inside `.astro`.
- Astro snippet for the recommended wrapper form.

Future support:

- Diagnostics in editor.
- Formatting inside Flowmark regions (currently preserved verbatim).
- Go-to-definition for `.flow` imports.

## Test Strategy

Every supported behavior has at least one test at the lowest useful layer:

- Compiler tests for parsing, codegen, diagnostics, and expression validation.
- Runtime tests for escaping and value rendering.
- Vite tests for dev/build transforms and diagnostics.
- Astro tests for standalone and embedded templates.
- CLI tests for stdin/file output, JSON diagnostics, and line offsets.

## Release Readiness

Flowmark HTML v1 is ready when:

- The language surface is frozen.
- Runtime exports are stable.
- Compiler diagnostics are structured and tested.
- Vite integration works in dev and build.
- Astro integration works with embedded templates.
- The demo uses the supported integration path.
- Security documentation is clear.
- Unsupported behavior is documented.
- CI runs build, tests, typecheck, formatting, clippy, and demo checks.
- README and spec are aligned.
- No known critical parser or escaping bugs remain.

## Long-Term Direction

The v1 goal is not to make Flowmark large. The v1 goal is to make the small
thing trustworthy:

```txt
Template in.
Safe HTML string render function out.
Clear diagnostics when something is wrong.
No framework assumptions.
```
