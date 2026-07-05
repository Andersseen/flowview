# Context briefing: executing flowview-events-vanilla-vite.md

Read this first, then read `docs/plans/flowview-events-vanilla-vite.md` (the
actual plan). This file exists so you don't have to re-run the codebase audit
that produced that plan — the facts below were verified by reading source
directly (file:line references given throughout), and re-verified by a second
independent audit on 2026-07-05, which also corrected the original plan's
main design gap (finding 3 below: the `<script data-flowview>` block must be
**stripped** from `.flow` templates and served as a **virtual module** — the
first draft wrongly mirrored astro-events and left it inline). Re-grep to
spot-check if something looks off (the repo may have moved on), but you
shouldn't need to re-explore broadly.

## What this repo is

flowview (`flowview` monorepo, pnpm + cargo workspace; the local directory is
still named `flowmark`, an older name — ignore that). Two mostly-independent
halves:

1. **flowview HTML** — a Rust compiler (`crates/flowview-compiler`) that turns
   `.flow` template files (Angular-style `@if`/`@for`/`@switch`/`{{ }}`) into
   plain `render(context): string` JS functions. Framework-agnostic already:
   works standalone via `@flowview/vite`, and via `@flowview/astro` inside
   Astro. Spec: `docs/flowview-spec.md`.
2. **flowview Events** — a separate TS-only compiler (`@flowview/events`) +
   runtime that turns Angular-style `(click)="save($event)"` bindings into
   compiled `data-flow-on-click` attributes plus a delegated
   `document`-level event listener (`registerFlowHandlers`). **Only wired up
   for Astro today**, via `@flowview/astro-events`.

The task: make flowview Events usable from a plain Vite project (no Astro) —
the setup a Hono/Node/Workers SSR server would use. The HTML half already
works framework-less; the Events half doesn't yet.

## Package map (packages/*)

- `runtime` — `@flowview/runtime`: tiny escaping/render-value helpers for
  HTML-compiler output. Not touched by this plan.
- `compiler` — `@flowview/compiler`: WASM wrapper around the Rust compiler
  (`wasm-pack --target nodejs`), used by `@flowview/vite` when no native CLI
  binary is found. Not touched by this plan.
- `vite` — `@flowview/vite`: Vite plugin compiling `.flow` imports
  (`packages/vite/src/index.ts`). Proven framework-less by
  `packages/vite/test/fixtures/basic/main.ts` (imports `.flow`, calls
  `render()`, zero Astro). Not touched except as the thing the new package's
  output must feed into correctly (ordering matters, finding 1).
- `astro` — `@flowview/astro`: Astro integration for the HTML compiler.
  Not touched, **but read `src/index.ts:49-108` before Phase 1**: it is the
  in-repo precedent for the virtual-module pattern the new package needs
  (`VIRTUAL_PREFIX = "virtual:flowview-astro/"`, `\0`-resolved prefix,
  `resolveId`/`load` hooks). Note its `load()` reads from an in-memory map
  populated by `transform` — the new package must instead make `load()`
  self-contained (read the `.flow` from disk and compile), because the
  client build is a separate Vite run that never transforms the `.flow`
  import (see finding 3).
- `events` — `@flowview/events`: the events compiler core + runtime.
  **Already 100% Astro-agnostic** — the key finding that makes the plan
  tractable. Files:
  - `src/parser.ts`: `findEventBindings(html)` — hand-rolled raw-text scanner
    for `(event)="expr"` bindings, skips `<script>`/`<style>`/comments,
    zero AST dependency (lines 41-72). `extractFunctionDeclarations` /
    `findUnsupportedHandlerNames` use the TypeScript compiler API on the
    script content only — also framework-agnostic. The raw-text-tag-skip
    helpers to imitate for locating the script block are at lines 79-102.
  - `src/compiler.ts`: `compileScriptEvents({filename, scope, template,
    scriptOffset, scriptSource, runtimeImport})` — pure string in/out.
    Returns `{templateEdits, scriptAppend, events}`. Also exports
    `applyTemplateEdits(template, edits)` — ready-made right-to-left edit
    applier, no MagicString needed.
  - `src/runtime/index.ts`: `registerFlowHandlers(scope, handlers, events)` —
    plain DOM code, delegated document-level listeners, `focus`/`blur` via
    capture, `typeof document === "undefined"` guarded (SSR-safe no-op).
    Elements **without** a `data-flow-scope` attribute resolve to the
    default scope `""` (lines 10 and 67) — this is what makes the plan's
    documented fallback (external hand-written handler registration)
    possible without runtime changes.
  - `src/diagnostics.ts`: `locate()`, `FlowviewDomError`.
- `astro-events` — `@flowview/astro-events`: the ONLY Astro-specific piece.
  `src/index.ts` parses the `.astro` file with `@astrojs/compiler`, finds
  frontmatter + the `<script data-flowview>` element in the AST, converts
  UTF-8 byte offsets to UTF-16 indices (`createByteOffsetConverter`, lines
  247-253), computes the scope id as
  `createHash("sha256").update(filename).digest("hex").slice(0,12)` (lines
  182-185), calls `compileScriptEvents`, applies edits with MagicString.
  Template for the new package's *compile* path, minus everything
  AST/byte-offset/frontmatter-related — but **not** for the script-block
  handling, which must differ (finding 3).
- `prettier`, `vscode-flowview` — editor tooling, irrelevant here.

## The four load-bearing findings (already verified, don't re-derive)

