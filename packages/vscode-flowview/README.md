# flowview Language Support

VS Code extension for [flowview](https://github.com/andersseen/flowview) templates.

## Features

- Syntax highlighting for `.flow` files.
- Inline flowview highlighting inside Astro
  `<template flowview={...} is:raw>` blocks.
- Snippets for flowview control flow (`@if`, `@for`, `@switch`) and Astro embedding.

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
pnpm install
pnpm --filter vscode-flowview run package
```

Then install the generated `.vsix`:

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
