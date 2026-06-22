# Flowmark Specification

Status: Draft  
Audience: Flowmark maintainers, contributors, and integration authors

## 1. Purpose

Flowmark is a framework-agnostic template language and compiler for authoring
HTML-like templates with modern control-flow syntax.

Its core purpose is to make this authoring style:

```text
<section>
  <h1>{{ context.title }}</h1>

  @if (context.products.length > 0) {
    @for (product of context.products; track product.id) {
      <article>{{ product.name }}</article>
    }
  } @else {
    <p>No products found.</p>
  }
</section>
```

compile into plain JavaScript render functions that can be used from many host
environments, including Astro, React, Vite-based apps, Node.js servers, and
other JavaScript runtimes.

Flowmark should feel closer to a portable template format, like TSX is a
portable authoring format for component trees, than to a complete UI framework.

## 2. Product Thesis

Flowmark exists because modern template control flow is productive, but it is
usually locked inside a specific framework. Flowmark should separate the
authoring syntax from the host framework.

The project should provide:

- A small compiler for the Flowmark syntax.
- A minimal runtime for safe value rendering.
- A CLI for direct use.
- Editor support for `.flow` files and embedded Flowmark regions.
- Integration packages for build tools and frameworks.
- Demo projects that prove real usage paths.

The project should not become:

- A full UI framework.
- A component model.
- A hydration system.
- A signal/reactivity library.
- A virtual DOM.
- A replacement for Astro, React, Vue, Svelte, or Angular.

## 3. Core Principles

### 3.1 Framework Agnostic Core

The compiler must not depend on Astro, React, Vite, or any other host framework.
Framework integrations must live in separate packages.

### 3.2 Small Runtime Surface

The runtime should stay tiny. Its default responsibilities are:

- HTML escaping.
- Rendering primitive values.
- Shared helpers required by generated output.

It should not own routing, state, events, hydration, or component lifecycle.

### 3.3 Compile-Time First

Flowmark should prefer build-time compilation. Runtime compilation may exist for
demos, tests, playgrounds, or advanced use cases, but production integrations
should compile before request/render time whenever possible.

### 3.4 Trusted Templates

Flowmark templates are trusted source code. Expressions inside templates are
preserved as JavaScript source and emitted into generated modules.

User-submitted templates must not be compiled or executed unless the host
application provides its own sandbox.

### 3.5 Explicit Integration Boundaries

The core compiler emits JavaScript. Host integrations decide how generated
functions are imported, executed, cached, bundled, and mapped into framework
APIs.

## 4. Monorepo Scope

The monorepo exists because Flowmark is not just one package. It is a family of
small packages that support one language idea.

Expected package groups:

- `crates/flowmark-compiler`: Rust compiler library.
- `crates/flowmark-cli`: CLI entry point.
- `packages/runtime`: JavaScript runtime helpers.
- `packages/vite-plugin-flowmark`: Vite integration.
- `packages/astro-flowmark`: Astro integration.
- `packages/react-flowmark`: future React integration.
- `packages/vscode-flowmark`: editor support.
- `examples/*`: focused examples that prove supported workflows.

Each package must have a narrow reason to exist. Shared behavior belongs in the
compiler or runtime. Framework-specific behavior belongs in integration
packages.

## 5. Template Formats

Flowmark should support two authoring modes.

### 5.1 Standalone `.flow` Files

Standalone `.flow` files are the portable format for hosts that do not provide
an embedded authoring surface. They remain supported, but are secondary to the
current Astro milestone.

Example:

```text
<main>
  <h1>{{ context.title }}</h1>

  @for (item of context.items; track item.id) {
    <p>{{ item.label }}</p>
  } @empty {
    <p>No items.</p>
  }
</main>
```

A `.flow` file compiles to a JavaScript module exporting a render function.

Required behavior:

- `.flow` files can be compiled by the CLI.
- `.flow` files can be imported through the Vite plugin.
- Editor tooling can highlight `.flow` files.

### 5.2 Embedded Flowmark Regions

Host frameworks may support embedded Flowmark regions.

The first embedded target is Astro.

Target authoring experience:

```text
---
const context = {
  title: "Inventory",
  products: [{ id: "keyboard", name: "Keyboard" }],
};
---

<template flowmark is:raw context={context}>
  <section>
    <h1>{{ context.title }}</h1>

    @for (product of context.products; track product.id) {
      <article>{{ product.name }}</article>
    } @empty {
      <p>No products found.</p>
    }
  </section>
</template>
```

This must not require a wrapper component such as `<Flowmark>` or manual calls
to compiler APIs inside the page. `is:raw` is an editor-compatibility marker:
Astro's official Language Server needs it to keep the embedded language inert
before the Vite integration runs. The Flowmark integration replaces the whole
element during compilation.

