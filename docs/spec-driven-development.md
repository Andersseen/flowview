# Flowmark — Spec-Driven Development Guide

> **Audience:** AI agents and contributors working on this repository, including
> small or limited models. This file is the single entry point. Read it fully
> before changing anything. It tells you what this project is, what it must
> never become, what state it is in, what to work on, and how to prove your
> change is correct.
>
> **Last verified:** 2026-07-03 (all test suites passing at commit `a57a259`).

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
   changed: `README.md`, `docs/flowmark-spec.md`, and `CHANGELOG.md`
   (top of the `Unreleased` section, past tense, one line).
7. **Definition of done (§11)** must hold before you finish.

Rules that override everything else:

- **Do not add features.** The current phase is: make what exists correct,
  predictable, and usable in serious projects. A "small nice addition" is a
  feature. Reject it.
- **Do not expand the language surface** (§4) or the runtime exports.
- **Tests are the spec's enforcement.** A behavior without a test does not
  exist. A change without a test is not done.
- **Diagnostics are a product feature.** Never degrade an error message,
  a location, or a diagnostic code to make an implementation simpler.

---

## 2. The idea (why this project exists)

Flowmark is **not a framework**. It is two small, independent compilers that
let you write modern template syntax and get plain, dependency-free output:

1. **The HTML compiler** (Rust, `crates/flowmark-compiler`): turns HTML-like
   templates with Angular-inspired control flow (`@if`, `@for`, `@switch`,
   `{{ interpolation }}`) into a plain JavaScript function
   `render(context): string`. Server-first. No virtual DOM, no hydration,
   no components. The output runs anywhere JavaScript runs: Node.js, Hono,
   Cloudflare Workers, Astro, static generation.

2. **The Events compiler** ("Flowmark Events", TypeScript,
   `packages/dom` + `packages/astro-events`): lets you write Angular-style
   event bindings (`<button (click)="save($event)">`) in Astro files.
   It compiles them into `data-flow-on-*` attributes plus a tiny client
   module that binds real `addEventListener` calls. No framework runtime.

The bet: modern control-flow authoring syntax is productive, but today it is
locked inside full UI frameworks. Flowmark extracts that authoring experience
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
[`docs/flowmark-spec.md`](./flowmark-spec.md). That file defines _what_ the
compiler must do; this file defines _how we work_ and _what to improve next_.
If the two ever conflict about language behavior, `flowmark-spec.md` wins.

---

## 3. Architecture map (where everything lives)

```
flowmark/
├── crates/
│   ├── flowmark-compiler/        # HTML compiler (Rust library)
│   │   └── src/
│   │       ├── lib.rs            # public compile() entry point
│   │       ├── cursor.rs         # low-level source cursor
│   │       ├── parser/           # lexer, blocks, expressions, html, text,
│   │       │                     # interpolation, nodes
│   │       ├── ast.rs            # template AST
│   │       ├── javascript.rs     # embedded-JS expression scanner/validator
│   │       ├── validation.rs     # semantic validation
│   │       ├── codegen.rs        # JS render-function generation
│   │       └── diagnostics.rs    # structured diagnostics (FMxxxx codes)
│   └── flowmark-cli/             # `flowmark` binary: file/stdin → JS,
│                                 # JSON diagnostics, --line-offset, names
├── packages/
│   ├── runtime/                  # @flowview/runtime: escapeHtml, renderValue
│   ├── vite/                     # @flowview/vite: .flow imports; spawns the
│   │                             # `flowmark` CLI (workspace target/ or PATH)
│   ├── astro/                    # @flowview/astro: inline
│   │                             # <template flowmark={...} is:raw>
│   │                             # regions in .astro (uses official Astro
│   │                             # parser; emits source maps)
│   ├── dom/                      # @flowview/dom: Events compiler core
│   │   └── src/
│   │       ├── parser.ts         # event-attribute scanner + frontmatter
│   │       │                     # function extraction (TypeScript AST) +
│   │       │                     # capture analysis
│   │       ├── compiler.ts       # compileEvents(): html + client module
│   │       ├── diagnostics.ts    # located diagnostics
│   │       └── runtime/          # bindFlowEvents (dedup-safe)
│   ├── astro-events/             # @flowview/astro-events: Astro integration
│   │                             # for (event)="..." (magic-string source maps)
│   └── vscode-flowmark/          # editor grammar + snippets
├── examples/
│   ├── basic/                    # minimal .flow + Vite fixture
│   └── astro-demo/               # full Astro demo (deployed)
└── docs/
    ├── flowmark-spec.md          # normative HTML-compiler v1 spec
    └── spec-driven-development.md# this file
```

