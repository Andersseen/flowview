# Flowmark Language Support

VS Code extension for [Flowmark](https://github.com/andersseen/flowmark) templates.

## Features

- Syntax highlighting for `.flow` files.
- Inline Flowmark highlighting inside Astro
  `<template flowmark is:raw context={...}>` blocks.
- Snippets for Flowmark control flow (`@if`, `@for`, `@switch`) and Astro embedding.

## Supported syntax

### Interpolation

```flowmark
<h1>{{ context.title }}</h1>
```

### Conditional blocks

```flowmark
@if (context.featured) {
  <span>Featured</span>
} @else if (context.promo) {
  <span>Promo</span>
} @else {
  <span>Standard</span>
}
```

### Repeat blocks

```flowmark
@for (product of context.products; track product.id) {
  <article>{{ product.name }}</article>
} @empty {
  <p>No products found.</p>
}
```

### Switch blocks

```flowmark
@switch (product.status) {
  @case ('available') { <span>In stock</span> }
  @case ('sale') { <span>On sale</span> }
  @default { <span>Unavailable</span> }
}
```

### Escapes

Flowmark control markers can be escaped with a backslash:

```flowmark
<p>\@if and \{{ are rendered as literal text.</p>
```

## Usage in Astro

The extension injects the Flowmark grammar inside
`<template flowmark is:raw>` tags:

```text
---
const context = {
  title: "Inventory",
  featured: true,
};
---

<template flowmark is:raw context={context}>
  <h1>{{ context.title }}</h1>
  @if (context.featured) {
    <span>Featured</span>
  }
</template>
```

Type `flowmark` in an Astro file to insert the complete wrapper. `is:raw` is an
editor-compatibility marker for Astro's official Language Server: it prevents
Astro from interpreting Flowmark expressions as TSX before the Vite integration
runs. The Flowmark integration replaces the whole template during compilation,
so the marker does not affect generated HTML.

## Installation from a VSIX

Build the extension from the monorepo root:

```bash
pnpm install
pnpm --filter vscode-flowmark run package
```

Then install the generated `.vsix`:

```bash
code --install-extension packages/vscode-flowmark/dist/flowmark-language-support.vsix
```

## Packaging scripts

| Script                                                  | Description                  |
| ------------------------------------------------------- | ---------------------------- |
| `pnpm --filter vscode-flowmark run package`             | Build a release `.vsix`.     |
| `pnpm --filter vscode-flowmark run package:pre-release` | Build a pre-release `.vsix`. |

## License

MIT
