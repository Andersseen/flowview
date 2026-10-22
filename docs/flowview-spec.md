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

## Conformance Requirements

Normative, testable requirements are declared as list items that start with a
bold stable ID followed by an em dash, for example
`- **SPEC-HTML-001** — Plain text is preserved exactly.`. Everything else (examples,
rationale, security guidance, non-goals, future work) is explanatory.

- IDs are assigned once. They are never renumbered or reused; a new
  requirement takes the next unused number, and a retired requirement leaves
  its number unused.
- Each ID is enforced by at least one executable test carrying a
  `@spec` annotation naming its ID. `scripts/spec-coverage.mjs` verifies the
  mapping and generates [spec-coverage.md](spec-coverage.md); see
  `CONTRIBUTING.md` for the workflow.
- Mentioning an ID elsewhere in the document (without the bold declaration
  form) is a cross-reference, not a second declaration.

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

- **SPEC-HTML-001** — Plain text is preserved exactly, including Unicode and
  significant whitespace (such as inside `<pre>`).
- **SPEC-HTML-002** — HTML-like elements and their static quoted attributes are
  emitted unchanged.
- **SPEC-HTML-003** — Quoted attributes support full-value interpolation:
  `href="{{ expr }}"` renders the escaped value of `expr`. Mixing static text
  and interpolation inside one attribute value is rejected.
- **SPEC-HTML-004** — Escaped interpolation `{{ expression }}` renders the
  HTML-escaped value of `expression`.
- **SPEC-HTML-005** — Boolean binding attributes `[disabled]`, `[hidden]`,
  `[checked]`, `[selected]`, `[required]`, `[readonly]`, `[multiple]`, and
  `[open]` emit the bare attribute when the expression is truthy and nothing
  otherwise.
- **SPEC-HTML-006** — `[attr.name]="expr"` emits `name="value"` unless the value
  is `null` or `undefined`.
- **SPEC-HTML-007** — `[class.name]="expr"` adds `name` to `class` when truthy.
  Plain and dynamic `class` values are merged with these and de-duplicated in
  order.
- **SPEC-HTML-008** — `@if`, `@else if`, and `@else` render exactly the first
  branch whose condition is truthy (or the `@else` branch), and nest.
- **SPEC-HTML-009** — `@for (item of expression)` renders its body once per
  element, with `item` scoped to the body; loops nest and inner scopes do not
  leak.
- **SPEC-HTML-010** — `@for` accepts an optional `track` expression. It is
  accepted but has no rendering effect in v1, and produces the `FV0015`
  warning.
- **SPEC-HTML-011** — `@empty` renders only when the `@for` collection is empty.
- **SPEC-HTML-012** — `@switch`, `@case`, and `@default` render exactly one
  matching branch (or the default) without fallthrough.
- **SPEC-HTML-013** — The escaping syntax markers `\@if`, `\{{`, `\{{{`, and
  `\}` render as literal text rather than starting flowview syntax.
- **SPEC-HTML-014** — Explicit `context` is the only top-level template data
  binding; the compiler does not invent aliases such as `ctx`.
- **SPEC-HTML-015** — Whitespace after a complete control-flow block is
  preserved; only whitespace that separates block continuations (`} @else`,
  `} @empty`) is consumed.

