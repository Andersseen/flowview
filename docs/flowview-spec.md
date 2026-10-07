# flowview HTML Compiler v1 Specification

## Purpose

flowview HTML is a small compiler that turns HTML-like templates into plain
JavaScript render functions, or renders them directly to static HTML from a
JSON context. It is framework-agnostic, server-first, safe by default, and
keeps its runtime scope tiny.

There is one language, one parser, and one AST. Two output targets consume that
AST: the JavaScript target (the default and compatibility baseline) and the
static HTML target.

flowview HTML is **not** a UI framework. It does not own components, client
hydration, events, state management, routing, signals, dependency injection, or
a virtual DOM.

## Product Definition

flowview HTML v1 provides a reliable authoring format for HTML-like templates
with modern control-flow syntax.

Supported usage:

- Standalone `.flow` files.
- Embedded flowview regions inside Astro files.
- Vite-based build pipelines.
- Server-side rendering in Node.js, Hono, Cloudflare Workers, and Astro.
- Static generation workflows.

The v1 release focuses on correctness, predictable output, useful diagnostics,
and stable integration boundaries.

## Non-Goals for v1

The following stay out of the HTML compiler v1:

- DOM events (flowview Events).
- Client-side behavior.
- Hydration.
- Components.
- Signals or reactive state.
- Two-way binding.
- Routers.
- Framework-specific runtime behavior.
- User-submitted template execution.
- Runtime compilation as the default production path.

DOM events belong to a separate compiler and package: flowview Events.

## Language Surface

The stable v1 language surface includes:

- Plain text.
- HTML-like elements.
- Quoted attributes, including full-value interpolation: `href="{{ expr }}"`.
- Binding attributes:
  - `[disabled]`, `[hidden]`, `[checked]`, `[selected]`, `[required]`,
    `[readonly]`, `[multiple]`, `[open]` emit the bare attribute when the
    expression is truthy.
  - `[attr.name]="expr"` emits `name="value"` unless the value is `null` or
    `undefined`.
  - `[class.name]="expr"` adds `name` to `class` when truthy. Plain and
    dynamic `class` values are merged with these and de-duplicated in order.
