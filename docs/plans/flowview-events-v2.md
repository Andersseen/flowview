# Plan: flowview Events v2 — explicit client scripts + delegated runtime

Status: approved direction, phased. Each phase is self-contained and can be
started in a fresh session by reading this document plus the files listed in
that phase. Do not start a phase before the previous one is merged.

## Product goal

Angular-style event bindings in Astro — `(click)="save($event)"` directly in
markup — without a framework and without listener boilerplate
(`querySelector` + `addEventListener`). The differentiator vs Alpine.js:
**compiled, zero `eval`, CSP-safe, compile-time-validated handler references,
and a ~1 kB runtime**. Alpine ships a runtime expression interpreter (~15 kB,
CSP problems); flowview Events resolves everything at build time.

## Current architecture (v1) — how it works today

Files:

- `packages/events/src/parser.ts` — scans template HTML for `(event)="expr"`
  bindings (`findEventBindings`, solid, keep it); extracts **function
  declarations from Astro frontmatter as text**
  (`extractFrontmatterFunctions`); rejects functions that capture outer
  variables using the TypeScript compiler API (`analyzeAllCaptures`).
- `packages/events/src/compiler.ts` — `compileEvents()`: validates bindings,
  rewrites them to `data-flow-on-<event>="handlerName"` +
  `data-flow-args="[...json...]"` attributes, and generates a client module
  that RE-DECLARES the extracted frontmatter functions and calls
  `bindFlowEvents({...})`.
- `packages/events/src/runtime/index.ts` — `bindFlowEvents()`: scans the whole
  document, attaches one native listener per element/event, marks elements
  with `data-flow-bound`.
- `packages/astro-events/src/index.ts` — Vite plugin (`enforce: "pre"`) that
  parses `.astro` files, runs `compileEvents` on frontmatter+template, and
  injects the generated client module as an inline `<script>` (which Astro
  then bundles).
- Demo usage: `examples/astro-demo/src/pages/events.astro` (handlers declared
  in frontmatter, lines ~6-34), snippets in
  `examples/astro-demo/src/snippets/events-author.astro.txt` and
  `home-events.astro.txt`, integration registered in
  `examples/astro-demo/astro.config.mjs`.
- Tests: `packages/events/src/index.test.ts` (~30),
  `packages/events/src/runtime/index.test.ts` (~13),
  `packages/astro-events/src/index.test.ts` (~10).

## Why v1 must change (defects, verified by reading the code)

1. **Server→client code motion by text extraction.** Frontmatter is server
   code. Extracting functions from it means: handlers cannot use imports
   (`import confetti from "canvas-confetti"` breaks), cannot use module-level
   state (`let count = 0` is rejected as a capture), and require an
   ever-growing static analysis (`analyzeAllCaptures`) to stay safe. This is
   rebuilding a resumability compiler with string manipulation — a losing
   battle, and a confusing mental model (code written in a server context
   silently runs in the browser).
2. **Cross-component clobbering in the runtime.**
   `bindElement` (runtime/index.ts:61-101) scans the WHOLE document and sets
   `data-flow-bound` on every element it visits — even when the handler name
   is not in its registry (the `setAttribute` at line 93 runs regardless of
   the `continue` at line 77-82). With two components on one page, component
   A's script visits component B's buttons, fails to resolve their handlers,
   and marks them bound; component B's script then skips them. B's buttons
   are dead.
3. **Global handler namespace.** Two components both declaring `save()`
   collide silently; whichever script binds first wins.
4. **Per-element binding breaks with dynamic DOM.** Astro view transitions
   swap the body but module scripts run once — bindings die after client-side
   navigation. Same for any element added after bind time.

## Target architecture (v2)

### Authoring model

Handlers live in an explicitly-client location: a `<script flowview>` block.
Astro already bundles component `<script>` tags as client modules, so nothing
ever crosses the server/client boundary:

```astro
---
// frontmatter: server-only, untouched by flowview Events
---

<button (click)="save($event)">Save</button>
<button (click)="removeItem('item-1', $el)">Remove</button>

<script flowview>
  import confetti from "canvas-confetti"; // legal: this is a normal client module
  let count = 0; // legal: module state, no capture analysis needed

  function save(event) {
    count += 1;
    confetti();
  }
  function removeItem(id, element) {
    element.setAttribute("disabled", "true");
  }
</script>
```

### Compile-time transform (per `.astro` file)

1. Compute a **scope id**: first 12 hex chars of sha256 of the
   workspace-relative file path (same pattern as `fileHash` in
   `packages/astro/src/index.ts:160-163`).