Escaped and raw interpolation, and the raw interpolation syntax
`{{{ expression }}}`, are specified in [Raw Interpolation](#raw-interpolation).

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

- **SPEC-HTML-016** — The parser recognizes `{{{` before `{{`, decides the mode
  once, and records it on the AST: `Node::Interpolation` carries
  `mode: Escaped | Raw`. Backends consume that field and never inspect source
  text for braces.
- **SPEC-HTML-017** — The expression is scanned and validated exactly like a
  `{{ }}` expression and ends at the first top-level `}}}`. An expression that
  begins with an object literal therefore needs a space or parentheses.
- **SPEC-HTML-018** — Raw interpolation works in element content and inside
  `@if`, `@for`, and `@switch` branches.
- **SPEC-HTML-019** — Raw interpolation is not interpreted in HTML comments,
  `<script>`, or `<style>`.
- **SPEC-HTML-020** — Raw interpolation in tag names, attribute names, and
  attribute values is an error (`FV0022`).
- **SPEC-HTML-021** — `\{{{` escapes the whole marker and renders literal
  `{{{`. Existing escapes (`\{{`, `\{`, `\}`) are unchanged.
- **SPEC-HTML-022** — An empty raw interpolation is `FV0023` and an unclosed one
  is `FV0024`.

Value contract (identical in both targets):

- **SPEC-HTML-023** — A string value (including `""`) is inserted unchanged. It
  is never sanitized, inspected, or classified.
- **SPEC-HTML-024** — `null`, `undefined`, and `false` render as an empty
  string.
- **SPEC-HTML-025** — Any other value (number, `true`, array, object) is an
  error and is never stringified or inferred as HTML. The JavaScript target
  throws a `TypeError` from `renderRawValue`; the static target reports
  `FV0025` with the template location.
- **SPEC-HTML-026** — Raw interpolation does not widen the static expression
  subset: `{{{ sanitize(context.body) }}}` is `FV0016`.
- **SPEC-HTML-027** — The JavaScript and static targets produce identical output
  for the shared raw-interpolation parity fixtures, including their rejected
  cases.
- **SPEC-HTML-028** — Generated modules import `renderRawValue` only when the
  template uses `{{{ }}}`, so templates without raw interpolation keep the same
  imports as before.
- **SPEC-HTML-029** — The existence of raw interpolation does not change how
  `{{ }}` behaves: both can share a template and `{{ }}` stays escaped.

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
- Optional Source Map v3 output for JavaScript compilation. Rust callers opt in
  with `CompileOptions::with_source_map(true)`; the WASM compiler and Vite/Astro
  integrations request maps for JavaScript transforms. Static HTML compilation
  does not generate JavaScript maps.

- **SPEC-HTML-030** — The JavaScript target returns generated JavaScript code,
  an optional source map, and structured warnings, or structured diagnostics.
  Diagnostics carry the configured display filename and the line offset.
- **SPEC-HTML-031** — Generated modules export exactly one function,
  `render(context)`:

  ```ts
  export function render(context: Record<string, unknown>): string;
  ```

- **SPEC-HTML-032** — Source maps are opt-in; the generated code is identical
  with and without a map.
- **SPEC-HTML-033** — Maps identify the configured source filename, include the
  template as `sourcesContent`, and expose no absolute local filesystem paths.
- **SPEC-HTML-034** — Maps map expression and control-flow positions (including
  interpolation, `@if`, `@for`, `@switch`, and attribute bindings) and the start
  of static HTML to template locations.
- **SPEC-HTML-035** — Embedded Astro compilation applies the host line and
  first-line column offsets once and includes the complete host file as
  `sourcesContent`.
- **SPEC-HTML-036** — A failure thrown while rendering generated code resolves,
  through the source map, to the template expression that caused it.
- **SPEC-HTML-037** — The Rust API, CLI, and WASM compiler expose the same
  generated code and source map, and the Vite and Astro integrations return the
  compiler map from their transforms.

Static HTML compilation returns HTML or structured diagnostics and does not
include source-map data. Neither target performs filesystem I/O; callers decide
where output goes.

## Runtime Contract

The runtime stays very small.

Required exports:

```ts
export function escapeHtml(value: unknown): string;
export function renderValue(value: unknown): string;
export function renderAttributeValue(value: unknown): string;
export function renderRawValue(value: unknown): string;

export type RenderContext = Record<string, unknown>;

export type RenderFunction<C extends RenderContext = RenderContext> = (
  context: C,
) => string;
```

Runtime behavior for v1:

- **SPEC-HTML-038** — The runtime package exports `escapeHtml`, `renderValue`,
  `renderAttributeValue`, `renderRawValue`, and the `RenderContext` and
  `RenderFunction` types.
- **SPEC-HTML-039** — `renderValue` renders `null`, `undefined`, and `false` as
  an empty string and converts other values with `String(value)`.
- **SPEC-HTML-040** — Interpolated values are HTML-escaped by default
  (`&`, `<`, `>`, `"`, `'`), which is valid for normal text and quoted HTML
  attribute values.
- **SPEC-HTML-041** — `renderAttributeValue` (used for dynamic quoted attribute
  values and `[attr.name]`) renders only `null` and `undefined` as an empty
  string, keeps `false` and `true` as strings, and escapes like `renderValue`.

Escaping is not URL, CSS, JavaScript, or policy-level sanitization.

`renderRawValue` backs `{{{ }}}` and implements the value contract of
[Raw Interpolation](#raw-interpolation) (SPEC-HTML-023, SPEC-HTML-024,
SPEC-HTML-025, SPEC-HTML-028).

## Static HTML Target

- **SPEC-HTML-042** — `render_static(template, &context, StaticRenderOptions)`
  renders `template + context → HTML string` natively in Rust, without
  generating or executing JavaScript.
- **SPEC-HTML-043** — `compile_static(template, options)` returns an immutable
  `CompiledStaticTemplate`. `template.render(&context)` returns the HTML and can
  be called any number of times (including concurrently), with no state shared
  between calls. `render_static()` is the one-off convenience over this pair.
- **SPEC-HTML-044** — Syntax errors and unsupported or invalid expressions (even
  in branches a given context would never reach) are reported by
  `compile_static`; errors that depend on the context (`FV0017`–`FV0021`,
  `FV0025`) are reported by `render`.
- **SPEC-HTML-045** — Warnings such as `FV0015` are produced once at compile
  time and exposed through `template.warnings()`; `render_static()` returns the
  same warnings in its output.
- **SPEC-HTML-046** — The context must be a JSON object and is visible to
  templates as `context`; anything else is `FV0021`, never a panic.
- **SPEC-HTML-047** — All control flow and attribute bindings are supported,
  and output matches the JavaScript target for the same data (including
  whitespace, escaping, `null`/`undefined`/`false` handling, and class
  merging).

The static target is not a static-site generator: Markdown, routing, multi-page
output, assets, themes, and components belong to the caller.

### Static expression subset

The JavaScript target accepts the full validated JavaScript expression
surface. The static target intentionally evaluates only the deterministic
subset below, with explicit scope (`context` plus `@for` loop variables):

- **SPEC-HTML-048** — Literals (strings, numbers including a leading `-`,
  `true`, `false`, `null`), identifiers (`context` and enclosing `@for` item
  names), member access (`a.b`, `a['b']`, `a[0]`; computed keys must be string
  or non-negative integer literals), and `.length` of strings (UTF-16 units)
  and arrays.
- **SPEC-HTML-049** — Unary `!`, logical `&&`, `||`, `??`, and parentheses.
- **SPEC-HTML-050** — `===`, `!==`, `==`, `!=` on primitives (loose equality
  only between same-type values or null/undefined), and `<`, `<=`, `>`, `>=` on
  number/number or string/string.
- **SPEC-HTML-051** — A missing object key or out-of-range index is
  `undefined`. Reading a property of `undefined`/`null` or of a number/boolean
  is `FV0018`; an unresolved identifier is `FV0017`.
- **SPEC-HTML-052** — Truthiness follows JavaScript (`0`, `""`, `null`,
  `undefined`, `false` are falsy; empty arrays and objects are truthy).
- **SPEC-HTML-053** — Anything else (function calls, arrow functions,
  ternaries, template literals, optional chaining, arithmetic, array/object
  literals, computed keys, ...) is rejected with `FV0016` even though it is
  valid for the JavaScript target. All expressions are checked before
  rendering, so errors do not depend on the data or on which branch runs.
- **SPEC-HTML-054** — In the static target `@for` accepts an array;
  `null`/`undefined` count as empty. Other values fail with `FV0019`.
- **SPEC-HTML-055** — Arrays and objects cannot be interpolated or used as
  attribute values (`FV0020`). Numbers render like JavaScript for integers and
  ordinary decimals.

Raw interpolation (`{{{ }}}`) in the static target follows the value contract
of [Raw Interpolation](#raw-interpolation) (SPEC-HTML-023 to SPEC-HTML-025).

Static diagnostics: `FV0016` unsupported expression, `FV0017` unresolved
identifier, `FV0018` invalid member access, `FV0019` invalid iterable, `FV0020`
unsupported value, `FV0021` invalid context (not a JSON object).

- **SPEC-HTML-056** — CLI:
  `flowview compile page.flow --target static-html [--data context.json]
[--out page.html]` renders static HTML. Without `--data` the context is `{}`;
  `--data` is only valid with the static target and must be a JSON object file.
- **SPEC-HTML-057** — The CLI JavaScript target is the default, compiles a file
  or stdin, writes to stdout or `--out`, reports diagnostics for humans by
  default and as JSON with `--diagnostic-format json`, and applies
  `--line-offset` to diagnostic lines.

## Security Model

flowview templates must be treated as trusted source code.

The compiler preserves expressions as JavaScript source and emits them into
generated modules. This means templates must not come from users unless the host
application provides a sandbox.

v1 documentation must clearly explain:

- Templates are trusted source code.
- Values interpolated with `{{ }}` are escaped by default (SPEC-HTML-004,
  SPEC-HTML-040).
- `{{{ }}}` is an explicit assertion by the template author that the value is
  already trusted or sanitized HTML. flowview does not sanitize it, so passing
  untrusted markup is an XSS vulnerability. Its existence does not change how
  `{{ }}` behaves.
- Escaping does not make every HTML context safe.
- Untrusted values must not be placed into `<script>`, `<style>`, event-handler
  attributes, or URL-bearing attributes without host-side validation.
- Runtime compilation is not recommended for production.

Observable security boundary:

- **SPEC-HTML-058** — Raw interpolation is the only position that emits a value
  unescaped; hostile values in every other interpolation position stay inert.

## HTML Parsing

The compiler is not a full browser-grade HTML parser for v1, but the supported
subset is explicit and tested.

Required behavior:

- **SPEC-HTML-059** — Normal opening and closing tags and self-closing tags are
  parsed into an element tree.
- **SPEC-HTML-060** — HTML void elements are emitted using self-closing syntax
  (for example, `<br/>`), including when the source omits the slash.
- **SPEC-HTML-061** — Interpolation in unquoted attributes is rejected.
- **SPEC-HTML-062** — Flowview control syntax is not detected inside HTML
  comments, `<script>`, or `<style>`.
- **SPEC-HTML-063** — Flowview control syntax is not detected inside tag names,
  attribute names, or attribute values (other than the supported interpolation
  forms).
- **SPEC-HTML-064** — `@` inside normal words or email-like text is plain text,
  and control keywords require word boundaries.
- **SPEC-HTML-065** — HTML tag names, including raw-text elements, match
  case-insensitively.
- **SPEC-HTML-066** — `<!DOCTYPE>` declarations are preserved.
- **SPEC-HTML-067** — Malformed tags and malformed blocks (unclosed tags,
  unclosed blocks, unexpected `@else`, `@empty`, `@case`, `@default`, malformed
  `@switch`) produce clear diagnostics.

Static text and static attributes are preserved (SPEC-HTML-001, SPEC-HTML-002).

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

- **SPEC-HTML-068** — Every expression in the positions above is validated at
  compile time, and invalid JavaScript fails with `FV0011` and a diagnostic
  that points to the original template location.
- **SPEC-HTML-069** — Empty expressions and conditions are rejected.
- **SPEC-HTML-070** — Expression scanning understands JavaScript: closing
  delimiters, parentheses, and braces inside string, template, and regular
  expression literals and comments do not end an expression.
- **SPEC-HTML-071** — The `@for` header is `item of expression` with an optional
  `; track expression`. Semicolons inside the iterable expression are allowed;
  an invalid header, an empty `track`, or an invalid or internal loop binding is
  rejected.

## Diagnostics

- **SPEC-HTML-072** — Each diagnostic includes a human-readable message,
  severity, source filename, line, column, start byte offset, end byte offset,
  and an optional diagnostic code.
- **SPEC-HTML-073** — Start and end offsets are byte offsets within the source
  that lie on UTF-8 character boundaries, including for multibyte text and
  malformed input.
- **SPEC-HTML-074** — Diagnostics render in a human-readable form and as JSON,
  and name the caller's display filename.

Diagnostic codes are stable, e.g. `FV0011` for invalid JavaScript expressions.
Static-target codes are `FV0016`–`FV0021` (see Static HTML Target). Raw
interpolation uses `FV0022` (unsupported location), `FV0023` (empty), `FV0024`
(unclosed), and, in the static target, `FV0025` (value is not a string, `null`,
`undefined`, or `false`). Their behavior is specified by the requirements that
introduce them.

## Code Generation

The rules below describe the JavaScript target. Generated JavaScript is predictable, readable, and safe.

Required behavior:

- **SPEC-HTML-075** — Output is deterministic: the same template and options
  always produce byte-identical code.
- **SPEC-HTML-076** — Dynamic text values go through `renderValue`, dynamic
  quoted attribute values go through `renderAttributeValue`, and `{{{ }}}`
  values go through `renderRawValue`.
- **SPEC-HTML-077** — Generated string literals escape backslashes, quotes,
  newlines, carriage returns, tabs, Unicode line separators, and other control
  characters.
- **SPEC-HTML-078** — `@for` normalizes iterables with `Array.from(value ?? [])`
  and renders `@empty` only when the normalized collection is empty
  (SPEC-HTML-011).

`track` remains reserved (SPEC-HTML-010) and `@switch` avoids accidental
fallthrough (SPEC-HTML-012).

## Vite Plugin

The Vite plugin compiles `.flow` imports at build time.

Required behavior:

- **SPEC-HTML-079** — `.flow` imports are compiled by the plugin's transform
  hook (used by the dev server), and files that are not `.flow` are left alone.
- **SPEC-HTML-080** — `.flow` imports are compiled during a production build,
  so the built output contains precompiled render code and no compiler.
- **SPEC-HTML-081** — Compiler diagnostics (and warnings) surface as Vite errors
  (and warnings) with the file and template location.
- **SPEC-HTML-082** — A custom compiler path (`compilerPath`) is supported.
- **SPEC-HTML-083** — The compiler is resolved in order: explicit
  `compilerPath`, `FLOWVIEW_COMPILER_PATH`, a native binary in the monorepo
  `target/` directory, then the bundled WASM compiler (no Rust toolchain or
  `PATH` lookup required).
- **SPEC-HTML-084** — TypeScript declarations for `*.flow` imports are provided
  by `@flowview/vite/client`.
- **SPEC-HTML-085** — A changed `.flow` file invalidates its transformed module
  during dev.

## Astro Integration

Astro is the primary integration path for v1.

Required behavior:

- **SPEC-HTML-086** — The Astro integration registers the flowview Vite plugin,
  so standalone `.flow` imports work inside Astro.
- **SPEC-HTML-087** — Embedded `<template flowview ... is:raw>` regions are
  compiled and replaced by their rendered output, without a wrapper component
  or manual compiler API calls in user code.
- **SPEC-HTML-088** — `flowview={expression}` is the shorthand context form and
  `context={expression}` is the explicit form; combining both is rejected.
- **SPEC-HTML-089** — Regions without `is:raw` are accepted at compile time
  (`is:raw` is still required for clean `astro check` and editor diagnostics,
  and is the recommended form).
- **SPEC-HTML-090** — Existing Astro frontmatter is preserved, and frontmatter
  is created when the file has none.
- **SPEC-HTML-091** — Surrounding Astro markup is preserved.
- **SPEC-HTML-092** — Embedded templates are compiled before Astro treats
  flowview syntax as normal Astro markup: the embedded plugin is ordered after
  flowview Events and before `astro:build`.
- **SPEC-HTML-093** — Embedded diagnostics carry correct host-file line offsets.
- **SPEC-HTML-094** — Template-discovery errors (a missing `context`, a missing
  closing tag) surface as located diagnostics.
- **SPEC-HTML-095** — Template discovery ignores `<template>` text inside HTML
  comments and raw-text elements and similarly named tags, and accepts
  case-insensitive closing tags.

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

- **SPEC-HTML-096** — `.flow` syntax highlighting for control-flow keywords,
  `of`/`track`, escaped and raw interpolation, and escape markers.
- **SPEC-HTML-097** — Snippets for `@if`, `@for` (with `@empty`), and
  `@switch`, and an Astro snippet for the recommended wrapper form.
- **SPEC-HTML-098** — A Prettier plugin (`@flowview/prettier`) wraps
  prettier-plugin-astro and preserves flowview template regions byte-for-byte,
  so no `prettier-ignore` comments are needed.
- **SPEC-HTML-099** — Embedded highlighting for `<template flowview is:raw>`
  inside `.astro`.
- **SPEC-HTML-100** — The VS Code extension runs the bundled FlowView compiler
  against standalone `.flow` buffers on open, save, and debounced changes;
  compiler error/warning severity and codes are preserved, and diagnostics
  clear after fixes or close.
- **SPEC-HTML-101** — VS Code discovers every inline Astro FlowView region with
  the same Astro AST helper used by `@flowview/astro`, reports wrapper and
  compiler diagnostics in host-file ranges, and clears diagnostics when regions
  are removed.
- **SPEC-HTML-102** — Rust UTF-8 byte spans are converted to exact VS Code
  UTF-16 ranges, including spans after ASCII, accented, Euro, CJK, astral,
  ZWJ-sequence, and replacement characters.
- **SPEC-HTML-103** — Astro Events editor diagnostics and transform ordering
  come from `@flowview/astro-events`; FlowView diagnostics after Events
  transforms map back to the original Astro source.
- **SPEC-HTML-104** — TextMate scopes identify FlowView context names, boolean,
  attribute/class and event bindings, in addition to control syntax and
  interpolation.
- **SPEC-HTML-105** — `<script>` and `<style>` regions use their embedded
  JavaScript/CSS grammars; FlowView control syntax remains literal there.

- Formatting inside flowview regions (currently preserved verbatim).
- Go-to-definition for `.flow` imports.

## Browser DOM Composition

- **SPEC-HTML-106** — `FlowviewView` resolves `data-flow-ref` attributes only
  within its current owned subtree; absent and conditional refs return `null`,
  collection refs reflect the current loop output in DOM order, and sibling views
  remain isolated.
- **SPEC-HTML-107** — `view.ref(name)` throws an actionable error when multiple
  current elements match and directs callers to `view.refs(name)`; ref names are
  compared as attribute values rather than interpolated into selectors.
- **SPEC-HTML-108** — Elements returned by `ref()` and `refs()` are snapshots of
  the current DOM; replacement may detach them, and later calls resolve the new
  nodes.
- **SPEC-HTML-109** — An outer view may resolve a ref on an active nested view's
  root, but cannot resolve refs inside that nested boundary; the nested view
  resolves its own refs.
- **SPEC-HTML-110** — An active FlowView view exclusively owns its exact root;
  creating another owner fails, and idempotent disposal releases ownership
  without clearing rendered DOM.
- **SPEC-HTML-111** — `view.bind(source)` accepts current-value sources by the
  structural `subscribe(callback)` contract, performs an immediate initial
  render, and updates synchronously; FlowView `Signal` and `Computed` satisfy it.
- **SPEC-HTML-112** — A view permits one active binding; the idempotent stop
  function disconnects only that source, permits later manual updates and
  rebinding, and synchronous render errors propagate without leaving a failed
  initial subscription active.
- **SPEC-HTML-113** — `view.dispose()` is idempotent and terminal, stops the
  binding, leaves current DOM in place, and makes later render/update/ref/refs/
  bind operations fail clearly.
- **SPEC-HTML-114** — Parent replacement disposes active descendant views before
  replacing their DOM, stopping their bindings and making the child view
  terminal.
- **SPEC-HTML-115** — FlowView Events delegated handlers continue working with
  the current DOM after a view replacement triggered through `bind()`.
- **SPEC-HTML-116** — DOM exposes the structural value-source contract without a
  runtime Reactive dependency; Reactive primitives remain usable without the
  DOM package, while both packages compose through `subscribe()`.
- **SPEC-HTML-117** — `data-flow-ref` is an ordinary HTML attribute preserved
  by both JavaScript and static output; the compiler does not assign it special
  syntax or runtime meaning.

## Native Browser Forms and Replacement

These requirements describe the browser behavior of existing HTML attributes,
FlowView Events and `@flowview/dom`. They do not add compiler property-binding
semantics. Browser acceptance currently runs in Chromium; it does not promise
identical focus, selection or composition behavior in every browser.

- **SPEC-HTML-118** — HTML attributes initialize native control defaults when
  the browser parses FlowView output. Native reflection rules determine whether
  interaction also changes a corresponding attribute; non-reflected live
  properties can diverge from serialized attributes and defaults. A later
  FlowView replacement creates new controls from the newly rendered
  attributes/content.
- **SPEC-HTML-119** — A text input's initial value is authored with its ordinary
  `value` attribute. A textarea's initial/default value is authored as its
  element text content; a `value` attribute does not set the textarea value.
  The browser's live `value` property remains locally editable until replacement.
- **SPEC-HTML-120** — Existing boolean bindings such as `[checked]`,
  `[selected]`, `[open]`, `[disabled]` and `[required]` serialize ordinary HTML
  boolean attributes. Native checkbox/radio, select/option, multiple-select,
  disabled, required and details behavior follows browser rules. `form.reset()`
  restores controls from their default attributes/content; it does not reset a
  `<details>` element. The `<details>.open` property reflects its `open`
  attribute when toggled. Replacement initializes fresh controls from rendered
  defaults.
- **SPEC-HTML-121** — FlowView Events delegates `click`, `input`, `change`,
  `submit`, `keydown`, `focus`, `blur`, `focusin`, `focusout`,
  `compositionstart`, `compositionupdate`, `compositionend` and `toggle` to
  native events. `$event`, `$el`, literal and template-scope property-path
  arguments remain native values. Focus, blur and toggle use capture delegation;
  delegated handlers continue to work on replacement nodes.
- **SPEC-HTML-122** — A FlowView submit handler receives the native submit event
  and form element. FlowView does not prevent the browser's default action; the
  application may call `preventDefault()` and read native values with APIs such
  as `FormData` before choosing whether to update a view.
- **SPEC-HTML-123** — `render()` and `update()` replace the owned `innerHTML`.
  Existing controls and refs become detached; browser-local values and node
  identity do not survive automatically, and focus, selection/caret and
  composition continuity are not promised. Callers reacquire current controls
  through scoped refs after replacement.
- **SPEC-HTML-124** — `view.bind(source)` replaces the view synchronously for
  every source emission. Applications avoid feeding every keystroke from an
  actively edited control into a bound source when they need browser-local
  editing continuity; they can commit draft values at an explicit event/update
  boundary instead.
- **SPEC-HTML-125** — Form values remain untrusted data. Rendering a submitted
  value through escaped `{{ expression }}` interpolation keeps markup inert;
  forms add no raw interpolation path.
- **SPEC-HTML-126** — `view.ref()` and `view.refs()` return the current native
  `Element` objects, which applications may narrow to native control types to
  read live properties such as `value`, `checked` and `selected`. FlowView does
  not wrap elements or introduce a form/property helper API.

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
