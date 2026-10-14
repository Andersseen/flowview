# FlowView website

This is the official FlowView website, published at <https://flowview-demo.pages.dev/>. It is also FlowView's browser-level acceptance application: it is built with the real FlowView packages, and Playwright checks that they compose correctly in a real browser.

The directory and package name (`@flowview/astro-demo`) are historical. The site is private and is never published to npm.

## Public routes

| Route              | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `/`                | Product page: positioning, live proof, use cases, trust    |
| `/getting-started` | Entry paths for Astro, Vite/Hono, browser DOM and Rust     |
| `/packages`        | Package ecosystem and recipes (derived from real packages) |
| `/control-flow`    | The full template syntax                                   |
| `/events`          | FlowView Events (Astro and Vite)                           |
| `/client-dom`      | `@flowview/dom` with optional `@flowview/reactive`         |
| `/capabilities`    | Capability inventory backed by tests                       |
| `/security`        | Escaped vs raw interpolation                               |

`/inline` and `/e2e/*` are test fixtures. They stay available for Playwright but are not linked from product navigation.

## Local commands

```sh
# Development server
pnpm --filter @flowview/astro-demo run dev

# Production build (builds the Rust compiler and packages first)
pnpm run build:demo

# Unit tests and type checks
pnpm run test:demo

# Development E2E (full suite against `astro dev`)
pnpm run test:e2e:demo

# Production acceptance (capabilities suite against `astro preview`)
pnpm run build:demo
pnpm run test:e2e:acceptance
```

## Tests

- `e2e/website.spec.ts` covers the public product surface: positioning, navigation, metadata, package accuracy and absence of `/e2e/*` links.
- `e2e/capabilities.spec.ts` is the product acceptance suite and also runs against the production build.
- `e2e/demo.spec.ts`, `events.spec.ts` and `client-dom.spec.ts` cover Events, scopes, dynamic DOM and View Transitions.
- `e2e/fixtures.ts` fails any test on an unexpected `pageerror` or `console.error`.

Native static rendering (`compile_static`) is not run in the browser; the Rust and spec tests cover it.

## Source layout

- `src/pages` holds the routes. `src/data` holds typed site, package, capability and snippet data.
- `src/views/*.flow` are standalone FlowView templates compiled by `@flowview/astro`.
- Pages render their content with embedded `<template flowview>` regions.

## Stack

- [Astro](https://astro.build/)
- [FlowView](https://github.com/andersseen/flowview) (`@flowview/astro`, `@flowview/astro-events`, `@flowview/dom`, `@flowview/reactive`)
- [@andersseen/web-components](https://github.com/Andersseen/and-web-components), `@andersseen/layout`, `@andersseen/motion`, `@andersseen/icon`
- [Tailwind CSS 4](https://tailwindcss.com/)
