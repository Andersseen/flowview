# Flowmark Landing Page

This is the official landing page for **Flowmark**, built as an Astro site that dogfoods the Flowmark template language.

Every static section of the page (Hero, Features, Syntax Showcase, Getting Started, Footer) is rendered by a Flowmark `<template flowmark>` region. The live inventory demo further shows `@if`, `@else if`, `@for`, `@empty`, and `@switch` in action.

## Stack

- [Astro](https://astro.build/) — static site generator
- [Flowmark](https://github.com/andersseen/flowmark) — template language compiled to plain JavaScript
- [@andersseen/web-components](https://github.com/Andersseen/and-web-components) — themeable web components
- [@andersseen/layout](https://github.com/Andersseen/and-web-components) — layout and typography primitives
- [@andersseen/motion](https://github.com/Andersseen/and-web-components) — animation utilities
- [Tailwind CSS 4](https://tailwindcss.com/) — utility-first styling

## The context + template pattern

Each Flowmark section receives its data through a typed `context` object:

```ts
// src/data/hero.ts
import type { HeroContext } from "./types";

export const heroContext: HeroContext = {
  title: "Flowmark",
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

<template flowmark={context} is:raw>
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

1. Finds the `<template flowmark>` region.
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