- Escaped interpolation with `{{ expression }}`.
- Explicit raw HTML interpolation with `{{{ expression }}}` (see
  [Raw Interpolation](#raw-interpolation)).
- `@if`, `@else if`, and `@else`.
- `@for`, optional `track`, and `@empty`.
- `@switch`, `@case`, and `@default`.
- Escaping syntax markers: `\@if`, `\{{`, `\{{{`, `\}`.
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

## Raw Interpolation

`{{{ expression }}}` is a deliberate, narrowly scoped addition to the language
surface. It lets a caller that already owns trusted HTML insert it into a
template without escaping:

```text
{{ value }}     → escaped interpolation
{{{ value }}}   → explicit raw HTML interpolation
```

Syntax and parsing:

- The parser recognizes `{{{` before `{{`. It decides the mode once and records
  it on the AST: `Node::Interpolation` carries `mode: Escaped | Raw`. Backends
  consume that field and never inspect source text for braces.
- The expression is scanned and validated exactly like a `{{ }}` expression and
  ends at the first top-level `}}}`. An expression that begins with an object
  literal therefore needs a space or parentheses.
- Raw interpolation is content interpolation only. It works in element content
  and inside `@if`, `@for`, and `@switch` branches. It is not interpreted in
  HTML comments, `<script>`, or `<style>`, and it is an error in tag names,
  attribute names, and attribute values (`FV0022`).
- `\{{{` escapes the whole marker and renders literal `{{{`. Existing escapes
  (`\{{`, `\{`, `\}`) are unchanged.

Value contract (identical in both targets):

| value                         | result                                           |
| ----------------------------- | ------------------------------------------------ |
| string (including `""`)       | inserted unchanged                               |
| `null`, `undefined`, `false`  | empty string                                     |
| number, `true`, array, object | error: never stringified, never inferred as HTML |

The JavaScript target throws a `TypeError` from `renderRawValue`; the static
target reports `FV0025` with the template location. Raw interpolation does not
widen the static expression subset: `{{{ sanitize(context.body) }}}` is
`FV0016`.

There is no configuration option that disables escaping globally. The choice is
made at the exact template location where raw HTML is inserted. flowview does
not sanitize, inspect, or classify raw values; see
[Security Model](#security-model).

## Compiler Contract

The compiler accepts:

- Template source.
- Filename or display name.
- Runtime import path.
- Line offset for embedded templates.
- An output target: JavaScript (`compile`) or static HTML (`render_static`).
- Source map options when implemented.

The JavaScript target returns generated JavaScript code or structured
diagnostics. The static HTML target additionally takes a JSON context and
returns an HTML string or structured diagnostics. Neither target performs
filesystem I/O; callers decide where output goes.

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
export function renderRawValue(value: unknown): string;

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

`renderRawValue` backs `{{{ }}}`: it returns strings unchanged, renders `null`,
`undefined`, and `false` as an empty string, and throws a `TypeError` for every
other value. Generated modules import it only when the template uses `{{{ }}}`,
so templates without raw interpolation keep the same imports as before.

## Static HTML Target

`render_static(template, &context, StaticRenderOptions)` renders
`template + context → HTML string` natively in Rust. It does not generate or
execute JavaScript and needs no Node.js, browser, or `@flowview/*` package.
It is not a static-site generator: Markdown, routing, multi-page output,
assets, themes, and components belong to the caller.

The context must be a JSON object and is visible to templates as `context`.
All existing control flow and attribute bindings are supported, and output
matches the JavaScript target for the same data (including whitespace,
escaping, `null`/`undefined`/`false` handling, and class merging).

### Static expression subset

The JavaScript target accepts the full validated JavaScript expression
surface. The static target evaluates only this subset, with explicit scope
(`context` plus `@for` loop variables):

- Literals: strings, numbers (including a leading `-`), `true`, `false`,
  `null`.
- Identifiers: `context` and enclosing `@for` item names.
- Member access: `a.b`, `a['b']`, `a[0]` (computed keys must be string or
  non-negative integer literals).
- `.length` of strings (UTF-16 units) and arrays.
- Unary `!`; logical `&&`, `||`, `??`; parentheses.
- `===`, `!==`, `==`, `!=` on primitives (loose equality only between
  same-type values or null/undefined), and `<`, `<=`, `>`, `>=` on
  number/number or string/string.

A missing object key or out-of-range index is `undefined`. Reading a property
of `undefined`/`null` or of a number/boolean is an error. Truthiness follows
JavaScript (`0`, `""`, `null`, `undefined`, `false` are falsy; empty arrays
and objects are truthy).

Anything else (function calls, arrow functions, ternaries, template literals,
optional chaining, arithmetic, array/object literals, computed keys, ...)
is rejected with `FV0016` even though it is valid for the JavaScript target.
All expressions are checked before rendering, so errors do not depend on the
data or on which branch runs.

`@for` accepts an array; `null`/`undefined` count as empty. Other values fail
with `FV0019`. Arrays and objects cannot be interpolated or used as attribute
values (`FV0020`). Numbers render like JavaScript for integers and ordinary
decimals.

Raw interpolation (`{{{ }}}`) renders string values verbatim and other values
as described in [Raw Interpolation](#raw-interpolation); a value that is not a
string, `null`, or `false` fails with `FV0025`.

Static diagnostics: `FV0016` unsupported expression, `FV0017` unresolved
identifier, `FV0018` invalid member access, `FV0019` invalid iterable, `FV0020`
unsupported value, `FV0021` invalid context (not a JSON object).

CLI: `flowview compile page.flow --target static-html [--data context.json]
[--out page.html]`. Without `--data` the context is `{}`.

## Security Model

flowview templates must be treated as trusted source code.

The compiler preserves expressions as JavaScript source and emits them into
generated modules. This means templates must not come from users unless the host
application provides a sandbox.

v1 documentation must clearly explain:

- Templates are trusted source code.
- Values interpolated with `{{ }}` are escaped by default.
- `{{{ }}}` is an explicit assertion by the template author that the value is
  already trusted or sanitized HTML. flowview does not sanitize it, so passing
  untrusted markup is an XSS vulnerability. Its existence does not change how
  `{{ }}` behaves.
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
- Avoid detecting flowview control syntax inside:
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
- `{{{ expression }}}`.
- `@if (expression)`.
- `@else if (expression)`.
- `@for (item of expression)`.
- `track expression`.
- `@switch (expression)`.
- `@case (expression)`.
- Quoted attribute values: `attr="{{ expression }}"`.

Validation uses a real JavaScript parser and applies to both targets. The
static target then further restricts expressions to the subset above.

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

Diagnostic codes are stable, e.g. `FV0011` for invalid JavaScript expressions.
Static-target codes are `FV0016`–`FV0021` (see Static HTML Target). Raw
interpolation uses `FV0022` (unsupported location), `FV0023` (empty), `FV0024`
(unclosed), and, in the static target, `FV0025` (value is not a string, `null`,
`undefined`, or `false`).

## Code Generation

The rules below describe the JavaScript target. Generated JavaScript is predictable, readable, and safe.

Required behavior:

- Static HTML is emitted efficiently.
- Dynamic values go through `renderValue`; `{{{ }}}` values go through
  `renderRawValue`.
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
- Support embedded `<template flowview={...} is:raw>` regions.
- Accept `flowview={expression}` as the shorthand context form and
  `context={expression}` as the explicit form; reject combining both.
- Accept regions without `is:raw` at compile time, while documenting that
  `is:raw` is required for clean `astro check` and editor diagnostics.
- Preserve Astro frontmatter.
- Preserve surrounding Astro markup.
- Compile embedded templates before Astro treats flowview syntax as normal Astro
  markup.
- Accept `is:raw` as the recommended editor-compatible form.
- Produce correct line offsets for embedded diagnostics.
- Avoid requiring a wrapper component.
- Avoid manual compiler API calls inside user code.
- Surface template-discovery errors as located Vite diagnostics.

## Server Usage with Hono or Plain Node.js

Because flowview generates a plain `render(context)` function, it can be used
from any server runtime. Import a `.flow` file through the Vite plugin (or
compile it with the CLI) and call `render(context)` inside a request handler.

### Hono example

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
    const html = render({ title: "Hello from flowview" });
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
  and preserves flowview template regions byte-for-byte, so no
  `prettier-ignore` comments are needed.
- Embedded highlighting for `<template flowview is:raw>` inside `.astro`.
- Astro snippet for the recommended wrapper form.

Future support:

- Diagnostics in editor.
- Formatting inside flowview regions (currently preserved verbatim).
- Go-to-definition for `.flow` imports.

## Test Strategy

Every supported behavior has at least one test at the lowest useful layer:

- Compiler tests for parsing, codegen, diagnostics, and expression validation.
- Runtime tests for escaping and value rendering.
- Vite tests for dev/build transforms and diagnostics.
- Astro tests for standalone and embedded templates.
- CLI tests for stdin/file output, JSON diagnostics, and line offsets.

## Release Readiness

flowview HTML v1 is ready when:

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

The v1 goal is not to make flowview large. The v1 goal is to make the small
thing trustworthy:

```txt
Template in.
Safe HTML string render function out.
Clear diagnostics when something is wrong.
No framework assumptions.
```