2. Rewrite each binding `(click)="save($event)"` to
   `data-flow-on-click="save" data-flow-scope="<scopeId>"` plus
   `data-flow-args` exactly as v1 does (`$event`, `$el`, JSON literals —
   keep `serializeArguments` and `escapeHtmlAttribute` from
   `packages/events/src/compiler.ts` as-is).
3. Transform the `<script flowview>` block: remove the `flowview` attribute,
   and append two lines at the end of its content (ES imports are hoisted, so
   appending keeps user line numbers stable for sourcemaps):

   ```js
   import { registerFlowHandlers } from "@flowview/events/runtime";
   registerFlowHandlers("<scopeId>", { save, removeItem }, ["click"]);
   ```

   The third argument is the sorted, de-duplicated list of event names
   actually used in this file's bindings.

4. Validation (compile errors with located diagnostics, reuse `locate()` from
   `packages/events/src/diagnostics.ts`):
   - binding references a name not declared as a top-level function
     declaration in the `<script flowview>` block;
   - the same function name declared twice;
   - handler declared as arrow function / function expression → diagnostic
     telling the user to use a function declaration (v2 keeps the
     declarations-only rule; extending to `const f = () => {}` is a later,
     additive change);
   - more than one `<script flowview>` block in a file → error;
   - bindings present but no `<script flowview>` block → Phase 2: fall back
     to the legacy frontmatter path with a deprecation warning; Phase 3:
     error pointing to this authoring model.

### Runtime (v2, delegation)

Replace per-element binding with document-level delegation:

```ts
// registry: Map<scope, FlowEventHandlers>; listening: Set<eventName>
export function registerFlowHandlers(
  scope: string,
  handlers: FlowEventHandlers,
  events: string[],
): () => void;
```

- SSR guard: `typeof document === "undefined"` → no-op, like v1.
- On first registration of each event name, attach ONE `document` listener.
  Use capture phase for `focus` and `blur` (they do not bubble); bubble phase
  for everything else.
- Listener body: `event.target.closest('[data-flow-on-<event>]')` → read
  `data-flow-scope` and the handler name from the matched element → look up
  `registry.get(scope)?.[name]` → resolve args with the existing
  `readArgs`/`resolveArg` logic (`$event` → event, `$el` → the matched
  element, literals pass through) → call. Unknown handler → `console.warn`
  (dev aid), do nothing else.
- v2 dispatches to the innermost matching element only (same semantics as a
  native inline `onclick`); no re-dispatch up the tree.
- Delete `data-flow-bound` entirely — delegation makes it unnecessary and it
  is the source of defect #2. Elements added later (view transitions, `@for`
  re-renders) work automatically.
- The returned unbind function removes the scope from the registry (document
  listeners stay; they are inert without registry entries).
- Keep `bindFlowEvents` / `bindFlowEventsIn` exported as deprecated wrappers
  during Phases 1-2 (the legacy compile path still emits them); delete them
  in Phase 3.

### What gets deleted by the end

`extractFrontmatterFunctions`, `findUnsupportedHandlerNames`,
`analyzeAllCaptures` and their tests; the client-module re-declaration in
`compiler.ts` (`generateClientModule`/`generateClientFunction`); the
`data-flow-bound` mechanism.

---

## Phases

### Phase 1 — Delegated runtime with scopes

**Touches only** `packages/events/src/runtime/index.ts` and
`packages/events/src/runtime/index.test.ts`.

Tasks:

1. Implement `registerFlowHandlers(scope, handlers, events)` with the
   delegation design above (registry map, lazy per-event document listeners,
   capture for focus/blur, closest() matching, scope lookup, args resolution
   reused from the existing helpers).
2. Reimplement `bindFlowEvents(handlers)` as a thin deprecated wrapper:
   register under a reserved legacy scope `""` for every event name found by
   scanning the document once at call time (this keeps the current generated
   code working unchanged). Elements without `data-flow-scope` resolve
   against scope `""`.
3. Fix defect #2 as a side effect: no more `data-flow-bound`.
4. Rewrite/extend the runtime unit tests: existing ~13 tests must be adapted
   to delegation semantics; add new tests for (a) two scopes with the same
   handler name resolving independently, (b) an element added to the DOM
   after registration still firing, (c) focus delegation via capture,
   (d) unbind removing only its scope.

Exit criteria: `pnpm --filter @flowview/events test` green;
`pnpm --filter @flowview/events typecheck` green; no changes outside the two
files.

### Phase 2 — `<script flowview>` compile path

