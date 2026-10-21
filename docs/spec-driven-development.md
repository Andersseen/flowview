# flowview — Spec-Driven Development Guide

> **Audience:** AI agents and contributors working on this repository, including
> small or limited models. This file is the single entry point. Read it fully
> before changing anything. It tells you what this project is, what it must
> never become, what state it is in, what to work on, and how to prove your
> change is correct.
>
> **Baseline reviewed:** 2026-10-15, remote `main`
> `9eb72c2c82d9b74975498cc3a8ba594375988723`: WS1–WS6, WS6A product acceptance,
> WS6B Rust consumer readiness and the website refresh are merged. Historical
> verification below remains attributed to its original workstream. Current
> evidence and maturity: [v1 roadmap](v1-roadmap.md#current-baseline-and-evidence).
> This documentation review does not claim a fresh run of every product suite.
>
> **Current phase:** controlled pre-1.0 product/DX evolution. The roadmap's active
> milestone marker is the sole scheduling authority; RC rules override it at freeze.

---

## 1. How to use this file (agent protocol)

Follow this loop for every task. Do not skip steps.

1. **Read the idea (§2) and the invariants (§4–5).** If your task would break
   an invariant or add a non-goal, stop and say so instead of doing it.
2. **Locate the code** using the architecture map (§3). Do not guess paths.
3. **Reproduce first.** Before fixing anything, write a failing test that
   demonstrates the problem at the lowest useful layer (§9).
4. **Make the smallest change within the active milestone or existing contract.**
   No drive-by refactors. Resolve the milestone's design questions before adding
   behavior; a new dependency or public API requires its recorded justification.
5. **Run the validation commands (§10)** relevant to what you touched, plus
   the full gate for implementation work. Documentation-only validation is
   specified separately in §10.
6. **Update documentation in the same change** if behavior visible to users
   changed: usage docs, `docs/flowview-spec.md` and executable conformance mapping.
   npm-visible work gets a Changeset; Rust releases follow `RELEASE.md`.
   Documentation-only planning does not bump versions or create a Changeset.
7. **Definition of done (§11)** must hold before you finish.

Rules that override everything else:

- **Before RC, only the active roadmap milestone may expand DX, APIs or language.**
  Read [the roadmap](v1-roadmap.md) for approved outcomes, non-goals and design
  gates. A queued or deferred feature is not authorized. Do not pull later work
  forward opportunistically. Changes outside approved scope need a reviewed
  roadmap amendment before implementation.
- **The normative spec describes what exists now.** Candidate syntax/APIs in
  planning documents are non-normative. Only the implementation that ships a
  feature changes the spec and its conformance tests. Existing-contract bug fixes
  remain permitted; this does not authorize unrelated additions.
- **At stabilization, stop adding features; at RC, freeze every public contract.**
  [The RC contract](rc-contract.md) governs allowed fixes, blockers and new
  candidates. The active milestone advances only with reviewed exit evidence.
- **Tests are the spec's enforcement.** New behavior needs enforcing tests;
  bug fixes need regressions. Planning documents must not add tests asserting
  that unimplemented features exist.
- **Diagnostics are a product feature.** Never degrade an error message,
  a location, or a diagnostic code to make an implementation simpler.

---

## 2. The idea (why this project exists)

flowview is **not a framework** and **not a static-site generator**. It is two
small, independent compilers that let you write modern template syntax and get
plain output with small, explicit runtime dependencies:

1. **The HTML compiler** (Rust, `crates/flowview-compiler`): one language, one
   parser, one AST, two first-class output targets for HTML-like templates
   with Angular-inspired control flow (`@if`, `@for`, `@switch`,
   `{{ interpolation }}`, plus the explicit `{{{ raw }}}` form for trusted
   HTML):
   - **JavaScript target** (default): a plain function
     `render(context): string`. Runs anywhere JavaScript runs: Node.js, Hono,
     Cloudflare Workers, Astro.
   - **Static HTML target**: `render_static(template, json_context)` renders
     final HTML natively in Rust with a constrained expression subset and no
     JavaScript execution. `compile_static()` parses and lowers once into a
     reusable `CompiledStaticTemplate` whose `render(&context)` can be called
     repeatedly.

   Server-first. No virtual DOM, no hydration, no components.

2. **The Events compiler** ("flowview Events", TypeScript,
   `packages/events`, `packages/vite-events`, `packages/astro-events`): supports
   event bindings (`<button (click)="save($event)">`) in standalone `.flow` and
   Astro files.
   It compiles them into `data-flow-on-*` attributes plus a tiny client
   module that binds real `addEventListener` calls. No framework runtime.

The bet: modern control-flow authoring syntax is productive, but today it is
locked inside full UI frameworks. flowview extracts that authoring experience
into compilers with **tiny runtimes and no framework assumptions**, so the
syntax can be used from any host.

The product value is **trustworthiness, not size**:

```txt
Template in.
Safe HTML string render function out.
Clear diagnostics when something is wrong.
No framework assumptions.
```

The normative language specification lives in
[`docs/flowview-spec.md`](./flowview-spec.md). That file defines _what_ the
compiler currently does; this file defines _how we work_. The
[v1 roadmap](v1-roadmap.md) defines approved future work and
[RC contract](rc-contract.md) defines freeze/release gates.
If the two ever conflict about language behavior, `flowview-spec.md` wins.

---

## 3. Architecture map (where everything lives)

```
flowview/
├── crates/
│   ├── flowview-compiler/        # HTML compiler (Rust library)
│   │   └── src/
│   │       ├── lib.rs            # public compile() entry point
│   │       ├── cursor.rs         # low-level source cursor
│   │       ├── parser/           # lexer, blocks, expressions, html, text,
│   │       │                     # interpolation, nodes
│   │       ├── ast.rs            # template AST (InterpolationMode: Escaped | Raw)
│   │       ├── javascript.rs     # embedded-JS expression scanner/validator
│   │       ├── validation.rs     # semantic validation
│   │       ├── codegen/          # JS render-function generation
│   │       │   └── javascript.rs
│   │       ├── static_html/      # native static HTML backend
│   │       │   ├── mod.rs        # compile_static(), CompiledStaticTemplate, render_static()
│   │       │   └── evaluator.rs  # static expression subset (Oxc-lowered)
│   │       └── diagnostics.rs    # structured diagnostics (FVxxxx codes)
│   └── flowview-cli/             # `flowview` binary: file/stdin → JS,
│                                 # JSON diagnostics, --line-offset, names
├── packages/
│   ├── runtime/                  # @flowview/runtime: escapeHtml, renderValue,
│   │                             # renderAttributeValue, renderRawValue
│   ├── compiler/                 # @flowview/compiler: WASM wrapper for the
│   │                             # Rust compiler used by the Vite/Astro plugins
│   ├── vite/                     # @flowview/vite: .flow imports; compiles
│   │                             # in-process through the bundled WASM
│   │                             # compiler (native `flowview` binary only via
│   │                             # compilerPath / FLOWVIEW_COMPILER_PATH or
│   │                             # the monorepo target/ directory)
│   ├── astro/                    # @flowview/astro: inline
│   │                             # <template flowview={...} is:raw>
│   │                             # regions in .astro (uses official Astro
│   │                             # parser; emits source maps)
│   ├── events/                   # @flowview/events: Events compiler core
│   │   └── src/
│   │       ├── parser.ts         # event-attribute scanner + argument
│   │       │                     # validation
│   │       ├── compiler.ts       # compileEvents(): html + client module
│   │       ├── scope.ts          # hashScope(): data-flow-scope ids
│   │       ├── diagnostics.ts    # located diagnostics
│   │       └── runtime/          # bindFlowEvents (dedup-safe)
│   ├── astro-events/             # @flowview/astro-events: Astro integration
│   │                             # for (event)="..." (magic-string source maps)
│   ├── vite-events/              # @flowview/vite-events: Vite integration for
│   │                             # (event)="..." in standalone .flow files
│   ├── prettier/                 # @flowview/prettier: format .astro files
│   │                             # while preserving flowview regions
│   └── vscode-flowview/          # editor grammar + snippets
├── examples/
│   ├── basic/                    # minimal .flow + Vite fixture
│   └── astro-demo/               # full Astro demo (deployed)
└── docs/
    ├── flowview-spec.md          # normative HTML-compiler v1 spec
    └── spec-driven-development.md# this file
```

Key data flows:

- **`.flow` file → JS module:** Vite plugin → `@flowview/compiler` (WASM,
  in-process) or an explicit/monorepo native `flowview` binary → Rust
  compiler → JavaScript plus an opt-in Source Map v3 → Vite module graph.
- **`.flow` + JSON context → final HTML:** `flowview compile --target
static-html` / `render_static()` → same parser and AST → native Rust
  renderer. Not exposed through the WASM wrapper yet.
- **Inline Astro template → JS:** `@flowview/astro` pre-transform →
  Astro parser finds `<template flowview is:raw>` → region compiled through
  the same Rust pipeline with the host `.astro` filename and offsets →
  content-addressed virtual module + compiler source map (alongside the
  pre-transform map).
- **`(click)="save($event)"` in Astro:** `@flowview/astro-events` →
  `@flowview/events` compiler → template rewritten with `data-flow-on-*` →
  the file's `<script data-flowview>` block is registered through
  `registerFlowHandlers` → `@flowview/events/runtime` binds listeners once per
  event type with delegated dispatch.

---

## 4. Invariants (never break these)

Language and output contracts. Every change must preserve all of them.

1. **The current language surface is exactly the normative spec.**
   Only an active roadmap milestone with reviewed design may extend it before
   stabilization. Do not add aliases, syntax or semantics opportunistically.
   Preserve one parser, one AST and Oxc expression validation across targets;
   static evaluation remains an explicit subset. Raw interpolation remains the
   sole explicit unescaped path, restricted to content positions.
2. **The JavaScript target's generated modules export exactly**
   `export function render(context) { ... }` returning a string. A baseline
   fixture test guards its output. The static HTML target must produce the
   same HTML for the same data, within its documented expression subset.
3. **Interpolated values are HTML-escaped by default** through
   `renderValue`. `null`, `undefined`, and `false` render as `""`. Only the
   explicit `{{{ }}}` form skips escaping; it requires a string (or
   `null`/`undefined`/`false`), is identical in both targets, and there is no
   global switch to disable escaping. flowview never sanitizes raw values and
   `{{{ }}}` must never weaken `{{ }}`.
4. **`@for` normalizes with `Array.from(value ?? [])`**; `@empty` renders
   only for empty collections; `@switch` never falls through.
5. **Templates are trusted source code.** Expressions are emitted into
   modules as-is (after validation). Never build anything that implies
   untrusted-template safety.
6. **Diagnostics are structured**: message, severity, filename, line,
   column, byte offsets, stable `FVxxxx` code. Embedded templates report
   host-file (page-relative) locations via line offsets.
7. **Invalid embedded JavaScript fails at compile time**, validated with a
   real JS parser, located at the original template position.
8. **Control-flow markers stay literal** inside HTML comments, `<script>`,
   `<style>`, tag names, attribute names, and word-like text (emails).
9. **Whitespace is preserved exactly** as specified (no text-node
   collapsing; the documented `@else`/`@empty` whitespace rules hold).
10. **The runtime stays tiny**: `escapeHtml`, `renderValue`,
    `renderAttributeValue`, `renderRawValue`, and the types. Do not add
    runtime exports unless the active roadmap explicitly requires and reviews
    them. Generated modules import `renderRawValue` only when the
    template uses `{{{ }}}`.
11. **Events stay separate from the HTML compiler.** The Rust compiler
    never learns about `(click)`; the events compiler never learns about
    `@if`.
12. **Events compiler surface stays narrow**: handlers are functions in the
    file's single `<script data-flowview>` block (ordinary client-side
    JavaScript); every `(event)="handler(...)"` binding must resolve to one,
    and arguments are `$event`, `$el`, JSON-serializable literals, or
    template-scope property paths. Handlers in Astro frontmatter are no
    longer supported.