Key data flows:

- **`.flow` file → JS module:** Vite plugin → spawns `flowmark` CLI →
  Rust compiler → JS source (no source map yet) → Vite module graph.
- **Inline Astro template → JS:** `@flowview/astro` pre-transform →
  Astro parser finds `<template flowmark is:raw>` → region compiled through
  the same Rust pipeline → content-addressed virtual module + source map.
- **`(click)="save($event)"` in Astro:** `@flowview/astro-events` →
  `@flowview/dom` compiler → template rewritten with `data-flow-on-*` →
  client module generated from frontmatter `function` declarations →
  `@flowview/dom/runtime` binds listeners once per element/event.

---

## 4. Invariants (never break these)

Language and output contracts. Every change must preserve all of them.

1. **The language surface is frozen** to what
   [`flowmark-spec.md` §Language Surface](./flowmark-spec.md) lists:
   text, HTML-like elements, quoted attributes, `{{ expr }}`,
   `@if/@else if/@else`, `@for` + `track` + `@empty`,
   `@switch/@case/@default`, escapes (`\@if`, `\{{`, `\}`), and `context`
   as the only top-level binding. Nothing else. No `ctx` alias.
2. **Generated modules export exactly**
   `export function render(context) { ... }` returning a string.
3. **Interpolated values are HTML-escaped by default** through
   `renderValue`. `null`, `undefined`, and `false` render as `""`.
4. **`@for` normalizes with `Array.from(value ?? [])`**; `@empty` renders
   only for empty collections; `@switch` never falls through.
5. **Templates are trusted source code.** Expressions are emitted into
   modules as-is (after validation). Never build anything that implies
   untrusted-template safety.
6. **Diagnostics are structured**: message, severity, filename, line,
   column, byte offsets, stable `FMxxxx` code. Embedded templates report
   host-file (page-relative) locations via line offsets.
7. **Invalid embedded JavaScript fails at compile time**, validated with a
   real JS parser, located at the original template position.
8. **Control-flow markers stay literal** inside HTML comments, `<script>`,
   `<style>`, tag names, attribute names, and word-like text (emails).
9. **Whitespace is preserved exactly** as specified (no text-node
   collapsing; the documented `@else`/`@empty` whitespace rules hold).
10. **The runtime stays tiny**: `escapeHtml`, `renderValue`, and the types.
    Do not add runtime exports.
11. **Events stay separate from the HTML compiler.** The Rust compiler
    never learns about `(click)`; the events compiler never learns about
    `@if`.
12. **Events compiler surface stays narrow**: handlers are named
    `function` declarations in frontmatter; calls are `name()`,
    `name($event)`, `name($el)`, or JSON-serializable literals. Handlers
    that capture server-side frontmatter bindings are compile errors, not
    silent bugs.

## 5. Non-goals (never add these)

Components, hydration, signals/reactivity, two-way binding, routing,
dependency injection, virtual DOM, directives, React/Hono-specific runtime
integrations, Angular compatibility, user-submitted template execution,
runtime compilation as a production path. If a task seems to require one of
these, the task is wrong — stop and report.

---

## 6. Current state (honest assessment)

Verified 2026-07-03:

- `cargo test --workspace`: **71 tests passing**. `cargo fmt` and
  `cargo clippy -D warnings` clean in CI.
- All JS package suites passing (`runtime`, `vite` 5, `astro` 9,
  `dom`, `astro-events` 10, demo unit tests 10). `pnpm run typecheck` clean.
- CI runs formatting, clippy, Rust tests, JS builds/tests/typecheck, and the
  demo check. The demo deploys to Cloudflare.

What is already genuinely solid (recent hardening phases A–D):

- Expression validation with a production JS parser; hardened scanning for
  template literals, regexes, and keyword-adjacent expressions.
- Control-flow detection correctly ignores comments/scripts/styles/emails.
- Astro inline-template discovery uses the official Astro parser and emits
  source maps for the pre-transform.
- CLI supports stdin, display names, line offsets, JSON diagnostics.
- Events frontmatter extraction uses the TypeScript AST (not regex);
  capture analysis exists; the events runtime deduplicates listeners;
  `@flowview/astro-events` emits magic-string source maps.
