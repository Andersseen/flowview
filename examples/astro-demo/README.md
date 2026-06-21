# Flowmark Astro Demo

This example uses Flowmark control flow embedded directly in normal `.astro`
components. Every page-content surface is authored with inline Flowmark; Astro
remains the host for routing, layouts, and slot composition.

The demo UI uses:

- Astro
- Tailwind CSS 4
- `@andersseen/web-components`
- `@andersseen/layout`
- `@andersseen/motion`
- Vitest for Astro component tests
- Playwright for page-level smoke tests

## Structure

```text
examples/astro-demo/
├── e2e/                  # Playwright tests
├── src/
│   ├── components/       # Astro components and unit tests
│   ├── data/             # Demo context data
│   ├── layouts/          # Astro layouts and unit tests
│   ├── pages/            # Demo pages
│   ├── scripts/          # Browser entrypoints
│   └── styles/           # Tailwind and theme CSS
├── playwright.config.ts
└── vitest.config.ts
```

## Scripts

```sh
pnpm run dev
pnpm run build
pnpm run check
pnpm run lint
pnpm run preview
pnpm run test:unit
pnpm run test:e2e
```

From the repository root:

```sh
pnpm run demo
pnpm run build:demo
pnpm run test:demo
pnpm run test:e2e:demo
```

Install Playwright browsers before running e2e tests locally:

```sh
pnpm --filter @flowmark/astro-demo exec playwright install chromium
```

## How It Works

1. `@flowmark/astro` finds `<template flowmark is:raw context={...}>` regions
   before Astro parses the component. The VS Code snippet writes this wrapper.
2. Each region is compiled into a virtual JavaScript render module.
3. The integration replaces the region with an Astro fragment that renders the
   generated, escaped HTML.
4. Astro continues to own routing, layouts, and component slots around those
   Flowmark-rendered content surfaces.
5. Web components are registered in `src/scripts/web-components.ts`.

## Deploy to Cloudflare Pages

### Local Deploy

1. Log in with Wrangler:

   ```sh
   pnpm exec wrangler login
   ```

2. Create a Cloudflare Pages project named `flowmark-demo`.
3. Set your account ID:

   ```sh
   export CLOUDFLARE_ACCOUNT_ID=your-account-id
   ```

4. Deploy:

   ```sh
   pnpm run deploy:demo
   ```

### GitHub Actions

`.github/workflows/deploy-demo.yml` deploys automatically on every push to
`main`. Add these secrets to the GitHub repository:

- `CLOUDFLARE_API_TOKEN`: a token with Cloudflare Pages edit access
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