## 5. Non-goals (never add these)

Static-site generation (routing, Markdown, multi-page output, assets, themes),
a JavaScript engine in the static target, components, hydration, compiler-level
reactivity/signal tracking, two-way binding, dependency injection, virtual DOM,
React/Hono-specific runtimes, Angular compatibility and untrusted-template
execution remain outside v1. Optional `@flowview/reactive` primitives already
exist; an explicit optional bridge is approved future roadmap scope, not implicit
compiler reactivity. Native runtime compilation is supported for trusted templates
that need it; ahead-of-time compilation is the preferred future distribution path
for templates known before the application runs. Hosts retain application ownership.

---

## 6. Current state (honest assessment)

Verified against the current repository state:

- Rust formatting, strict workspace Clippy, Rust tests and docs are gated in CI.
- TypeScript tests, typecheck, build, and demo checks are gated in CI.
- CI runs formatting, clippy, Rust tests, JS builds/tests/typecheck, and demo
  checks. Rust portability tests also run on macOS and Windows. External Rust
  consumer/static embedding coverage is present. The packed npm consumer now
  passes locally on macOS; CI packs once and runs that same artifact set on
  Linux, macOS, and Windows. The post-fix matrix passed for commit
  `35f8c3f211b1f70099462860d80dec944a27d501`.
  The demo deploys to Cloudflare.

