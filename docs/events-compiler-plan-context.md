# Flowmark Events Compiler Plan Context

> **Note:** A more up-to-date, consolidated improvement plan now lives in
> [`compiler-improvement-plan.md`](./compiler-improvement-plan.md) and
> [`compiler-session-context.md`](./compiler-session-context.md).
> This file is kept for historical reference.

## Purpose

This file is temporary execution context for improving the Flowmark demo app and the events compiler across multiple sessions.

The goal is to make Flowmark's event story as clear as its control-flow story: Angular-style event binding syntax such as `(click)="save($event)"`, usable outside Angular, especially in Astro, without manually writing `addEventListener`.

## Product Direction

Flowmark core stays focused on server-first HTML templates and control flow.

Events should be framed as a separate compiler/integration:

- Control flow compiler: `@if`, `@for`, `@switch`, interpolation.
- Events compiler: `(click)`, `$event`, `$el`, literal arguments, client handler binding.

The current package name `@flowmark/dom` is too broad for the product idea. Prefer event-specific naming in docs and UI. A package rename can be done later, but the user-facing copy should already say "Flowmark Events" or "events compiler" rather than "DOM compiler".

## Current State

Important files:

- `README.md`: says Flowmark does not provide events, while the repo now has events packages. This needs clearer wording.
- `docs/flowmark-spec.md`: says DOM events belong to a separate compiler and package.
- `packages/dom/src/compiler.ts`: current events compiler entry point.
- `packages/dom/src/parser.ts`: regex/manual parser for event attributes, handler calls, frontmatter functions, and capture analysis.
- `packages/dom/src/runtime/index.ts`: scans the document and binds event listeners from `data-flow-on-*`.
- `packages/astro-events/src/index.ts`: Astro integration that transforms `.astro` files with event attributes and injects a client script.
- `examples/astro-demo/src/pages/index.astro`: current home is visually sparse and not explanatory enough.
- `examples/astro-demo/src/pages/events.astro`: current events page demonstrates buttons but does not explain the compiler well and the code panel is hard to inspect.
- `examples/astro-demo/src/styles/global.css`: shared demo styling.

Validation already run during analysis:

- `cargo test --workspace`: passed.
- `pnpm --filter @flowmark/dom test`: passed.
- `pnpm --filter @flowmark/runtime test`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run build:rust`: passed.

## Known Weak Points

Events compiler:

- Event attributes are found with `EVENT_ATTR_RE` regex.
- Frontmatter functions are extracted with a regex/manual scanner and only support `function name(...) {}`.
- Capture analysis is heuristic and can misread real TypeScript/JavaScript.
- Runtime binding can attach duplicate listeners if called multiple times on the same DOM.
- The Astro integration injects an inline `<script>` and returns `map: null`.
- Diagnostics from `@flowmark/dom` are relative to the sliced template, so Astro page locations can be confusing.

Demo:

- Home page does not quickly explain why the project exists.
- Home page does not show a strong before/after or "compiler output" story.
- Events page lacks a clear DX narrative: "write `(click)` in Astro, compiler emits data attributes and a tiny client module."
- Events page code is visually cramped and currently exposes compiled output in a way that is not polished.

## Phase Plan

### Phase 1: Demo Narrative And Visual Upgrade

Goal: make the demo app explain the project in the first viewport and make the events page feel useful and inspectable.

Work:

- Improve `examples/astro-demo/src/pages/index.astro`.
- Improve `examples/astro-demo/src/pages/events.astro`.
- Add focused shared CSS in `examples/astro-demo/src/styles/global.css` only if needed.
- Present "two compilers, one idea" clearly.
- Add a concrete before/after for events:
  - Authoring syntax: `<button (click)="save($event)">`.
  - Generated markers: `data-flow-on-click`.
  - Runtime result: native event listener.
- Keep pages as actual usable demos, not marketing-only pages.

Exit checks:

- `pnpm --filter @flowmark/astro-demo run check`
- `pnpm --filter @flowmark/astro-demo run test:unit`
- Manual browser check of `/` and `/events`.

### Phase 2: Rename The Concept, Not Yet The Package

Goal: align naming with the product idea while avoiding package churn too early.

Work:

- Use "Flowmark Events" and "events compiler" in README/demo copy.
- Keep package imports as `@flowmark/dom` for now unless a dedicated rename phase is approved.
- Document that `@flowmark/dom` is currently the implementation package for the events compiler.
- Remove or soften contradictory "Flowmark does not provide Events" language by saying the core HTML compiler does not include events.

Exit checks:

- README and demo copy are consistent.
- No package rename required in this phase.

### Phase 3: Runtime Binding Safety

Goal: make the current events runtime safer without changing public syntax.

Work:

- Prevent duplicate listener registration in `packages/dom/src/runtime/index.ts`.
- Add tests for repeated `bindFlowEvents` and `bindFlowEventsIn`.
- Keep `$event`, `$el`, and literal args behavior unchanged.
- Consider cleanup/dispose API only if it emerges naturally; do not overbuild.

Exit checks:

- `pnpm --filter @flowmark/dom test`
- `pnpm --filter @flowmark/dom typecheck`

### Phase 4: Compiler Parser Hardening

Goal: reduce fragility of event parsing while keeping the small surface.

Work:

- Add failing tests for realistic Astro/HTML cases before refactoring.
- Improve event attribute discovery beyond the current regex, preferably using Astro compiler AST in the Astro integration path.
- Improve handler expression validation so trailing junk after `save()` is rejected.
- Make diagnostics more precise and page-relative in `@flowmark/astro-events`.
- Keep supported handler calls intentionally narrow:
  - `save()`
  - `save($event)`
  - `save($el)`
  - `save("literal", 1, true, null)`

Exit checks:

- `pnpm --filter @flowmark/dom test`
- `pnpm --filter @flowmark/astro-events test`
- `pnpm run typecheck`

### Phase 5: Frontmatter Function Extraction Strategy

Goal: decide whether to keep the small compiler or adopt a real TS/JS parser for event handlers.

Preferred direction:

- Use a real parser if the events compiler is moving toward v1.
- Keep the current manual parser only if the feature remains clearly experimental.

Work options:

- Short-term: add limitations and diagnostics for unsupported forms.
- Medium-term: parse frontmatter with a TypeScript/JavaScript AST and generate client functions from safe function declarations.

Exit checks:

- New tests for async functions, exported functions, comments, nested functions, captures, and unsupported arrows.
- Clear docs on supported handler declarations.

### Phase 6: Package Naming Decision

Goal: decide whether to rename `@flowmark/dom` to something event-specific.

Candidate names:

- `@flowmark/events`
- `@flowmark/astro-events` stays as Astro integration.
- Avoid `flowmark.events/` as an import/package shape unless there is a specific publishing strategy for it.

Recommendation:

- Public concept: "Flowmark Events".
- Package: `@flowmark/events` eventually.
- Migration path: keep `@flowmark/dom` as compatibility alias or internal package until release boundaries are clear.

Exit checks:

- Package exports, internal imports, README, demo, tests, and lockfile updated in one dedicated rename phase.
- Avoid mixing rename with compiler behavior changes.

## Suggested Execution Order

1. Phase 1.
2. Phase 2.
3. Phase 3.
4. Phase 4.
5. Phase 5.
6. Phase 6 only after the feature direction is stable.

## Guardrails

- Do not expand Flowmark core into a framework.
- Do not add hydration, components, signals, routing, or general DOM directives as part of this plan.
- Keep events separate from the HTML control-flow compiler.
- Prefer focused tests before parser/compiler changes.
- Keep demo pages visually clear, dense enough to inspect, and interactive in the first screen.