The exact Astro syntax may evolve during implementation, but the supported
experience must remain explicit, readable, and easy for editor tooling to
detect.

## 6. Language Surface

### 6.1 Text and Markup

Flowmark accepts HTML-like text and markup. The compiler does not need to be a
complete HTML parser in the first stable version, but supported behavior must be
documented and tested.

### 6.2 Interpolation

Syntax:

```text
{{ expression }}
```

Required behavior:

- The expression is emitted as JavaScript source.
- The resulting value is escaped by default through the runtime.
- `null`, `undefined`, and `false` render as an empty string.
- HTML escaping does not imply URL, CSS, or JavaScript sanitization. Hosts must
  validate values used in those contexts.

### 6.3 Conditional Blocks

Syntax:

```text
@if (condition) {
  ...
} @else if (condition) {
  ...
} @else {
  ...
}
```

Required behavior:

- Conditions are JavaScript expressions.
- Branches may contain text, markup, interpolation, and nested control flow.

### 6.4 Iteration Blocks

Syntax:

```text
@for (item of iterable; track item.id) {
  ...
} @empty {
  ...
}
```

Required behavior:

- `iterable` is normalized with `Array.from(iterable ?? [])`.
- `@empty` renders when the normalized collection has length `0`.
- `track` is reserved for integration-level features and has no string-render
  effect until a host integration needs it.

### 6.5 Switch Blocks

Syntax:

```text
@switch (expression) {
  @case ("draft") {
    ...
  }
  @default {
    ...
  }
}
```

Required behavior:

- Switch expressions and case expressions are JavaScript expressions.
- Cases may contain nested Flowmark nodes.

### 6.6 Escaping Syntax Markers

The language must support rendering syntax markers literally.

Required escapes:

- `\@if`
- `\{{`
- `\}`

## 7. Compiler Contract

The compiler receives source text and compile options.

It returns either:

- Generated JavaScript code.
- Structured diagnostics.

The generated module must export:

```ts
export function render(context: Record<string, unknown>): string;
```

`context` is the single explicit top-level data binding available to template
expressions. Integrations pass their host value to `render`, but must not invent
aliases such as `ctx`. For example, Astro's `context={pageData}` attribute still
exposes that value inside the Flowmark region as `context`.

Compiler options should include:

- `filename`
- `runtimeImport`
- future source map options
- future output target options

Diagnostics must include:

- Message.
- Severity.
- Source location.
- Byte range.
- Optional diagnostic code.

## 8. Runtime Contract

The runtime package must expose:

```ts
export function escapeHtml(value: unknown): string;
export function renderValue(value: unknown): string;
export type RenderContext = Record<string, unknown>;
export type RenderFunction<C extends RenderContext = RenderContext> = (
  context: C,
) => string;
```

Runtime behavior must be stable before a public release because generated code
depends on it.

## 9. Vite Plugin Specification

Package name:

```text
@flowmark/vite
```

Primary goal:

Allow `.flow` files to be imported in Vite projects.

Target usage:

```ts
import flowmark from "@flowmark/vite";

export default {
  plugins: [flowmark()],
};
```

```ts
import { render } from "./template.flow";

const html = render({ title: "Hello" });
```

Required behavior:

- Transform `.flow` files into JavaScript modules.
- Use the core compiler.
- Emit framework-neutral render functions.
- Respect Vite dev server invalidation.
- Return useful compile diagnostics through Vite errors.
- Avoid runtime compilation in production builds.

Acceptance tests:

- Importing a `.flow` file in a Vite fixture works in dev.
- Importing a `.flow` file in a Vite fixture works in build.
- Compiler diagnostics surface as Vite build errors.
- Runtime import is resolved consistently.

## 10. Astro Integration Specification

Package name:

```text
@flowmark/astro
```

Primary goal:

Use Flowmark naturally inside Astro projects without a parent wrapper component
or manual compiler calls. The recommended editor-compatible wrapper includes
Astro's `is:raw` marker.

Target usage:

```js
// astro.config.mjs
import flowmark from "@flowmark/astro";

export default {
  integrations: [flowmark()],
};
```

Target standalone import:

```text
---
import { render } from "../templates/inventory.flow";

const html = render(Astro.props);
---

<Fragment set:html={html} />
```

Target embedded usage:

```text
---
const context = Astro.props;
---

<template flowmark is:raw context={context}>
  <h1>{{ context.title }}</h1>

  @if (context.featured) {
    <p>Featured</p>
  }
</template>
```

Required behavior:

- Register the Vite plugin for `.flow` imports.
- Compile embedded `<template flowmark>` regions before Astro parses them as
  normal component markup, or otherwise transform them safely during the Astro
  build pipeline.
- Preserve Astro frontmatter and surrounding Astro markup.
- Accept the editor-compatible `is:raw` marker and replace it together with the
  complete Flowmark template before Astro builds the page.