What is already genuinely solid (recent hardening phases A–D):

- Expression validation with a production JS parser; hardened scanning for
  template literals, regexes, and keyword-adjacent expressions.
- Control-flow detection correctly ignores comments/scripts/styles/emails.
- Astro inline-template discovery uses the official Astro parser and emits
  source maps for the pre-transform.
- CLI supports stdin, display names, line offsets, JSON diagnostics.
- The events runtime deduplicates listeners and dispatches through one
  delegated listener per event type; handlers live in a normal
  `<script data-flowview>` block, so there is no frontmatter capture analysis
  left to get wrong; `@flowview/astro-events` emits magic-string source maps.
- Distribution: `@flowview/compiler` ships the compiler as WASM
  (`wasm-pack`, `pkg/` committed and rebuilt by `pnpm run build:compiler`);
  `@flowview/vite` and `@flowview/astro` compile in-process with it. Resolution
  order is explicit `compilerPath` > `FLOWVIEW_COMPILER_PATH` > a native binary
  in the monorepo `target/` directory > bundled WASM. Packages are public,
  versioned with Changesets, and published by `release.yml`.
- Static HTML target (`render_static`, `--target static-html`) with a
  deterministic expression subset and diagnostics `FV0016`–`FV0021`.
- Reusable `compile_static()` / `CompiledStaticTemplate`: parse, validation,
  and Oxc lowering happen once; `render()` only evaluates. `render_static()`
  wraps it, so repeated one-off calls no longer need to be the only path.
  No batch or site APIs; callers loop. Not exposed through WASM yet.
