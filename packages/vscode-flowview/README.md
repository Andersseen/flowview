# flowview Language Support

VS Code extension for [flowview](https://github.com/andersseen/flowview) templates.

## Features

- Compiler-backed errors and warnings for `.flow` files.
- Compiler-backed diagnostics for each inline FlowView region in `.astro` files.
- Syntax highlighting for `.flow` files.
- Inline flowview highlighting inside Astro
  `<template flowview={...} is:raw>` blocks.
- Snippets for flowview control flow (`@if`, `@for`, `@switch`) and Astro embedding.

Diagnostics run from the bundled `@flowview/compiler` WASM build. The installed
VSIX does not need Rust, Cargo, a native FlowView executable, a local checkout,
or network access. It compiles the current editor buffer and never evaluates
template expressions or type-checks the user context.

Diagnostics run when a document opens or saves, and after a short debounce while
it changes. Errors and warnings retain their compiler severity and code. They
clear when corrected, when an Astro file no longer contains a FlowView region,
or when the document closes. Astro region discovery is shared with the
`@flowview/astro` transform, and Events errors come from the existing Events
compiler pipeline.

FlowView syntax is not parsed in Astro `<script>` or `<style>` content. The
extension does not provide completion, rename, type inference, or a formatter.

## Supported syntax

### Interpolation

```flowview
<h1>{{ context.title }}</h1>
```

### Conditional blocks

```flowview
@if (context.featured) {
  <span>Featured</span>
} @else if (context.promo) {
  <span>Promo</span>
} @else {
  <span>Standard</span>
}
```

### Repeat blocks

```flowview
@for (product of context.products; track product.id) {
  <article>{{ product.name }}</article>
} @empty {
  <p>No products found.</p>
}
```

### Switch blocks

```flowview
@switch (product.status) {
  @case ('available') { <span>In stock</span> }
  @case ('sale') { <span>On sale</span> }
  @default { <span>Unavailable</span> }
}
```

### Escapes

flowview control markers can be escaped with a backslash:

```flowview
<p>\@if and \{{ are rendered as literal text.</p>
```

Raw HTML interpolation (`{{{ context.contentHtml }}}`) is highlighted like
`{{ ... }}`. It inserts trusted HTML without escaping. FlowView templates are
trusted source; the runtime is not a sanitizer.

## Usage in Astro

The extension injects the flowview grammar inside
`<template flowview is:raw>` tags:

```text
---
const context = {
  title: "Inventory",
  featured: true,
};
---

<template flowview={context} is:raw>
  <h1>{{ context.title }}</h1>
  @if (context.featured) {
    <span>Featured</span>
  }
</template>
```

Type `flowview` in an Astro file to insert the complete wrapper. `is:raw` is an
editor-compatibility marker for Astro's official Language Server: it prevents
Astro from interpreting flowview expressions as TSX before the Vite integration
runs. The flowview integration replaces the whole template during compilation,
so the marker does not affect generated HTML.

## Local development

From the monorepo root, open the Astro demo in a new VS Code Extension
Development Host with the local extension loaded:

```bash
pnpm run dev:vscode
```

You can also press `F5` in the monorepo workspace and select **Run flowview
Extension**. In the new window, open `DemoPage.astro` or a `.flow` file to test
highlighting and type `flowview` inside an Astro file to test the snippet.

## Installation from a VSIX

Build the extension from the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter vscode-flowview run package
```

The `.vsix` contains the compiler bundle and WASM. Install it without adding a
FlowView CLI or Rust toolchain:

```bash
code --install-extension packages/vscode-flowview/dist/flowview-language-support.vsix
```

## Packaging scripts

| Script                                                  | Description                   |
| ------------------------------------------------------- | ----------------------------- |
| `pnpm run dev:vscode`                                   | Open the local dev extension. |
| `pnpm --filter vscode-flowview run package`             | Build a release `.vsix`.      |
| `pnpm --filter vscode-flowview run package:pre-release` | Build a pre-release `.vsix`.  |

## License

MIT