**1. `(click)="..."` cannot reach the Rust HTML compiler as-is.**
`crates/flowview-compiler/src/parser/html.rs` (`parse_attribute_name`,
~lines 261-284) only accepts `[a-zA-Z0-9\-:_]` in an attribute name — a
literal `(click)` attribute fails to parse. So the new plugin must rewrite
bindings to `data-flow-on-*` in raw text *before* `@flowview/vite`'s
transform hands the source to the Rust compiler: `enforce: "pre"` **and**
registered before `@flowview/vite` in the user's plugin array (Vite runs
same-enforce plugins in registration order). Do not fix this in Rust — the
text-rewrite approach is exactly how Astro support works today.

**2. The events core needs zero new Astro-shaped glue for `.flow` text.**
`findEventBindings` works unmodified on `.flow` source. Locating the single
`<script data-flowview>` block needs no AST — `.flow` files have no
frontmatter; a small string scan suffices (mirror
`packages/events/src/parser.ts:79-102`). Do not add `@astrojs/compiler` or
`magic-string` to the new package. Apply edits with the already-exported
`applyTemplateEdits`.

**3. The Rust compiler passes `<script>` content through verbatim into the
rendered HTML string — so the script block must be STRIPPED and turned into
a virtual module.** Verified: `crates/flowview-compiler/src/parser/html.rs`
(`raw_text_tag_name` / `consume_raw_text_element`, ~lines 497-546) treats
`<script>`/`<style>` as raw-text `TextNode`s emitted as-is by `render()`.
In Astro, the transformed script block stays in the file because **Astro**
extracts and bundles `<script>` tags itself. In a `.flow` file nobody does —
a block left in place would be emitted inline in server-rendered HTML at
request time with an unresolvable bare `import "@flowview/events/runtime"`.
So the new plugin's `transform` must (a) apply the template edits AND delete
the entire `<script data-flowview>...</script>` element, and (b) expose the
compiled script content (`scriptSource + scriptAppend`) as a virtual module
(public id shaped like `virtual:flowview-events/<relative-path>.ts`; the
`.ts` suffix gets TS handler bodies transpiled by Vite's esbuild pipeline).
`load()` must read the `.flow` from disk and compile — not depend on state
from `transform` — because the client build never imports the `.flow`
module. Precedent for the hook mechanics: `packages/astro/src/index.ts:49-108`.

**4. Getting the `<script>` tag into the HTML response is the example's job,
not a package feature.** `render(context)` produces a string at request
time — invisible to Vite's static asset graph. The example
(`examples/hono-demo`) uses the standard Vite SSR pattern: a real client
entry (`entry-client.ts` that imports the virtual events module), dev-mode
injection of `<script type="module" src="/src/entry-client.ts">`, prod-mode
lookup in `dist/client/.vite/manifest.json` for the hashed URL. **Do not
build an automated script-discovery/tag-injection subsystem** — deliberate
scope decision, see "Decision" and constraint #4 in the plan.

## Conventions to follow (already established, don't reinvent)

- Package layout: `packages/<name>/{src,package.json,tsconfig.json,
  tsup.config.ts}`. Build via `tsup` (copy
  `packages/astro-events/tsup.config.ts` as the starting point). Tests via
  `vitest run` (`environment: "jsdom"` only if DOM APIs are touched, see
  `packages/events/vitest.config.ts`).
- Naming: `@flowview/<name>`, scoped npm package, `"type": "module"`,
  `"sideEffects": false`, `publishConfig.access: "public"`, MIT license,
  same `repository`/`bugs`/`homepage` block shape as every existing
  `packages/*/package.json` (swap the `directory` field).
- Root `package.json` wires every package into aggregate `build`, `test`,
  `typecheck` scripts by name — follow the existing
  `build:astro-events`/`test:astro-events` naming exactly and add the new
  scripts to the composed one-liners.
- `pnpm-workspace.yaml` globs `packages/*` and `examples/*` already (verified)
  — no workspace-file change needed for a new package or example.
- CI (`.github/workflows/ci.yml`, verified) has three jobs: `rust`,
  `typescript`, `astro-demo`. New package build+test belongs in
  `typescript` (follow the existing step shape).
- Changesets (`.changeset/`) holds only README + config right now (no
  pending release) — don't add a changeset unless the user asks to publish.
- Commit style from `git log`: short imperative `feat:`/`docs:`/`fix:`
  prefixes, no strict conventional-commits enforcement.
- `CONTRIBUTING.md` rule worth respecting: "Every language or Astro
  integration change must update the Astro demo and its browser assertions."
  This plan is additive/parallel to Astro, so that rule doesn't strictly
  apply — but Phase 2's `examples/hono-demo` is the equivalent obligation
  for the new integration (keep it real and tested, not a toy).
- Test scale for calibration: `packages/astro-events/src/index.test.ts` has
  13 cases, `packages/events/src/index.test.ts` 9, its runtime tests 4.
  Match that granularity, not more.

## Prior art: the "hash a file path to a scope id" pattern

Duplicated twice already; the plan's Phase 0 asks whether to extract it
before adding a third copy:

- `packages/astro/src/index.ts:159-163` — `fileHash`
- `packages/astro-events/src/index.ts:182-185` — `scope`

Both are
`createHash("sha256").update(<path>).digest("hex").slice(0, 12)`.

## Start here

1. Read `docs/plans/flowview-events-vanilla-vite.md` in full.
2. Its Phase 0 lists open decisions (package name, `.html` support, example
   app framing, shared hash helper). Ask the user via `AskUserQuestion`
   before writing any code — they shape Phase 1's package boundaries.
3. Then execute phases in order, each with its own exit criteria as written.
   Don't skip ahead to Phase 2 before Phase 1's exit criteria
   (`pnpm --filter @flowview/vite-events test` / `typecheck` green) are met.
4. When in doubt about the script-block handling, re-read finding 3 above —
   it is the one place where copying astro-events line-for-line produces a
   broken result.
