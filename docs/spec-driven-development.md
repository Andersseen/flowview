# flowview — Spec-Driven Development Guide

> **Audience:** AI agents and contributors working on this repository, including
> small or limited models. This file is the single entry point. Read it fully
> before changing anything. It tells you what this project is, what it must
> never become, what state it is in, what to work on, and how to prove your
> change is correct.
>
> **Last verified:** 2026-10-07 (full gate passing: 151 Rust tests, all JS suites, typecheck, lint, and format check; raw interpolation `{{{ }}}` added on top of commit `3cc7f85`).

---

## 1. How to use this file (agent protocol)

Follow this loop for every task. Do not skip steps.

1. **Read the idea (§2) and the invariants (§4–5).** If your task would break
   an invariant or add a non-goal, stop and say so instead of doing it.
2. **Locate the code** using the architecture map (§3). Do not guess paths.
3. **Reproduce first.** Before fixing anything, write a failing test that
   demonstrates the problem at the lowest useful layer (§9).
4. **Make the smallest change that fixes the behavior.** No drive-by
   refactors, no new features, no new dependencies unless the workstream
   (§8) explicitly calls for one.
5. **Run the validation commands (§10)** relevant to what you touched, plus
   the full gate before declaring done.
6. **Update documentation in the same change** if behavior visible to users
   changed: `README.md`, `docs/flowview-spec.md`, and `CHANGELOG.md`
   (top of the `Unreleased` section, past tense, one line).
7. **Definition of done (§11)** must hold before you finish.

Rules that override everything else:

- **Do not add features.** The current phase is: make what exists correct,
  predictable, and usable in serious projects. A "small nice addition" is a
  feature. Reject it.
- **Do not expand the language surface** (§4) or the runtime exports. The
  surface has changed deliberately exactly once since v1 was frozen: raw
  interpolation `{{{ expr }}}` (see §4.1 and `flowview-spec.md` §Raw
  Interpolation). That was an explicit, narrowly scoped language decision, not a
  precedent for "small additions".
- **Tests are the spec's enforcement.** A behavior without a test does not
  exist. A change without a test is not done.
- **Diagnostics are a product feature.** Never degrade an error message,
  a location, or a diagnostic code to make an implementation simpler.

---

## 2. The idea (why this project exists)

flowview is **not a framework** and **not a static-site generator**. It is two
small, independent compilers that let you write modern template syntax and get
plain, dependency-free output:

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
   `packages/events` + `packages/astro-events`): lets you write Angular-style
   event bindings (`<button (click)="save($event)">`) in Astro files.
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
compiler must do; this file defines _how we work_ and _what to improve next_.
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
  compiler → JS source (no source map yet) → Vite module graph.
- **`.flow` + JSON context → final HTML:** `flowview compile --target
static-html` / `render_static()` → same parser and AST → native Rust
  renderer. Not exposed through the WASM wrapper yet.
- **Inline Astro template → JS:** `@flowview/astro` pre-transform →
  Astro parser finds `<template flowview is:raw>` → region compiled through
  the same Rust pipeline → content-addressed virtual module + source map.
- **`(click)="save($event)"` in Astro:** `@flowview/astro-events` →
  `@flowview/events` compiler → template rewritten with `data-flow-on-*` →
  the file's `<script data-flowview>` block is registered through
  `registerFlowHandlers` → `@flowview/events/runtime` binds listeners once per
  event type with delegated dispatch.

---

## 4. Invariants (never break these)

Language and output contracts. Every change must preserve all of them.

1. **The language surface is frozen** to what
   [`flowview-spec.md` §Language Surface](./flowview-spec.md) lists:
   text, HTML-like elements, quoted attributes, `{{ expr }}`,
   `@if/@else if/@else`, `@for` + `track` + `@empty`,
   `@switch/@case/@default`, binding attributes (`[disabled]`, `[attr.x]`,
   `[class.x]`), `{{{ expr }}}` raw interpolation, escapes (`\@if`, `\{{`,
   `\{{{`, `\}`), and `context` as the only top-level binding. Nothing else.
   No `ctx` alias. `{{{ }}}` was added deliberately (content positions only;
   rejected in tag names, attribute names, and attribute values) and is the
   only unescaped output path.
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
    runtime exports. Generated modules import `renderRawValue` only when the
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