- Raw interpolation `{{{ expr }}}` in both targets with a shared AST mode, a
  shared fixture file proving cross-target parity, and diagnostics
  `FV0022`–`FV0025`.
- Exact whitespace preservation; explicit closing-brace rules; validated
  loop bindings; documented escaping limits per HTML context.

Remaining product gaps are tracked in the [current-state matrix](v1-roadmap.md#current-baseline-and-evidence)
and bounded milestones: compiler-backed editor diagnostics, scoped browser
composition, explicit forms/replacement behavior and compiler-free static
consumption. Spec conformance is implemented (99/99 at this baseline), not an
open blocker. Static rendering being Rust/CLI-only is a supported boundary;
exposing it through WASM is not required for v1.

---

## 7. Quality bar ("usable in serious projects" means…)

A team should be able to: `pnpm add @flowview/vite @flowview/runtime`,
add the plugin, import a `.flow` file, and ship — on macOS, Linux, Windows,
and CI — without installing Rust. When a template is wrong they see a
correct file/line/column with a stable code. When a runtime error occurs in
a render function they see their template line in the stack trace. Build
times stay flat as template count grows. The parser does not crash, hang,
or mis-nest on any input, valid or not. Every sentence in the spec is
enforced by a named test.

---

## 8. Historical hardening workstreams (WS1–WS6B)

Completed since the first version of this guide: WS1 (packed distribution
verification), WS2 (Rust JavaScript source maps), WS3 (Events capture analysis,
superseded by the `<script data-flowview>` model), WS5 (spec conformance
mapping), and WS6 (release engineering). Rust portability and external
Rust-consumer checks are also covered. WS4 landed in PR #31; fuzzing then found a UTF-8 diagnostic span bug
that is fixed in a follow-up (see WS4 status). Nightly fuzzing continues as a
regression detector.

WS6A product acceptance, WS6B Rust consumer readiness and the v1 website refresh
are also merged. This section preserves historical decisions and evidence; it is
not the active queue. Use the [roadmap](v1-roadmap.md#milestone-sequence-and-dependencies)
for all new product work. Historical deferrals do not authorize implementation.

### WS1 — Distribution: verify the installable compiler (done)

**Done:** the compiler ships as WASM in `@flowview/compiler`; `@flowview/vite`
and `@flowview/astro` use it in-process with no Rust toolchain, and
`compilerPath` / `FLOWVIEW_COMPILER_PATH` remain explicit native overrides
(the monorepo `target/` binary is auto-discovered for development).

The reusable release-readiness workflow (`release-readiness.yml`, originally
the packed-consumer workflow) builds and packs every publishable package once,
checks the actual manifests and compiler WASM files, then installs those exact
tarballs into an isolated temporary project. The
consumer checks compiler diagnostics and source maps, Vite development and
production compilation, rendered escaping, and the published `.flow` types.
Flowview dependency edges are overridden to the tarballs and their resolved
paths are checked. Native process launches are blocked, and Rust tools are
removed from and checked against the consumer `PATH`.

**Already covered:** external Rust consumption and static embedding tests, plus
Rust portability jobs on macOS and Windows. These do not verify npm packages.

**CI verified:** the reusable PR/release gate ran the same packed artifacts on
Linux, macOS, and Windows without setting up Rust in consumer jobs. The
post-fix `main` run for `35f8c3f211b1f70099462860d80dec944a27d501` passed the
build/pack job and all three external consumer jobs. Record the WASM-vs-native
decision in `docs/decisions/` if it is revisited.

**Exit checks:** the fresh external Vite project passes in dev and production
on Linux, macOS, and Windows from the same tarballs, with no Rust toolchain in
the consumer jobs. All existing suites still pass.

### WS2 — Source maps from the Rust compiler (done)

**Implemented:** JavaScript codegen records mappings while emitting template
expressions and control-flow expressions. The Rust compiler returns an optional
Source Map v3; WASM, `@flowview/compiler`, the native CLI JSON transport, Vite,
and Astro preserve it. Astro mappings target the host `.astro` source and apply
line and first-line column offsets once. Static rendering stays independent.

**Verified:** decoded map tests cover escaped/raw interpolation, conditions,
nested loops, dynamic and bound attributes, switch expressions and cases,
native/WASM parity, Vite transforms, and an embedded Astro expression inside
`@for`. A render-time failure test executes generated JavaScript, then resolves
the failing nested-loop expression back to its `.flow` line and column. The
Compiler Contract now documents the actual opt-in and integration behavior.

### WS3 — Events capture analysis (done; superseded)

Handlers moved out of Astro frontmatter into a normal `<script data-flowview>`
block, so there is no capture analysis left to harden. The allowlist
heuristics (`KNOWN_GLOBALS`) no longer exist. Nothing remains here; do not
reintroduce frontmatter handlers.

### WS4 — Adversarial testing: fuzzing, properties, corpus

**Why:** §6.2 — the project's one promise is trustworthiness; example-based
tests can't establish it.

**Implemented:** `fuzz/` has one cargo-fuzz `compiler` target converting
arbitrary bytes lossily to UTF-8 and exercising parse, JavaScript compile,
static compile, and static render. Its two small authored seeds cover the
syntax and hostile parser cases. `proptest` integration tests use bounded
recursive valid templates (256 cases per property) and verify compilation,
Oxc module parsing, deterministic code and source maps, AST span containment,
exact static text preservation, raw/escaped routing, and nested control-flow
structure. The authored, license-clean HTML fixture exercises document
structure and marker-looking text in comments, scripts, styles, and attributes.
`fast-check` tests run 1,000 scanner cases, 1,000 handler-expression cases, and
350 Events compilation cases.

**CI and reproduction:** ordinary Rust and Vitest suites run these properties.
`.github/workflows/fuzz.yml` runs the compiler target for 75 seconds on PRs and
main pushes and 600 seconds on its daily schedule. A failing job uploads
`fuzz/artifacts/` for 14 days. See `CONTRIBUTING.md` to run the target or replay
a saved crash. Fuzz discoveries must become deterministic regression tests.
The local 20-second smoke completed 52,243 executions without a crash; it
started from the two checked-in seeds and generated no crash artifact.

**Fuzz findings:** the first push fuzz run (2026-10-09) and the scheduled runs
of 2026-10-10 and 2026-10-11 all failed with the same panic in
`diagnostics.rs`: `line_and_column` sliced the source at a byte offset inside a
multibyte character (U+FFFD from `String::from_utf8_lossy`). Replaying and
minimizing the three crash artifacts gave one root cause. Quoted attribute
values drop backslash escapes, so offsets Oxc reports inside the unescaped
expression do not map 1:1 onto source bytes; `Diagnostic::from_source` only
clamped them to `source.len()`. The smallest reproduction is
`<p [x]="\\é">`.

**Fix:** `Diagnostic::from_source` now normalizes spans centrally
(`normalize_span`): offsets are clamped, a start inside a character snaps back
to its first byte, an end inside a character snaps forward past its last byte,
zero-width spans stay zero-width, and ASCII offsets never move.
`line_and_column` is panic-free by construction and keeps character-based
columns. `parser::parse` re-normalizes every diagnostic that left the parser,
which covers `to_position`/`to_cursor` spans built without the source, and
"Unexpected token" now covers the whole offending character instead of one
byte. Regressions: unit tests over every offset pair of a 1/2/3/4-byte and
U+FFFD string, `tests/unicode_diagnostics.rs` through
`parse_ast`/`compile`/`compile_static`/`render_static`, a Unicode-heavy
`proptest` over malformed FlowView markers (verified to fail before the fix),
and a readable corpus seed.

**Status:** WS4 is implemented. The fix replays all three recorded crashes and
their minimizations cleanly and a fresh 75-second fuzz run found nothing. The
600-second scheduled workflow stays enabled as an ongoing gate; its result on
the fixed commit is not recorded here until it has run.

### WS5 — Spec conformance mapping

**Why:** §6.3 — "spec-driven" requires the spec to be executable, or drift
is invisible.

**Status:** Implemented. `flowview-spec.md` declares 99 stable
`SPEC-HTML-xxx` requirements (IDs are never renumbered or reused), each
enforced by `// @spec SPEC-HTML-xxx`-annotated tests in the existing Rust and
Vitest/Node suites. `scripts/spec-coverage.mjs` (Node standard library only)
fails on duplicate or malformed declarations, annotations naming unknown IDs,
annotations outside recognized test files or not directly above a test,
requirements without evidence, and a stale `docs/spec-coverage.md`. It runs as
`pnpm run test:spec` and as the dedicated **Spec conformance** CI job (checkout
plus Node, no workspace install). Coverage is 100%, with no uncovered
baseline. The audit added a few focused tests for genuine gaps (no `ctx`
alias, runtime exports, static number rendering, Vite hooks and declarations,
Astro registration/markup/line offsets, snippets) and reconciled two stale spec
statements: the Vite compiler resolution order now matches WS1 (explicit path >
`FLOWVIEW_COMPILER_PATH` > monorepo binary > bundled WASM; no `PATH` lookup) and
dynamic attribute values go through `renderAttributeValue`. No implementation
bug was found. Contributor workflow: `CONTRIBUTING.md`.

**Exit checks:** met — the script runs in CI; the report is committed; every
_new_ spec requirement must land with an ID, a test, and a regenerated report.

### WS6 — Release engineering (done)

**Done before WS6 completion:** packages are public with `publishConfig`,
versions are managed with Changesets, `release.yml` publishes through
`changesets/action`, and the demo deploys from CI.

**Compatibility contract.** `docs/compatibility.md` separates repository
development requirements, published-package compatibility, and what CI tests.
`scripts/compatibility.json` is the single source of truth, and
`scripts/check-compatibility.mjs` fails CI if a peer range, the CI matrix, or
the docs drift from it. Declared equals tested: Node ≥ 22.12, Vite 6/7/8,
Astro 5/6/7, Prettier 3 (`^3.0.0`). All declared ranges passed unchanged; no
FlowView compatibility bug was found and no peer range was narrowed. No
`engines` field is added, because the runtime helpers also run in browsers and
edge runtimes.

**Gates** (all in the reusable `release-readiness.yml`, run by CI on every PR
and by `release.yml` before publishing):

- **Build and pack once:** `scripts/pack-release-artifacts.mjs` packs every
  publishable package (derived from the workspace and Changesets `ignore`, not a
  hardcoded list) and records each tarball's sha512. Every job below downloads
  these same tarballs.
- **Release artifacts:** `scripts/verify-release-artifacts.mjs` validates every
  tarball (manifest metadata, every `exports`/`types`/`main` target present and
  inside the tarball, compiler WASM payload, no `workspace:` protocols,
  internal dependency ranges satisfied by the packed versions, no references to
  the checkout) and runs `npm publish --dry-run` on each. The job also re-packs
  the pack job's build outputs in a fresh checkout and compares contents
  (`scripts/compare-release-artifacts.mjs`).
- **External packed consumers** (fresh projects, tarballs only, no Rust, native
  spawns blocked, lockfile pinned to the tarball sha512s): Vite
  (`@flowview/vite` + `vite-events`) and Astro (`@flowview/astro` +
  `astro-events`) on Linux, macOS, and Windows.
- **Version matrices (Ubuntu):** `Vite compatibility (6|7|8)`,
  `Astro compatibility (5|6|7)` (build, `astro check`, Events), and
  `Prettier compatibility (3.0.0|^3.0.0)`.
- **Node minimum:** `Node minimum (22.12.0)` runs the latest Vite 8 and Astro 6
  consumers and the Prettier consumer on exactly 22.12.0. Astro 7 currently
  requires Node `>=22.23.4` and runs on Node 24 in the compatibility and OS
  consumer jobs.
- **Release gating:** `release.yml` runs `Release readiness` first; the Changesets
  job `needs` it, restores the build outputs that were verified instead of
  rebuilding, and re-checks that they repack to the verified contents before
  publishing.

**Artifact identity boundary.** Every consumer and compatibility job uses the
byte-identical tarballs from the single pack job. The release job publishes
through `changeset publish`, which packs again; byte-identical tarballs are not
guaranteed because pnpm orders `package.json` dependency keys by install order,
so identity there is asserted as identical package contents (JSON compared
structurally).

**Exit checks:** met — a PR cannot break Vite 6, Astro 5, the Node floor, omit
tarball files, or leave `workspace:*` in published metadata while the
latest-version suites stay green.

### WS6A — Product acceptance demo (done)

**Why:** Unit, spec, packed-consumer and fuzz gates prove each piece; nothing
proved that the browser-facing pieces compose in a real application.

**What:** `examples/astro-demo` is now also the browser acceptance app. No
FlowView language, runtime, or compiler change.

- **Existing coverage kept:** landing/control-flow rendering, Events handlers,
  escaping/XSS, inline Astro templates, scope isolation, dynamic delegated
  events, View Transitions, client DOM + reactive state.
- **New surface:** `/capabilities`, linked from the navbar and landing page. The
  inventory is typed data rendered by an embedded FlowView template; evidence
  labels (Live demo, Browser E2E, Compiler/spec, Release compatibility) are
  declared per capability, and native static rendering is labelled
  Compiler/spec only.
- **Proofs** (`e2e/capabilities.spec.ts`): escaped vs raw interpolation (raw
  is author-trusted, no sanitizer) and an inert hostile value; `[disabled]`,
  `[attr.aria-busy]`, `[class.loading]`, `[class.active]` on both sides of a
  transition; `@switch` known cases and `@default`; `@for`/`@empty` as
  empty → items → empty on the reactive + DOM + Events stack with no rebinding;
  Unicode (`é € 🙂 U+FFFD`) and marker-looking text (`@if`, `{{ }}`, `{{{ }}}`,
  `contact@if.example`, escaped markers); standalone `.flow` and embedded
  Astro authoring.
- **Runtime error gate:** `e2e/fixtures.ts` fails any test on an unexpected
  `pageerror` or `console.error`; a known error must be allow-listed per test.
- **Production acceptance:** `pnpm run test:e2e:acceptance` runs only the
  capabilities suite against `astro preview` of the existing build
  (`FLOWVIEW_E2E_TARGET=preview`). The full suite stays on `astro dev`. CI
  runs both in the `astro-demo` job, reusing its build.

**Bug found:** formatting the new page exposed `@flowview/prettier` treating
UTF-8 byte offsets as UTF-16 indexes (emoji corrupted `.astro` files). Fixed with
a regression test and a patch changeset.

**Not here:** the native static renderer is not forced into the browser demo;
Entwine is its product-level dogfooding. Editor work is now roadmap M1 (formerly WS7).

### WS6B — Rust consumer readiness (done)

**Why:** A real multi-page Rust tool replaced its page renderer with
`compile_static` + `CompiledStaticTemplate::render` and proved semantic parity,
hostile-value escaping, Unicode and Linux/macOS/Windows behaviour, then declined
to merge because of avoidable adoption costs: no crates.io release, no declared
MSRV (effective 1.94 through Oxc 0.137), ~1.2 MB of Oxc in the binary, ~24%
larger raw HTML, a `serde_json::Value` detour, and undocumented static-expression
behaviour. Full evidence and numbers: [rust-consumer-readiness.md](rust-consumer-readiness.md).

**What (no language change, no npm behaviour change):**

- **Rust 0.2.0** for `flowview-compiler`, `flowview-cli`, `flowview-wasm`
  (independent of the npm version line). Compiler and CLI are
  `publish = ["crates-io"]`; wasm stays `publish = false`.
- **MSRV 1.91**, declared once in `[workspace.package]` and tested on exactly
  1.91.0 by `.github/workflows/rust-msrv.yml` (PRs and the Rust release gate).
  1.90 and the old Oxc 0.137 on 1.93.1 are rejected.
- **Oxc 0.137 → 0.116** (same direct crates, two-line API adaptation, no
  behaviour change; fuzz corpus + bounded run clean). Footprint outcome B:
  no clean way to drop Oxc from the static path; no fake feature, no second
  expression parser.
- **Release pipeline:** package inspection, `scripts/publish-rust.sh --dry-run`,
  compiler → exact index wait → registry-consumer smoke
  (`scripts/verify-registry-consumer.sh`) → CLI → registry `cargo install`.
  Packages ship README + LICENSE, no tests/fixtures.
- **Static embedding contract:** truthiness (empty arrays/objects truthy) and
  `.length` proven through the public API under existing IDs
  (SPEC-HTML-048/050/051/052); `.length > 0` documented as the collection check;
  `render_serializable` added as an ergonomic wrapper (not a perf feature).
- **Evidence tooling** (no assertions): `scripts/measure-static-footprint.sh`,
  `scripts/measure-whitespace-compression.mjs`, `bench_static` (10/100/1000).
- **Whitespace:** raw +8–36%, only +3–8% under gzip/Brotli; semantics kept, no
  minify option.

**Explicitly deferred to v2:** partials/recursion/components, zero-copy typed
context rendering, void-element output style, whitespace-collapsing option.

**Exit checks:** met — MSRV job green, `cargo publish --dry-run` for the
compiler succeeds, spec coverage 99/99. Publication itself happens only through
the Rust release workflow after merge. This is the recorded WS6B exit, not a new
claim about registry state; editor work is now roadmap M1.

### Former WS7 — Editor diagnostics (superseded by M1)

The diagnostics-only proposal is now part of the bounded
[Editor experience milestone](v1-roadmap.md#m1--editor-experience). Its transport,
range mapping, packaging and highlighting contracts must be resolved there.
Do not execute this historical queue independently of the active roadmap marker.

---

## 9. Testing doctrine

- Test at the **lowest layer that can express the behavior**: parsing and
  codegen in `crates/flowview-compiler` unit tests; escaping in
  `packages/runtime`; transform wiring in `packages/vite`/`astro`; event
  semantics in `packages/events`; integration slicing in
  `packages/astro-events`; end-to-end only in `examples/`.
- Bug fix ⇒ regression test that fails before the fix, in the same commit.
- Prefer tests that **execute generated code** and assert on rendered
  output over tests that assert on generated source text (source-text
  snapshots break on harmless codegen changes).
- Diagnostics tests assert message, code, line, and column — not just
  "an error occurred".

Static target note: expressions outside the documented static subset must
produce `FV0016`, never partial JavaScript emulation. Do not add function
calls to the static evaluator, and do not add one to make `{{{ }}}` more
convenient: sanitize before calling flowview.

Raw interpolation note: the shared fixture
`crates/flowview-compiler/tests/fixtures/raw-interpolation-parity.json` is
consumed by both the Rust static-renderer tests and the TypeScript tests that
execute the generated JavaScript. Add a case there whenever raw-value behavior
changes so the two targets cannot drift.

## 10. Validation commands

| Scope                 | Command                                                 |
| --------------------- | ------------------------------------------------------- |
| Rust: format          | `cargo fmt --all -- --check`                            |
| Rust: lint            | `cargo clippy --workspace --all-targets -- -D warnings` |
| Rust: tests           | `cargo test --workspace`                                |
| JS: all package tests | `pnpm run test`                                         |
| Spec conformance      | `pnpm run test:spec`                                    |
| JS: formatting        | `pnpm run format:check`                                 |
| JS: types             | `pnpm run typecheck`                                    |
| Runtime only          | `pnpm --filter @flowview/runtime test`                  |
| Vite plugin           | `pnpm --filter @flowview/vite test`                     |
| Astro integration     | `pnpm --filter @flowview/astro test`                    |
| Events core           | `pnpm --filter @flowview/events test`                   |
| Events Astro          | `pnpm --filter @flowview/astro-events test`             |
| Demo gate             | `pnpm --filter @flowview/astro-demo run check`          |

**Implementation gate:** use the complete verification gate in `AGENTS.md`
(Rust fmt, locked Clippy/tests, compiler docs; frozen pnpm install, format,
typecheck, test, build and lint), plus affected browser and consumer checks.
The [RC contract](rc-contract.md) adds release-level evidence requirements.

**Markdown/process-only changes** that do not alter normative behavior use:

```sh
git diff --check
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run test:spec
```

Check local documentation links and any repository-specific documentation checks.
Do not add unimplemented-feature tests or edit product code to validate a plan.

## 11. Definition of done

A change is done when all of these hold:

1. The applicable validation gate (§10) passes; limitations are reported honestly.
2. New behavior has tests at the lowest useful layer; fixed bugs have
   regression tests.
3. No invariant (§4) is violated; no non-goal (§5) crept in.
4. Release notes/Changesets follow the affected release line; docs-only planning
   has no Changeset, version bump or publication.
5. User-visible behavior changes are reflected in `README.md` and
   `docs/flowview-spec.md`, and spec/README/code agree with each other.
6. Diagnostics affected by the change still report correct locations for
   both standalone `.flow` and Astro-embedded templates.
7. No new dependencies, no expanded public API, unless the active
   roadmap milestone explicitly required them and the design decision is recorded.
