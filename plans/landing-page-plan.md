# Plan: Official Flowmark Landing Page

> Location: `examples/astro-demo/`  
> Goal: Transform the current inventory dashboard demo into the official landing page for the Flowmark project, demonstrating real-world usage of the Flowmark syntax inside Astro while keeping the allowed Andersseen libraries.

---

## Guiding principles

1. **Dogfooding**: the site must use `@flowmark/astro` and the Rust compiler to render its own sections.
2. **Allowed libraries**: keep `@andersseen/layout`, `@andersseen/motion`, `@andersseen/web-components`, `@flowmark/astro`, and `@flowmark/runtime`.
3. **Pure SSG**: leverage static Astro; avoid unnecessary hydration.
4. **Small components**: no 200+ line monoliths.
5. **Tested**: every phase must leave unit and E2E tests green.
6. **Theming**: support `dark` and `light` modes using the existing Andersseen theming support.
7. **Static first**: the landing page is 100% static for now; interactive enhancements can be added later.

---

## Phase 1 — Landing structure and component split

### Deliverables
- [x] Define and create landing sections.
- [x] Create new landing section components.
- [ ] Split `DemoPage.astro` into reusable components. *(deferred to Phase 2)*
- [x] Update `Layout.astro` to support navigation, metadata, theming, and footer.
- [x] Create typed data in `src/data/`.
- [x] Ensure `astro check` and existing tests pass.

### Landing sections

| Section | Responsibility | Component(s) |
|---------|----------------|--------------|
| Hero | Title, tagline, CTAs, code snippet | `Hero.astro` |
| Features | 3-4 value cards | `FeatureCard.astro`, `Features.astro` |
| Syntax Showcase | Tabs/examples of `@if`, `@for`, `@switch` | `SyntaxShowcase.astro`, `CodeExample.astro` |
| How it works | Compilation flow diagram | `HowItWorks.astro` |
| Live Demo | Small real-world app using Flowmark | `LiveDemo.astro` |
| Getting Started | Install and usage commands | `GettingStarted.astro` |
| Footer | Links, license, author | `Footer.astro` |

### Components to create/replace
- `src/components/Hero.astro`
- `src/components/Features.astro`
- `src/components/FeatureCard.astro`
- `src/components/SyntaxShowcase.astro`
- `src/components/CodeExample.astro`
- `src/components/HowItWorks.astro`
- `src/components/LiveDemo.astro`
- `src/components/GettingStarted.astro`
- `src/components/Footer.astro`
- `src/components/DemoPage.astro` → remove or repurpose as `LiveDemo.astro`

### Data layer
Create in `src/data/`:
- `site.ts` — global metadata
- `hero.ts` — hero data
- `features.ts` — feature list
- `syntaxExamples.ts` — syntax examples
- `navigation.ts` — navigation links
- `gettingStarted.ts` — steps/commands
- `index.ts` — barrel export of all contexts and types

### Acceptance criteria
- [x] `index.astro` only imports sections and passes contexts.
- [x] No visual component contains data logic in its frontmatter.
- [x] `pnpm run check` and `pnpm test` pass.

---

## Phase 2 — Real Flowmark usage on the landing page

### Deliverables
- [x] Render Hero with Flowmark using `context`.
- [x] Render Features with `@for` and `@if`.
- [x] Render Syntax Showcase with `@switch`.
- [x] Render Getting Started with `@for` and `@if`.
- [x] Render Footer with `@for` and `@if`.
- [ ] Render Live Demo with real project data. *(kept existing inventory dashboard; can be revisited)*
- [x] Ensure every template uses `<!-- prettier-ignore -->` + `<template flowmark is:raw>`.

### Templates to implement

#### Hero
```astro
<!-- prettier-ignore -->
<template flowmark is:raw context={heroContext}>
  <section class="hero">
    <h1>{{ context.title }}</h1>
    <p>{{ context.tagline }}</p>
    @if (context.ctaPrimary) {
      <a href="{{ context.ctaPrimary.href }}" class="button primary">
        {{ context.ctaPrimary.text }}
      </a>
    }
  </section>
</template>
```