**Touches** `packages/events/src/parser.ts`, `packages/events/src/compiler.ts`,
`packages/astro-events/src/index.ts`, and their test files.

Tasks:

1. In `packages/astro-events`, locate the `<script flowview>` element via the
   already-parsed `@astrojs/compiler` AST (element named `script` with an
   attribute named `flowview`). Extract its content and source offsets.
2. New compiler entry point in `packages/events` (keep `compileEvents` for the
   legacy path): given template + script content, enumerate top-level
   function declarations with `ts.createSourceFile` (reuse the traversal
   patterns from `extractFrontmatterFunctions`, but WITHOUT extraction —
   only names/positions are needed), run the validations listed in the
   target-architecture section, and return: rewritten template (bindings →
   data attributes + `data-flow-scope`), rewritten script content (drop
   `flowview` attribute, append import + `registerFlowHandlers` call), and
   diagnostics.
3. Wire it into the astro-events Vite plugin with MagicString edits on the
   original `.astro` source (do not reassemble the file from slices like the
   legacy `s.overwrite(templateStart, code.length, ...)` does — edit the
   binding attributes and the script tag in place for better sourcemaps).
4. Precedence: if a file has a `<script flowview>` block, use the new path
   exclusively; if it has bindings but no such block, run the legacy
   frontmatter path and emit a deprecation warning diagnostic
   ("declare handlers in a <script flowview> block; frontmatter extraction
   will be removed").
5. Unit tests in both packages: happy path, each diagnostic, two components
   worth of markup in one file, scope id present on rewritten elements,
   event-name list correctness.

Exit criteria: `pnpm run test:dom && pnpm run test:astro-events` green; the
legacy path still passes its existing tests untouched.

### Phase 3 — Migrate demo, remove the legacy path

**Touches** `examples/astro-demo/**`, `packages/events/src/parser.ts`,
`packages/events/src/compiler.ts`, `packages/events/src/index.ts`,
`packages/astro-events/src/index.ts`, README.md, docs/flowview-spec.md.

Tasks:

1. Migrate `examples/astro-demo/src/pages/events.astro`: move `save`,
   `removeItem`, `previewInput` from frontmatter into a `<script flowview>`
   block. Update the authoring snippets
   (`src/snippets/events-author.astro.txt`, `home-events.astro.txt`,
   `events-compiled.html.txt`) to show the new model and new compiled output.
2. Turn the "bindings without `<script flowview>`" case into a located error.
3. Delete: `extractFrontmatterFunctions`, `analyzeAllCaptures`,
   `findUnsupportedHandlerNames`, `generateClientModule`,
   `generateClientFunction`, the deprecated `bindFlowEvents`/`bindFlowEventsIn`
   runtime exports, and all their tests.
4. Update README.md ("flowview Events" section) and docs/flowview-spec.md to
   describe the `<script flowview>` model and the delegation runtime.

Exit criteria: full `pnpm run test` green; `pnpm run build:demo` green; grep
for `analyzeAllCaptures|extractFrontmatterFunctions|data-flow-bound` returns
nothing.

### Phase 4 — Hardening (e2e)

**Touches** `examples/astro-demo/e2e/**` and demo pages as needed.

Playwright tests to add:

1. Two components on one page, both declaring a handler named `save` — each
   button triggers its own component's handler (regression for defects #2/#3).
2. Client-side navigation with Astro view transitions (add `<ClientRouter />`
   to a test page) — bindings still work after navigating away and back.
3. An element inside a flowview `@for` block re-rendered/added after load
   still fires (delegation regression).
4. `(input)` and `(focus)` events work (bubble + capture paths).

Exit criteria: `pnpm run test:e2e:demo` green in CI.

### Phase 5 (future, out of scope for v2)

Server-value arguments bridging both compilers:
`(click)="removeItem({{ item.id }})"` inside a flowview `@for` — the HTML
compiler interpolates the serialized value into `data-flow-args`. Requires
coordinated changes in `flowview-compiler` and `@flowview/events`; design
separately once Phases 1-4 ship.

## Decisions already made (do not re-litigate mid-phase)

- Runtime API name: `registerFlowHandlers(scope, handlers, events)`.
- Scope id: 12-hex sha256 of the workspace-relative `.astro` path.
- v2 accepts top-level **function declarations only** in `<script flowview>`.
- Innermost-element dispatch only; no upward re-dispatch.
- `focus`/`blur` delegated via capture phase; all other events bubble phase.
- Legacy frontmatter extraction: deprecation warning in Phase 2, removed in
  Phase 3 (all packages are private/pre-stable; no semver obligation).
