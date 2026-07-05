# Plan: flowview Events without Astro (framework-less Vite + Hono)

Status: proposed, not started. Written after a read-only audit of the current
codebase; revised 2026-07-05 by a second independent audit that re-verified
every file:line claim and closed a design gap (constraint #3 below — the fate
of the `<script data-flowview>` block in a `.flow` file — which the first
draft left unresolved and internally contradictory between Phase 1 and
Phase 2). Pairs with `docs/plans/flowview-events-vanilla-vite-context.md`,
which is the self-contained briefing to hand to the session that executes
this plan. No code has been changed as part of writing or revising this plan.

## Product goal

Today flowview's HTML compiler (`.flow` → `render(context): string`) already
works with zero framework: `@flowview/vite` compiles `.flow` imports in any
Vite project, and the README documents Hono / plain Node / Cloudflare Workers
usage (README "Use With Hono or Plain Node.js", ~line 202). **flowview Events
(the `(click)="save($event)"` binding compiler) only works inside Astro
today**, via `@flowview/astro-events`. The goal of this plan is to close that
gap: make flowview Events usable in a plain Vite project — the kind of
project a Hono (or any other) SSR server would use — without requiring Astro.

This is additive. Nothing about the existing Astro integration changes.

## Current state (verified by reading the code, not assumed)

- `@flowview/vite` (`packages/vite/src/index.ts`) compiles `.flow` files
  standalone. Proven by `packages/vite/test/fixtures/basic/main.ts`, which
  imports a `.flow` file and calls `render()` with no Astro involved at all.
  **This half of "framework-less" already works.**
- `@flowview/events` (`packages/events/src/*`) — the core compiler
  (`compileScriptEvents`) and parser (`findEventBindings`,
  `extractFunctionDeclarations`) — has **no Astro dependency**. It operates on
  plain strings: a `template` string and a `scriptSource` string in, template
  edits + a script-append string out.
- `@flowview/events/runtime` (`packages/events/src/runtime/index.ts`,
  `registerFlowHandlers`) is plain DOM code (`typeof document === "undefined"`
  guarded). Nothing Astro-specific there either.
- The only Astro-specific piece is `packages/astro-events/src/index.ts`: it
  uses `@astrojs/compiler` to parse the whole `.astro` file into an AST, finds
  the frontmatter boundary and the `<script data-flowview>` element in that
  AST, converts UTF-8 byte offsets to UTF-16 string indices
  (`createByteOffsetConverter`), and feeds the extracted pieces into the
  generic `compileScriptEvents`.
- v2 of the events design (delegated runtime, `<script data-flowview>`
  authoring model) already shipped — see `docs/plans/flowview-events-v2.md`.
  That document is history, not a live TODO; don't re-run its phases.

## Four constraints this plan is built around

These were confirmed by reading source, not inferred:

**1. `(click)="..."` cannot reach the Rust HTML compiler as-is.**
`crates/flowview-compiler/src/parser/html.rs` (`parse_attribute_name`,
~lines 261-284) only accepts `[a-zA-Z0-9\-:_]` in an attribute name. A
literal `(click)` attribute in a `.flow` file would fail to parse. This is
why, for Astro, the rewrite from `(click)="save($event)"` to
`data-flow-on-click="save"` happens as a **text transform on the raw `.astro`
source before Astro's own parser ever sees it**
(`packages/astro-events/src/index.ts`, `enforce: "pre"`). The same has to be
true for `.flow` files: a Vite plugin must rewrite the bindings to
`data-flow-on-*` attributes in the raw `.flow` source text, running *before*
`@flowview/vite`'s own transform hands the source to the Rust compiler. No
Rust changes are needed or wanted — the fix lives entirely in a pre-pass JS
plugin, exactly mirroring the existing Astro approach.

**2. The events core needs no Astro-shaped glue to run on `.flow`/plain HTML.**
`findEventBindings` (`packages/events/src/parser.ts:41-72`) is a hand-rolled
raw-text scanner that already skips `<script>`/`<style>`/comments correctly
and has zero AST dependency — it will work unmodified on `.flow` source text.
Locating the single `<script data-flowview>` block in a `.flow` file needs
none of Astro's AST machinery either: there's no frontmatter to split around,
and a `.flow` file is plain text, so a small string scan (same style as the
existing `isRawTextTagStart` / `skipRawTextElement` helpers already in that
same file) is sufficient — no `@astrojs/compiler`, no byte-offset conversion.