Static-site generation (routing, Markdown, multi-page output, asset
pipelines, themes), a JavaScript engine in the static target, components, hydration, signals/reactivity, two-way binding, routing,
dependency injection, virtual DOM, directives, React/Hono-specific runtime
integrations, Angular compatibility, user-submitted template execution,
runtime compilation as a production path. If a task seems to require one of
these, the task is wrong — stop and report.

---

## 6. Current state (honest assessment)

Verified 2026-10-07:

- `cargo test --workspace`: **151 tests passing**. `cargo fmt` and
  `cargo clippy -D warnings` clean in CI.
- All JS package suites passing (`runtime` 27, `compiler` 32, `vite` 9,
  `astro` 14, `dom` 13, `reactive` 32, `events` 17, `astro-events` 14,
  `vite-events` 27, `prettier` 10, VS Code grammar checks, demo unit tests).
  `pnpm run typecheck` clean.
- CI runs formatting, clippy, Rust tests, JS builds/tests/typecheck, and the
  demo check. The demo deploys to Cloudflare.

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

What keeps it from serious production use today (§8 addresses these):

1. **No source maps from the Rust compiler.** `.flow` → JS has no mapping,
   so stack traces and devtools point at generated code. (The Astro
   pre-transform maps the _slicing_, not the generated render function.)
2. **No adversarial testing.** All tests are example-based. There is no
   fuzzing, no property-based testing, no large real-world HTML corpus run
   through the parser. For a parser whose whole value is trustworthiness,
   this is the biggest confidence gap.
3. **No conformance mapping.** `flowview-spec.md` makes normative claims,
   but nothing links each claim to the test(s) that enforce it, so spec
   drift is detected only by humans.
4. **Editor diagnostics don't exist** (grammar + snippets only). The CLI
   already emits JSON diagnostics, so the plumbing exists but nothing
   consumes it.
5. **Distribution is not verified outside the monorepo.** The WASM compiler
   is bundled and tested in-repo, but there is no fixture project outside
   the workspace and CI runs on Linux only.
6. **Static rendering is Rust/CLI only.** The WASM wrapper does not expose
   it, and expressions outside the documented subset are rejected by design.

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

## 8. Workstreams (prioritized; hardening only, no features)

Completed since the first version of this guide: WS1 (distribution, apart from
the verification items below), WS3 (Events capture analysis, superseded by the
`<script data-flowview>` model), and most of WS6 (release engineering).

Work top to bottom. Each workstream is independently shippable. Within one,
do the steps in order and run the exit checks before moving on.

### WS1 — Distribution: verify the installable compiler (mostly done)

**Done:** the compiler ships as WASM in `@flowview/compiler`; `@flowview/vite`
and `@flowview/astro` use it in-process with no Rust toolchain, and
`compilerPath` / `FLOWVIEW_COMPILER_PATH` remain explicit native overrides
(the monorepo `target/` binary is auto-discovered for development).

**Remaining:** an integration test in a temp dir _outside_ the workspace that
installs the packed packages and builds a `.flow` import in dev and production,
and a CI job that exercises the packaged flow on Linux, macOS, and Windows.
Record the WASM-vs-native decision in `docs/decisions/` if it is revisited.

**Exit checks:** a fresh Vite project outside this repo, with no Rust
installed, builds a `.flow` import in dev and production. All existing
suites still pass.

### WS2 — Source maps from the Rust compiler

**Why:** Spec §Compiler Contract lists source maps as planned; serious
debugging needs them; `@flowview/vite` currently returns `map: null`
implicitly.

**What:** Emit a source map (mappings from generated JS positions back to
template positions) alongside generated code. Respect the existing
`line offset` input so Astro-embedded templates map to the `.astro` file.

**Steps:** extend `codegen/javascript.rs` to track output positions per emitted node →
add a `--source-map` CLI flag emitting JSON (code + map) → plumb through
`@flowview/vite` and `@flowview/astro` `transform` results → tests: a
runtime error thrown inside an `@for` body resolves to the correct template
line in Node with source-map support enabled.

**Exit checks:** `cargo test --workspace`, `pnpm run test:vite`,
`pnpm run test:astro`; a fixture proves correct line resolution; spec's
"Source map options when implemented" sentence replaced with the actual
contract.

### WS3 — Events capture analysis (done; superseded)

