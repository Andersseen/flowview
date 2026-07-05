# @flowview/vite-events

## 0.1.1

### Patch Changes

- 473d06c: Add `@flowview/vite-events`, a Vite plugin that brings flowview Events
  `(click)="handler()"` bindings to plain Vite projects (Hono, Node.js,
  Cloudflare Workers) without requiring Astro. It rewrites bindings to
  `data-flow-on-*` attributes before `@flowview/vite` compiles the template,
  and serves the `<script data-flowview>` block as a `virtual:flowview-events/`
  module for the client build. See `examples/hono-demo` for a full worked
  example.
- Updated dependencies [473d06c]
  - @flowview/events@0.1.2