**3. The Rust compiler passes `<script>` blocks through verbatim into the
rendered HTML string — so the vanilla plugin must STRIP the
`<script data-flowview>` block from the template, not leave it in place.**
`crates/flowview-compiler/src/parser/html.rs` (`raw_text_tag_name` /
`consume_raw_text_element`, ~lines 497-546) treats `<script>`/`<style>` as
raw-text elements whose content becomes a `TextNode` emitted as-is by
`render()`. This is the key divergence from astro-events: in Astro, the
transformed script block is *left in the file* because **Astro itself**
extracts, bundles, and rewrites `<script>` tags into hashed asset references.
In a `.flow` file there is no such machinery — a script block left in the
template ends up inline in server-rendered HTML at request time, where its
`import { registerFlowHandlers } from "@flowview/events/runtime"` is an
unresolved bare specifier in the browser (and even if it resolved, the
handler code would be duplicated on every rendered response). Therefore the
new plugin must (a) remove the whole `<script data-flowview>...</script>`
element from the template before the Rust compiler sees it, and (b) give the
script content a real module identity that Vite can serve in dev and bundle
in the client build. The mechanism for (b) is a **virtual module**, and the
repo already has exact precedent: `@flowview/astro`
(`packages/astro/src/index.ts:49-108`) uses `virtual:flowview-astro/` ids
with the `\0`-resolved-prefix convention and `resolveId`/`load` hooks. Reuse
that pattern, with one deliberate difference: `load()` for the new package's
virtual ids must be **self-contained** (the id encodes the source `.flow`
path; `load()` reads the file from disk and compiles the events) rather than
depending on an in-memory map populated by `transform` — because the client
build and the SSR build are separate Vite runs, and only the SSR run
transforms the `.flow` import. Give virtual ids a `.ts` suffix so Vite's
esbuild pipeline transpiles TypeScript handler bodies, matching what Astro's
script pipeline does for astro-events users.

**4. Getting the right `<script>` tag into the HTML response is the
remaining, non-flowview-specific problem — solve it in the example, not in a
package.** In a framework-less Vite + Hono/Node setup, `render(context)`
produces a string at request time — invisible to Vite's static HTML-entry
asset graph. The standard pattern used by every non-Astro Vite SSR setup
(Vue SSR, Vike, custom Node+Vite): a real client build entry, a dev-mode
`<script type="module" src="/src/entry-client.ts">` injection, and a
prod-mode lookup in Vite's `build.manifest`
(`dist/client/.vite/manifest.json`) to print the hashed URL. With constraint
#3's virtual module in place, the user's client entry is one line per page
(`import "virtual:flowview-events/src/pages/index.flow"`), and everything
else is the well-documented Vite SSR pattern. **Do not** build an automatic
script-discovery/tag-injection subsystem inside flowview for v1 — ship a
documented, working example (`examples/hono-demo`) instead. If a second
consumer later needs it automated, promote it to a helper then, not
preemptively. (This scope decision matches the project's stated "keep the
runtime scope tiny" / "no framework assumptions" philosophy in
`docs/flowview-spec.md`.)

## Decision (recommended, confirm before Phase 1)