- Exact whitespace preservation; explicit closing-brace rules; validated
  loop bindings; documented escaping limits per HTML context.

What keeps it from serious production use today (§8 addresses these):

1. **You cannot install it.** Every package is `"private": true`, versions
   are `0.1.0`, and `@flowview/vite` works by spawning a `flowmark` binary
   found in the monorepo `target/` directory or on `PATH`. Outside this
   repo, nothing works without manually building the Rust CLI.
2. **No source maps from the Rust compiler.** `.flow` → JS has no mapping,
   so stack traces and devtools point at generated code. (The Astro
   pre-transform maps the _slicing_, not the generated render function.)
3. **Events capture analysis is allowlist-based.** `parser.ts` decides
   "captured vs. global" using hard-coded `KNOWN_GLOBALS`/reserved-word
   sets over identifiers found in the body. Unknown browser globals
   (`IntersectionObserver`, `crypto`, custom elements…) become false
   "capture" errors; some real captures can slip through.
4. **Per-process compile only.** The Vite plugin spawns one CLI process per
   template compile. Fine for demos; measurable overhead on real projects
   with many templates.
5. **No adversarial testing.** All tests are example-based. There is no
   fuzzing, no property-based testing, no large real-world HTML corpus run
   through the parser. For a parser whose whole value is trustworthiness,
   this is the biggest confidence gap.
6. **No conformance mapping.** `flowmark-spec.md` makes normative claims,
   but nothing links each claim to the test(s) that enforce it, so spec
   drift is detected only by humans.
7. **Editor diagnostics don't exist** (grammar + snippets only). The CLI
   already emits JSON diagnostics, so the plumbing exists but nothing
   consumes it.

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

Work top to bottom. Each workstream is independently shippable. Within one,
do the steps in order and run the exit checks before moving on.

### WS1 — Distribution: make the compiler installable (highest priority)

**Why:** Nothing else matters if only this monorepo can run Flowmark.

**What:** Give `@flowview/vite` (and the CLI) a distribution story that does
not require a local Rust toolchain.

**How (decision to make first, record it in `docs/decisions/`):**

- Option A (recommended): compile `flowmark-compiler` to WASM
  (`wasm32-wasip1` or wasm-bindgen) and call it in-process from
  `@flowview/vite` / `@flowview/astro`. Kills process-spawn overhead (fixes
  §6.4 too), works on every platform, no postinstall downloads.
- Option B: prebuilt native binaries per platform published as optional
  npm dependencies (the esbuild/swc pattern), CLI resolution kept.
- Keep the `compilerPath` escape hatch working either way.

**Steps:** decision doc → build pipeline for the artifact → plugin
resolution order (explicit option > bundled artifact > workspace target/ >
PATH) → integration test that runs in a temp dir _outside_ the workspace →
CI job that exercises the packaged flow on Linux/macOS/Windows.

**Exit checks:** a fresh Vite project outside this repo, with no Rust
installed, builds a `.flow` import in dev and production. All existing
suites still pass. `docs/flowmark-spec.md` §Vite Plugin updated if
resolution behavior changed.

### WS2 — Source maps from the Rust compiler

**Why:** Spec §Compiler Contract lists source maps as planned; serious
debugging needs them; `@flowview/vite` currently returns `map: null`
implicitly.

**What:** Emit a source map (mappings from generated JS positions back to
template positions) alongside generated code. Respect the existing
`line offset` input so Astro-embedded templates map to the `.astro` file.

**Steps:** extend `codegen.rs` to track output positions per emitted node →
add a `--source-map` CLI flag emitting JSON (code + map) → plumb through
`@flowview/vite` and `@flowview/astro` `transform` results → tests: a
runtime error thrown inside an `@for` body resolves to the correct template
line in Node with source-map support enabled.

**Exit checks:** `cargo test --workspace`, `pnpm run test:vite`,
`pnpm run test:astro`; a fixture proves correct line resolution; spec's
"Source map options when implemented" sentence replaced with the actual
contract.

### WS3 — Events capture analysis: replace allowlist heuristics

**Why:** §6.3 — false positives block legitimate handlers; false negatives
ship broken client code. Correctness of diagnostics is a core promise.

**What:** Use the TypeScript AST (already a dependency of
`packages/dom/src/parser.ts`) for real lexical scope analysis: an
identifier is a capture **iff** it resolves to a frontmatter binding
outside the handler and is not a declared parameter/local. Unknown
identifiers that don't resolve to frontmatter bindings are _not_ errors
(they are browser globals at runtime) — at most a warning.