- Avoid requiring a `<Flowmark>` wrapper component.
- Render escaped HTML by default.
- Surface compiler diagnostics with useful file and line information.

Implementation note:

Astro does not treat arbitrary raw template contents as inert by default. The
integration may need a pre-transform step that finds `<template flowmark>`
regions in `.astro` files, extracts their inner Flowmark source, compiles it,
and replaces the region with generated Astro-compatible output.

The exact replacement strategy is an implementation detail, but the public
authoring experience is part of this spec.

Acceptance tests:

- An `.astro` page can use
  `<template flowmark is:raw context={context}>` without editor diagnostics.
- The build integration also accepts omission of `is:raw` for programmatic or
  non-editor-generated sources.
- The page builds without importing a `<Flowmark>` component.
- `@if`, `@for`, `@empty`, and `@switch` work inside the embedded template.
- Escaped interpolation prevents HTML injection from context values.
- Compiler errors inside embedded templates point to the `.astro` file.

## 11. React Integration Direction

React support is a future integration, not part of the first milestone.

Possible package name:

```text
@flowmark/react
```

React integration may provide:

- A helper to render compiled Flowmark output as HTML.
- Optional server component support.
- Optional build-time import support through the Vite plugin.

React integration must not force the core compiler to understand React
components, JSX props, hooks, or client hydration.

## 12. Editor Support

Editor support must make Flowmark pleasant to write before the language becomes
large.

Required support:

- `.flow` syntax highlighting.
- Snippets for core control flow.
- Embedded highlighting for Astro
  `<template flowmark is:raw context={...}>` regions.
- An Astro snippet that inserts the complete editor-compatible wrapper.

Future support:

- Diagnostics from the compiler.
- Formatting.
- Go-to-definition for imported `.flow` files.

## 13. Testing Strategy

Every feature must have at least one test at the lowest useful layer.

Compiler tests:

- Syntax parsing.
- Code generation.
- Diagnostics.
- Edge cases around strings, escaping, nesting, and malformed blocks.

Runtime tests:

- HTML escaping.
- Value rendering semantics.
- Compatibility with generated output.

Vite plugin tests:

- Dev transform.
- Production build.
- Error reporting.
- Cache invalidation.

Astro integration tests:

- Standalone `.flow` import in Astro.
- Embedded `<template flowmark is:raw>` usage.
- Static build output.
- Browser-level rendered output.

Editor tests:

- Grammar snapshots where practical.
- Fixture files for `.flow` and `.astro` embedded regions.

## 14. Milestones

### Milestone 1: Stabilize the Current Core

Definition of done:

- Compiler syntax is documented.
- Runtime contract is documented.
- Existing CLI remains working.
- Existing demo remains working.
- Compiler and runtime tests pass.

### Milestone 2: Vite Plugin

Definition of done:

- `@flowmark/vite` package exists.
- `.flow` imports work in Vite dev and build.
- Diagnostics are surfaced through Vite.
- No production runtime compilation is required.

### Milestone 3: Astro Integration

Definition of done:

- `@flowmark/astro` package exists.
- It registers Flowmark support for Astro projects.
- `.flow` imports work in Astro.
- Embedded `<template flowmark is:raw>` works in `.astro` files.
- `astro check` reports no false diagnostics for Flowmark regions.
- The demo uses the supported integration instead of the temporary wrapper
  component.

### Milestone 4: Editor Alignment

Definition of done:

- The VS Code extension highlights standalone `.flow` files.
- The VS Code extension highlights `<template flowmark is:raw>` in Astro files.
- Snippets match the documented syntax.

### Milestone 5: Framework Expansion

Definition of done:

- React usage is specified.
- React support is implemented only if the Vite and Astro paths are stable.
- Any new integration proves that the compiler remains framework-agnostic.

## 15. Non-Goals Before First Stable Release

Do not add these before the compiler, Vite plugin, and Astro integration are
stable:

- Components inside Flowmark.
- Client hydration.
- Event handlers.
- Two-way binding.
- A router.
- A state management system.
- Framework-specific syntax in the core language.
- Untrusted template execution.

## 16. Compatibility Rules

Before a stable release:

- Syntax may change.
- Generated output may change.
- Package names may change.

After a stable release:

- Runtime exports are semver-governed.
- Compiler diagnostics may improve without breaking compatibility.
- Generated output can change as long as public behavior remains stable.
- Syntax changes require migration notes.

## 17. Decision Checklist

Use this checklist when proposing a new feature.

- Does it keep the compiler framework-agnostic?
- Can it be tested without a framework?
- Does it belong in the core, or only in an integration?
- Does it increase runtime surface area?
- Does it make `.flow` files more useful?
- Does it improve the Astro/Vite path?
- Does it push Flowmark toward becoming a full framework?

If a feature pushes Flowmark toward being a full framework, it should be rejected
or moved into a separate integration package.