- **New package `@flowview/vite-events`** (naming mirrors
  `@flowview/astro-events`): a Vite plugin, `enforce: "pre"`, registered
  before `@flowview/vite`, that (1) rewrites `(event)="handler(...)"`
  bindings to `data-flow-on-*` attributes via the unchanged
  `compileScriptEvents`, (2) strips the `<script data-flowview>` block from
  the template (constraint #3), and (3) serves that block's compiled content
  (script source + generated `registerFlowHandlers` call) as a virtual
  module for the client build to import.
- **Do not** ship automatic script-tag injection or manifest resolution as a
  package feature in v1 — that lives in `examples/hono-demo` as documented,
  copyable code (constraint #4).
- Documented fallback if the virtual-module route hits an unexpected wall
  (not the recommendation, just the recorded escape hatch): skip the inline
  `<script data-flowview>` authoring model for vanilla Vite entirely; users
  write a real client `.ts` file and call `registerFlowHandlers` themselves
  under the default scope — the runtime already resolves elements without a
  `data-flow-scope` attribute to scope `""`
  (`packages/events/src/runtime/index.ts:10` and `:67`). This loses
  compile-time handler validation, which is the main value of the events
  compiler, so only fall back to it with the user's explicit sign-off.

## Phases

### Phase 0 — Confirm open decisions (do this first, ask the user)

Before writing any code, resolve via `AskUserQuestion`:

1. Package name: `@flowview/vite-events` (recommended) vs. alternative.
2. Should the new plugin match plain `.html` files too, or only `.flow`?
   (`findEventBindings`/`compileScriptEvents` don't care about extension.
   Note: for `.html` files Vite has its own HTML pipeline and the
   strip+virtual-module flow differs; recommended: **`.flow` only for v1**,
   note `.html` as future work.)
3. Example app: `examples/hono-demo` (recommended — Hono is the concrete ask
   and already the documented example runtime in the README) vs. a generic
   `examples/vanilla-vite-demo`.
4. Extract the repeated "12-hex sha256 of file path" scope-hash pattern
   (currently duplicated in `packages/astro/src/index.ts:159-163` and
   `packages/astro-events/src/index.ts:182-185`) into one shared helper in
   `@flowview/events` before writing a third copy? (Recommended: yes —
   trivial, and astro-events already imports from `@flowview/events`.)

### Phase 1 — `@flowview/vite-events` package

New workspace package, structured like `packages/astro-events` but with zero
dependencies beyond `@flowview/events` (no `@astrojs/compiler`, no
`magic-string`, no `astro`).

Tasks:

1. `findScriptFlowviewBlock(source: string)`: locate at most one
   `<script data-flowview>...</script>` block in raw template text via a
   small string scan (reuse the raw-text-tag-skip style already in
   `packages/events/src/parser.ts:79-102`; don't add a dependency for this).
   Error if more than one block is found (same rule as astro-events). Record
   the full element span (open tag through `</script>`), not just the
   content span — the whole element gets removed.
2. Compute the scope id the same way the Astro integrations do (12-hex
   sha256 of the file path) — via the shared helper from Phase 0 task 4 if
   approved, otherwise inline, matching
   `packages/astro-events/src/index.ts:182-185` exactly.
3. Call `compileScriptEvents` (unchanged, from `@flowview/events`) with the
   located script content and the full source as `template`.
4. Produce the transformed `.flow` source: apply the returned
   `templateEdits` with `applyTemplateEdits` (already exported from
   `@flowview/events`), then **delete the entire
   `<script data-flowview>...</script>` element** (constraint #3). Plain
   string operations; no MagicString (documented trade-off: lower sourcemap
   fidelity than astro-events, acceptable for v1, revisit if it hurts).
5. Virtual module for the client script: `resolveId`/`load` hooks following
   the `virtual:flowview-astro/` + `\0` prefix pattern in
   `packages/astro/src/index.ts:49-108`, with public ids like
   `virtual:flowview-events/<workspace-relative-path>.ts`. `load()` must be
   self-contained: parse the path out of the id, read the `.flow` file from
   disk, run steps 1-3, and return `scriptSource + scriptAppend` as the
   module body (constraint #3 explains why: the client build never runs the
   `.flow` transform). The `.ts` id suffix lets Vite transpile TS handler
   bodies.
6. Wire the template rewrite as `transform(code, id)` matching `.flow`
   (`enforce: "pre"`); document the required plugin order in the package
   README: `plugins: [flowviewEvents(), flowview()]`.
7. If bindings exist in a file but no `<script data-flowview>` block is
   found, throw a located error, same wording/behavior as astro-events
   (`transformAstroSource`'s final `throw`).
8. HMR: in `handleHotUpdate`, when a `.flow` file changes, invalidate its
   virtual events module too, so edits to handler code propagate without a
   dev-server restart.
9. Unit tests mirroring `packages/astro-events/src/index.test.ts`'s cases
   (13 cases there) minus anything Astro/AST/byte-offset specific, plus new
   cases for: script-block removal from the template, virtual-module id
   round-trip, and `load()` compiling straight from disk.
10. One integration test that chains this plugin's transform output into
    `@flowview/vite`'s `compileFlowview` and asserts: the final generated
    `render()` module contains the expected `data-flow-on-*` /
    `data-flow-scope` markup, the rendered output contains **no**
    `<script data-flowview>` remnant, and the virtual module content
    contains the handler function plus the `registerFlowHandlers(...)`
    call. This is the test that proves both the ordering constraint
    (finding #1) and the strip requirement (finding #3) hold.

Exit criteria: `pnpm --filter @flowview/vite-events test` and `typecheck`
green; no changes to `packages/events` (beyond the Phase 0 task 4 helper, if
approved), `packages/astro-events`, or any Rust crate.

### Phase 2 — `examples/hono-demo`

A new example app proving the whole framework-less story end to end:
`.flow` template with `(click)="..."` bindings + `<script data-flowview>`,
served by Hono, built with Vite.

Tasks:

1. Vite config with two builds: an SSR/server build (Hono handler entry that
   imports the `.flow` page) and a client build whose entry is a small
   `entry-client.ts` that imports the page's virtual events module
   (`import "virtual:flowview-events/src/pages/index.flow"`) — this is what
   makes the events script a real Rollup input and the manifest producer
   (constraint #4). Both builds include `flowviewEvents()`; only the SSR
   build needs `flowview()`.
2. Dev mode: Vite dev server in middleware mode mounted inside the Hono app
   (the standard documented pattern for Vite + any custom Node server);
   inject `<script type="module" src="/src/entry-client.ts">` into the
   rendered HTML in dev. `.flow` and handler edits recompile on change
   without a separate terminal.
3. Prod mode: read the client build's `.vite/manifest.json`, resolve the
   hashed URL for `entry-client.ts`, and inject
   `<script type="module" src="...">` into the HTML string returned by
   `render()` before the Hono handler responds.
4. A page exercising the same shape as the Astro demo's events page
   (`examples/astro-demo/src/pages/events.astro`) — `(click)`, `(input)`,
   at least one dynamically-added element (e.g. a `@for` re-render) to prove
   delegation works outside Astro's view-transitions context.
5. Tests: vitest for the render/manifest-lookup logic; a lightweight smoke
   test hitting the running server (plain `fetch` + DOM assertions via
   `jsdom`, or Playwright if it stays cheap), mirroring the intent of
   `test:e2e:demo` at a scale appropriate for a small example app.

Exit criteria: `pnpm --filter hono-demo dev` and a documented `build` +
`start` work manually (verify a click actually fires a handler in the
browser, dev **and** prod); automated tests green.

### Phase 3 — Docs

1. README: add a "Use flowview Events without Astro (Vite + Hono)" section
   next to the existing "Use With Hono or Plain Node.js" section, following
   the same terse style. Must cover: plugin order, the client-entry /
   virtual-module line, and the dev/prod script-tag pattern (link to the
   example for the full wiring).
2. `docs/flowview-spec.md` scopes DOM events out of the HTML compiler and
   only cross-references flowview Events — at most add a pointer; no real
   changes needed.
3. Flag for later (do not block this plan): flowview Events has no dedicated
   spec doc analogous to `docs/flowview-spec.md` — its behavior lives only
   in the README and the historical `docs/plans/flowview-events-v2.md`.
   Worth creating `docs/flowview-events-spec.md` eventually.

### Phase 4 — CI / workspace wiring

1. Root `package.json`: add `build:vite-events`, `test:vite-events` scripts
   following the exact naming/composition pattern of `build:astro-events` /
   `test:astro-events`; fold into the aggregate `build`, `test`, `typecheck`
   scripts the same way.
2. `pnpm-workspace.yaml` already globs `packages/*` and `examples/*` — no
   change needed.
3. `.github/workflows/ci.yml` (jobs: `rust`, `typescript`, `astro-demo`):
   add the new package's build+test to the `typescript` job. Give
   `examples/hono-demo` its own job only if its e2e step is heavy enough to
   want isolation; otherwise fold into `typescript`.
4. `CONTRIBUTING.md`: add the new package/example to "Repository Layout" and
   note that events-integration changes should also update
   `examples/hono-demo`, mirroring the existing rule for the Astro demo.

## What this plan explicitly does not do

- No changes to `crates/flowview-compiler` (the attribute-name restriction
  in finding #1 is worked around, not lifted; the raw-text passthrough in
  finding #3 is likewise worked around by stripping before compile).
- No changes to `@flowview/events`'s public API beyond, at most, extracting
  the shared scope-hash helper (Phase 0 task 4).
- No automatic script-tag injection, script discovery, or manifest
  resolution shipped as a package feature — Phase 2 is a worked example,
  not a new flowview subsystem (see constraint #4).
- No changes to the Astro integration packages or the Astro demo.
- No `.html`-file support in v1 unless Phase 0 question 2 decides otherwise.