**Steps:** write failing tests first: `IntersectionObserver`, `crypto`,
`customElements`, shadowed frontmatter names, destructured locals, nested
functions, `import`ed frontmatter values (must error), `const` frontmatter
data used in a handler (must error) → replace `KNOWN_GLOBALS` logic with
scope resolution → keep diagnostic wording and locations stable.

**Exit checks:** `pnpm --filter @flowview/dom test`,
`pnpm --filter @flowview/astro-events test`, `pnpm run typecheck`.
No allowlist sets remain in `parser.ts`.

### WS4 — Adversarial testing: fuzzing, properties, corpus

**Why:** §6.5 — the project's one promise is trustworthiness; example-based
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

**Why:** §6.6 — "spec-driven" requires the spec to be executable, or drift
is invisible.

**What:** Give every normative requirement in `flowmark-spec.md` a stable ID
(`SPEC-HTML-001` …) and annotate the enforcing tests (Rust: test name
comment; TS: `describe`/`it` naming). Add a checker script
(`scripts/spec-coverage.mjs`) that lists IDs without tests and fails CI on
regressions from a committed baseline.

**Exit checks:** the script runs in CI; the initial report is committed;
every _new_ spec sentence added later must land with an ID and a test.

### WS6 — Release engineering

**Why:** §6.1 — versions, publishing, and support policy are what make a
dependency safe to adopt. Do this after WS1 proves the artifact works.

**What:** flip packages to public with `publishConfig`, coherent versioning
(one lockstep version for `runtime`/`vite`/`astro`; events packages may
stay 0.x longer and must be labeled experimental), `CHANGELOG.md` release
sections, an npm-publish CI workflow gated on the full validation suite,
`README` install instructions that match reality, and an explicit
compatibility statement (Node ≥ X, Vite ≥ Y, Astro ≥ Z — test against
those in CI).

**Exit checks:** `npm pack` output of each public package installs and
works in the WS1 out-of-repo fixture; a dry-run publish succeeds in CI.

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
  codegen in `crates/flowmark-compiler` unit tests; escaping in
  `packages/runtime`; transform wiring in `packages/vite`/`astro`; event
  semantics in `packages/dom`; integration slicing in
  `packages/astro-events`; end-to-end only in `examples/`.
- Bug fix ⇒ regression test that fails before the fix, in the same commit.
- Prefer tests that **execute generated code** and assert on rendered
  output over tests that assert on generated source text (source-text
  snapshots break on harmless codegen changes).
- Diagnostics tests assert message, code, line, and column — not just
  "an error occurred".

## 10. Validation commands

| Scope                 | Command                                                 |
| --------------------- | ------------------------------------------------------- |
| Rust: format          | `cargo fmt --all -- --check`                            |
| Rust: lint            | `cargo clippy --workspace --all-targets -- -D warnings` |
| Rust: tests           | `cargo test --workspace`                                |
| JS: all package tests | `pnpm -r --if-present test`                             |
| JS: types             | `pnpm run typecheck`                                    |
| Runtime only          | `pnpm --filter @flowview/runtime test`                  |
| Vite plugin           | `pnpm --filter @flowview/vite test`                     |
| Astro integration     | `pnpm --filter @flowview/astro test`                    |
| Events core           | `pnpm --filter @flowview/dom test`                      |
| Events Astro          | `pnpm --filter @flowview/astro-events test`             |
| Demo gate             | `pnpm --filter @flowview/astro-demo run check`          |

**Full gate (run before declaring any task done):**

```sh
cargo fmt --all -- --check \
  && cargo clippy --workspace --all-targets -- -D warnings \
  && cargo test --workspace \
  && pnpm -r --if-present test \
  && pnpm run typecheck
```

## 11. Definition of done

A change is done when all of these hold:

1. The full gate (§10) passes locally.
2. New behavior has tests at the lowest useful layer; fixed bugs have
   regression tests.
3. No invariant (§4) is violated; no non-goal (§5) crept in.
4. `CHANGELOG.md` has a one-line entry under `Unreleased`.
5. User-visible behavior changes are reflected in `README.md` and
   `docs/flowmark-spec.md`, and spec/README/code agree with each other.
6. Diagnostics affected by the change still report correct locations for
   both standalone `.flow` and Astro-embedded templates.
7. No new dependencies, no expanded public API, unless the active
   workstream (§8) explicitly required them and the decision is recorded.