#### Features
```astro
<!-- prettier-ignore -->
<template flowmark is:raw context={featuresContext}>
  <div class="features-grid">
    @for (feature of context.items; track feature.id) {
      <and-card>
        <and-card-header>
          <and-card-title>{{ feature.title }}</and-card-title>
        </and-card-header>
        <and-card-content>
          <p>{{ feature.description }}</p>
          @if (feature.badge) {
            <and-badge>{{ feature.badge }}</and-badge>
          }
        </and-card-content>
      </and-card>
    }
  </div>
</template>
```

#### Syntax Showcase
```astro
<!-- prettier-ignore -->
<template flowmark is:raw context={syntaxContext}>
  <div class="syntax-showcase">
    @switch (context.selected) {
      @case ('for') {
        <pre><code>@for (item of items; track item.id) { ... }</code></pre>
      }
      @case ('if') {
        <pre><code>@if (condition) { ... } @else { ... }</code></pre>
      }
      @default {
        <p>Select an example</p>
      }
    }
  </div>
</template>
```

### Acceptance criteria
- [x] At least 3 main sections use Flowmark.
- [x] Templates use `@if`, `@for`, and `@switch`.
- [x] Output HTML is correct and accessible.
- [x] Build does not break (`pnpm run build`).

---

## Phase 3 — Typed and centralized data layer

### Deliverables
- [x] Type every context used in Flowmark templates.
- [x] Move all static context to `src/data/`.
- [x] Document the "context + template" pattern as an example.

### Types defined
- `SiteMeta`, `HeroContext`, `Feature`, `FeaturesContext`, `SyntaxExampleId`, `SyntaxExample`, `SyntaxShowcaseContext`, `Step`, `GettingStartedContext`, `FooterLink`, `FooterContext` in `src/data/types.ts`.
- `SyntaxExampleId` is a strict union (`"for" | "if" | "switch"`).
- JSDoc comments added to every interface.

### Acceptance criteria
- [x] All `context={...}` are typed.
- [x] No implicit `any` in demo data.
- [x] `astro check` passes with no errors.

---

## Phase 4 — Updated unit and E2E tests

### Deliverables
- [ ] Update existing tests (`CodeBlock.test.ts`, `Layout.test.ts`).
- [ ] Add Astro Container tests for new components.
- [ ] Update `e2e/demo.spec.ts` for the new landing page.
- [ ] Add security/escaping tests if more templates are added.

### Minimum unit tests
- `Hero.test.ts` — renders title and CTAs.
- `Features.test.ts` — renders feature list.
- `SyntaxShowcase.test.ts` — renders default example.
- `Footer.test.ts` — renders links.

### Minimum E2E tests
- Hero loads.
- Features render.
- Syntax showcase displays examples.
- CTAs point to correct URLs.

### Acceptance criteria
- [ ] `pnpm test` passes.
- [ ] `pnpm run test:e2e` passes (or equivalent script).

---

## Phase 5 — SEO, responsive design, accessibility, and polish

### Deliverables
- [ ] Add SEO metadata in `Layout.astro`.
- [ ] Ensure responsive layout with `@andersseen/layout` and Tailwind.
- [ ] Review contrast and basic accessibility.
- [ ] Add `examples/astro-demo/README.md` explaining it is the official landing page.
- [ ] Update root `README.md` to link to the landing page.
- [ ] Review and optimize CSS/JS imports.

### Basic SEO
- `<title>`, `<meta name="description">`, Open Graph, Twitter Card.
- Canonical URL using `Astro.site`.
- Links to GitHub and docs.

### Responsive
- Mobile-first grid from `@andersseen/layout`.
- Consistent spacing.

### Acceptance criteria
- [ ] Lighthouse scores ≥ 90 in Performance, Accessibility, SEO, and Best Practices.
- [ ] No unnecessary hydration.
- [ ] Production build works correctly.

---

## Dependencies and constraints

### Must keep
```json
"@andersseen/layout": "^0.0.1",
"@andersseen/motion": "^0.1.1",
"@andersseen/web-components": "^0.0.8",
"@flowmark/astro": "workspace:*",
"@flowmark/runtime": "workspace:*"
```

### Do not add without justification
- No additional UI framework (React, Vue, Svelte).
- No state library.
- No heavy client-side JS.

---

## Notes for future sessions

- Read `plans/context.md` before each session to avoid re-analyzing the repo.
- Each phase should be a self-contained PR/commit when possible.
- Always ensure tests pass before moving to the next phase.
- If the plan does not fit the real architecture, update this file before continuing.
