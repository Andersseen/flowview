# flowview Landing Page and Acceptance App

This is the official landing page for **flowview**, built as an Astro site that dogfoods the flowview template language. It is also the browser-level acceptance application: it checks that the pieces of FlowView compose correctly in a real browser.

## Capabilities and acceptance

`/capabilities` lists what FlowView does today, grouped by area, with honest evidence labels (Live demo, Browser E2E, Compiler/spec, Release compatibility). The inventory is typed data in `src/data/capabilities.ts` rendered by an embedded FlowView template. The page also has live proofs for escaped vs raw interpolation, `@switch`, and Unicode/literal markers, and links to the deeper existing pages (`/events`, `/client-dom`, `/security`, `/e2e/*`).

Playwright verifies rendered behavior and composition, not compiler internals:

- `e2e/capabilities.spec.ts` is the product acceptance suite (also runs against the production build).
- `e2e/demo.spec.ts`, `events.spec.ts`, `client-dom.spec.ts` cover the landing page, Events, scopes, dynamic DOM and View Transitions.
- `e2e/fixtures.ts` fails any test on an unexpected `pageerror` or `console.error`.

Native static rendering (`compile_static`) is not demonstrated here; it is covered by the Rust/spec tests.

```sh
# Development E2E (full suite, astro dev)
pnpm run test:e2e:demo

# Production acceptance (capabilities suite against `astro preview`)
pnpm run build:demo
pnpm run test:e2e:acceptance
```

Every static section of the page (Hero, Features, Syntax Showcase, Getting Started, Footer) is rendered by a flowview `<template flowview>` region. The live inventory demo further shows `@if`, `@else if`, `@for`, `@empty`, and `@switch` in action.

## Stack

- [Astro](https://astro.build/) — static site generator
- [flowview](https://github.com/andersseen/flowview) — template language compiled to plain JavaScript
- [@andersseen/web-components](https://github.com/Andersseen/and-web-components) — themeable web components
- [@andersseen/layout](https://github.com/Andersseen/and-web-components) — layout and typography primitives
- [@andersseen/motion](https://github.com/Andersseen/and-web-components) — animation utilities
- [Tailwind CSS 4](https://tailwindcss.com/) — utility-first styling

## The context + template pattern

Each flowview section receives its data through a typed `context` object:

```ts
// src/data/hero.ts
import type { HeroContext } from "./types";

export const heroContext: HeroContext = {
  title: "flowview",
  tagline: "HTML-like templates with modern control flow.",
  badge: "Framework-agnostic templates",
  ctaPrimary: { text: "Get started", href: "#getting-started" },
};
```

The component imports the context and passes it to the template region:

```astro
---
import { heroContext } from "../data";
import type { HeroContext } from "../data";

export interface Props {
  context?: HeroContext;
}

const { context = heroContext } = Astro.props;
---

<template flowview={context} is:raw>
  <header>
    <h1>{{ context.title }}</h1>
    <p>{{ context.tagline }}</p>
    @if (context.ctaPrimary) {
      <a href="{{ context.ctaPrimary.href }}">{{ context.ctaPrimary.text }}</a>
    }
  </header>
</template>
```

During build, the `@flowview/astro` integration:

1. Finds the `<template flowview>` region.
2. Sends the inner source to the Rust compiler.
3. Replaces the region with `<Fragment set:html={render(context)} />`.
4. Astro evaluates the generated render function and emits static HTML.

## Data layer

All data lives in `src/data/`:

| File                | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `types.ts`          | TypeScript interfaces for every `context` object |
| `site.ts`           | Global metadata (title, description, URLs)       |
| `hero.ts`           | Hero section content                             |
| `features.ts`       | Feature cards                                    |
| `syntaxExamples.ts` | Code examples for the syntax showcase            |
| `gettingStarted.ts` | Installation steps                               |
| `footer.ts`         | Footer links and copyright                       |
| `navigation.ts`     | Navbar items                                     |
| `index.ts`          | Barrel export of all contexts and types          |

## Theming

The site uses the `slate-amber` theme from `@andersseen/web-components`. Dark mode is supported automatically via `prefers-color-scheme` and can be forced with `data-mode="dark"` or the `.dark` class.

## Scripts

```sh
# Install dependencies
pnpm install

# Start the dev server
pnpm run dev

# Type-check
pnpm run check

# Build for production
pnpm run build

# Run unit tests
pnpm run test:unit

# Run E2E tests
pnpm run test:e2e
```

## Project structure

```
src/
├── components/     # Landing sections + shared UI
├── data/           # Typed context objects
├── layouts/        # Base layout with SEO and navbar
├── pages/          # Astro routes
├── scripts/        # Web component registration
└── styles/         # Global CSS and Tailwind theme
```