Handlers moved out of Astro frontmatter into a normal `<script data-flowview>`
block, so there is no capture analysis left to harden. The allowlist
heuristics (`KNOWN_GLOBALS`) no longer exist. Nothing remains here; do not
reintroduce frontmatter handlers.

### WS4 — Adversarial testing: fuzzing, properties, corpus

**Why:** §6.2 — the project's one promise is trustworthiness; example-based
tests can't establish it.

**What (Rust compiler):**

- `cargo-fuzz` target: arbitrary bytes → `compile()` must never panic,
  hang, or overflow — only succeed or return diagnostics.
- Property tests (`proptest`): generated valid templates round-trip —
  compiled output, when executed, preserves static text exactly; every
  interpolation goes through `renderValue`; block nesting in output
  matches input nesting.
- Corpus test: a directory of real-world HTML pages (checked in, license-
  clean) compiles without spurious control-flow detection, and static
  content is byte-identical after render.
- Generated-JS validity property: every successful compile parses as valid
  ES2020 (validate with the existing JS-expression parser infrastructure or
  in the JS test layer).

**What (events compiler):** the same never-throw-unexpectedly guarantee for
`findEventBindings`/`compileEvents` over arbitrary HTML-ish input (vitest +
`fast-check`).

**Exit checks:** fuzz target runs locally via documented command and in a
scheduled CI job (time-boxed, e.g. 5 min per push, longer nightly);
property suites run in normal CI; any crashes found are fixed with
regression tests before this workstream closes.

### WS5 — Spec conformance mapping

**Why:** §6.3 — "spec-driven" requires the spec to be executable, or drift
is invisible.

**What:** Give every normative requirement in `flowview-spec.md` a stable ID
(`SPEC-HTML-001` …) and annotate the enforcing tests (Rust: test name
comment; TS: `describe`/`it` naming). Add a checker script
(`scripts/spec-coverage.mjs`) that lists IDs without tests and fails CI on
regressions from a committed baseline.

**Exit checks:** the script runs in CI; the initial report is committed;
every _new_ spec sentence added later must land with an ID and a test.

### WS6 — Release engineering (mostly done)

**Done:** packages are public with `publishConfig`, versions are managed with
Changesets, `release.yml` builds, tests, and publishes through
`changesets/action`, and the demo deploys from CI.

**Remaining:** an explicit compatibility statement (Node ≥ X, Vite ≥ Y, Astro
≥ Z, tested in CI) and a dry-run publish / `npm pack` install check against the
WS1 out-of-repo fixture.

### WS7 — Editor diagnostics (only after WS1–WS6)

**Why:** Listed as future work in the spec; big DX win; strictly additive.

**What:** A minimal LSP (or VS Code extension addition) that runs the CLI's
existing JSON diagnostics on save for `.flow` files and inline Astro
regions. No formatting, no completion — diagnostics only.

**Exit checks:** grammar tests still pass; diagnostics appear at correct
positions for both `.flow` and embedded templates.

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
| JS: formatting        | `pnpm run format:check`                                 |
| JS: types             | `pnpm run typecheck`                                    |
| Runtime only          | `pnpm --filter @flowview/runtime test`                  |
| Vite plugin           | `pnpm --filter @flowview/vite test`                     |
| Astro integration     | `pnpm --filter @flowview/astro test`                    |
| Events core           | `pnpm --filter @flowview/events test`                   |
| Events Astro          | `pnpm --filter @flowview/astro-events test`             |
| Demo gate             | `pnpm --filter @flowview/astro-demo run check`          |

**Full gate (run before declaring any task done):**

```sh
pnpm run lint \
  && cargo test --workspace \
  && pnpm run test
```

## 11. Definition of done

A change is done when all of these hold:

1. The full gate (§10) passes locally.
2. New behavior has tests at the lowest useful layer; fixed bugs have
   regression tests.
3. No invariant (§4) is violated; no non-goal (§5) crept in.
4. `CHANGELOG.md` has a one-line entry under `Unreleased`.
5. User-visible behavior changes are reflected in `README.md` and
   `docs/flowview-spec.md`, and spec/README/code agree with each other.
6. Diagnostics affected by the change still report correct locations for
   both standalone `.flow` and Astro-embedded templates.
7. No new dependencies, no expanded public API, unless the active
   workstream (§8) explicitly required them and the decision is recorded.
