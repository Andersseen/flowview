# FlowView 1.0 Roadmap

## Purpose and authority

FlowView 1.0 means predictable template authoring and deployment on two
first-class tracks: Browser/JavaScript and Static/Rust. Compiler correctness is
necessary; usable diagnostics, explicit DOM ownership, installable artifacts,
compatibility evidence and understandable limitations are also required. Neither
the number of pre-1.0 minors nor package existence proves readiness.

This is the approved **scope of future work**, effective when this roadmap is
merged. It does not describe shipped features. [The spec](flowview-spec.md)
remains normative for existing behavior; [SDD](spec-driven-development.md)
defines the work protocol; [the RC contract](rc-contract.md) controls freeze and
release. All candidate syntax/APIs below are **non-normative, subject to milestone
design**. Only a shipping implementation PR updates normative requirements and
the executable conformance mapping. This documentation change implements nothing.

**Current phase:** controlled pre-1.0 evolution. **M1, M2 and M3 — complete;
M4 — active; S — queued.** M3 exit evidence is PR [#45](https://github.com/Andersseen/flowview/pull/45), merged before this baseline. M1's maintainer-reviewed exit evidence is PR [#41](https://github.com/Andersseen/flowview/pull/41): compiler-backed `.flow` and
Astro diagnostics, Events diagnostic ownership, UTF-8 → UTF-16 mapping, packaged
VSIX acceptance without Rust, 105/105 spec coverage, packed artifacts, full CI,
bounded fuzz and browser acceptance. Its package release followed in PR
[#42](https://github.com/Andersseen/flowview/pull/42). M2's reviewed exit evidence
is PR [#43](https://github.com/Andersseen/flowview/pull/43): scoped DOM references,
exclusive view ownership, nested disposal, the structural reactive bridge,
Events replacement compatibility, browser acceptance, packed artifacts, full CI,
bounded fuzz and 117/117 spec coverage. Its package release PR
[#44](https://github.com/Andersseen/flowview/pull/44) is merged. M3's exit evidence is PR
[#45](https://github.com/Andersseen/flowview/pull/45): the Chromium native form
matrix, explicit replacement and `view.bind()` behavior, Events toggle capture,
126/126 spec coverage, packed consumers and green required Actions. M3 package
release PR [#46](https://github.com/Andersseen/flowview/pull/46) is merged. An agent may implement only
the active milestone, after its design questions have a reviewed answer. Fixes to
existing contracts remain permitted. Advancing the active marker requires a
maintainer-reviewed PR linking the preceding milestone's exit evidence. A roadmap
amendment is required to add an outcome, waive an exit criterion or activate work
out of order; an implementation PR cannot quietly broaden its own scope. RC freeze
overrides this permission entirely.

## Current baseline and evidence

Inspected remote `main`: `d61eedce687ae26ae04bf5d10d6a912f89726f9b`, 2026-10-22.
Recent relevant merges: roadmap/RC contract [#40](https://github.com/Andersseen/flowview/pull/40),
M1 editor experience [#41](https://github.com/Andersseen/flowview/pull/41),
M1 package release [#42](https://github.com/Andersseen/flowview/pull/42),
M2 browser composition [#43](https://github.com/Andersseen/flowview/pull/43),
M2 package release [#44](https://github.com/Andersseen/flowview/pull/44),
M3 forms and DOM replacement semantics [#45](https://github.com/Andersseen/flowview/pull/45),
and M3 package release [#46](https://github.com/Andersseen/flowview/pull/46).
Current GitHub API status for open PRs and Actions could not be retrieved during
this inspection.

“Hardened” below means implementation plus focused tests/gates, not proof of no
bugs. Package manifests have independent npm versions; Rust crates are 0.2.0 with
MSRV 1.91 and Oxc 0.116. Do not derive milestone numbers from the root package.

| Surface                                     | Current maturity                                                    | Repository evidence and remaining limit                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML compiler / JS target                   | Hardened                                                            | `crates/flowview-compiler/src/{parser,codegen,javascript.rs}`; one template AST, Oxc validation, `render(context): string`; not a browser HTML parser                                                            |
| Native Rust static target                   | Hardened; distribution ergonomics incomplete                        | `src/static_html/{mod,evaluator}.rs`, `tests/static_embedding.rs`; compile once/render many, `Send + Sync`, JSON-shaped contexts, no Node; compiler/Oxc still linked                                             |
| Escaping / raw / control flow               | Hardened                                                            | Shared `tests/fixtures/*parity.json`; `@if`, `@for`, `@switch`, explicit trusted raw strings; no sanitization; `track` has no reconciliation effect                                                              |
| Bindings                                    | Implemented and tested; forms ergonomics incomplete                 | Boolean attributes including `checked`, `selected`, `open`; `attr.*`, `class.*`; no general live-property binding                                                                                                |
| Diagnostics / source maps                   | Hardened                                                            | Structured `FVxxxx`, UTF-8 spans, JS Source Map v3 and host Astro offsets; static rendering has diagnostics, no JS map                                                                                           |
| Conformance / fuzzing                       | Hardened, ongoing                                                   | 126/126 requirements after M3; `scripts/spec-coverage.mjs`, proptests, Events fast-check, `fuzz/`, PR/main smoke and scheduled fuzz workflow                                                                     |
| Runtime / compiler npm                      | Hardened                                                            | Four escaping/value helpers; bundled WASM compiler, native override; packed consumers do not need Rust                                                                                                           |
| Vite / Astro                                | Hardened                                                            | `.flow` transform and inline Astro regions; dev/build/map tests; compatibility matrices; no application lifecycle                                                                                                |
| Events / Vite Events / Astro Events         | Implemented and hardened                                            | Separate compiler and delegated runtime, virtual client modules, inline Astro wiring; explicit client registration required                                                                                      |
| DOM                                         | Implemented; native form contract complete in M3                    | `packages/dom/src/index.ts`: string rendering and explicit `innerHTML` replacement; scoped refs expose live native controls; no property binding or reconciliation                                               |
| Reactive                                    | Implemented, optional                                               | `signal`, `computed`, `effect`, `untracked`; synchronous effects with cleanup/stop; no compiler/DOM dependency                                                                                                   |
| Prettier                                    | Hardened for its narrow contract                                    | Wraps Astro formatter; preserves FlowView regions byte-for-byte, including Unicode; not a `.flow` formatter                                                                                                      |
| VS Code                                     | Implemented basic support; incomplete DX                            | Grammar, Astro injection, snippets and VSIX packaging; no compiler-backed diagnostics                                                                                                                            |
| Website / browser acceptance                | Implemented and gated                                               | `examples/astro-demo` is website and acceptance app; dev plus production-preview capabilities; Hono E2E separately; unexpected browser errors fail                                                               |
| npm release engineering                     | Hardened                                                            | Build/pack once, tarball inspection, three-OS consumers, peer/Node matrices, publish dry-runs and content identity checks                                                                                        |
| Rust/crates.io distribution                 | Prepared and tested in repository; registry use reported downstream | Rust release workflow, package inspection, MSRV/portability and registry smoke script; a green main CI run alone does not prove registry publication                                                             |
| Compatibility                               | Explicit and gated                                                  | `scripts/compatibility.json`: Node ≥22.12, Vite 6–8, Astro 5–7, Prettier 3; Astro 7 runs on Node 24 for its current engine floor; exact Rust 1.91 job; published npm manifests do not enforce Node via `engines` |
| AOT, fragments, safe static optional access | Not implemented                                                     | No precompiled static consumption path; static lowerer explicitly rejects optional chains; no fragments/recursion                                                                                                |

Code inspection also corrects old planning claims: SDD's missing-conformance
blocker was stale; its blanket reactivity ban contradicted the optional reactive
package; its hardening-only freeze and WS7 queue no longer describe this phase.
The historical Rust readiness/embedding documents describe publication as
prepared and fragments as deferred under the old freeze. Preserve those as
historical evidence; this roadmap is the current scheduling authority. The spec's
editor “future support” list is not authorization to implement those features.
`docs/compatibility.md` still summarizes native Rust as “stable”; manifests and
`rust-msrv.yml` establish the more precise 1.91 floor. `RELEASE.md` still calls
npm primary and Rust optional; that describes existing release machinery, not
track priority under this roadmap. S must reconcile those release/support docs
before RC. Most npm packages have no package-local README at baseline; the root
README is their current usage guide, so S must audit packed consumer documentation
rather than assume each package already ships a guide.

Source-map coverage is also narrower than “all transforms”: standalone Vite Events
currently returns `map: null` for its rewrite. M2/M3 acceptance must check original
locations through the complete Events → template compiler chain and either fix
any observed attribution defect or document the supported boundary before RC.

### Downstream evidence: Entwine

[Recorded Rust adoption evidence](rust-consumer-readiness.md) establishes
compile-once/render-many use, semantic page parity, escaping, Unicode,
Linux/macOS/Windows, browser/accessibility/no-JS checks and roughly 19 µs/page in
one consumer. The task's follow-up evidence reports successful crates.io use and
typed `Serialize` contexts. That follow-up is maintainer-supplied evidence, not an
independently reproduced benchmark or registry check in this documentation task.
The RC ledger must attach reproducible consumer revisions/results.

The generic remaining cost is linking compilation machinery into tools whose
templates are known ahead of time. Tree reuse and nullable data are also generic
pain points, but do not automatically justify new language. No Entwine navigation
types, page models, routes, configuration or APIs belong here. Every proposed
capability must make sense for email/report renderers, CLIs, servers or other
template consumers without Entwine.

## Product identity and track decisions

FlowView is a template compiler, a separate Events compiler, integrations, small
optional DOM/reactive utilities, editor tooling and native/static rendering.
Both tracks share language, parsing, diagnostics and the documented parity
subset. AOT must reuse that compiler; browser needs must not impose a Rust
runtime, and static needs must not dictate browser architecture.

### Browser/JavaScript

Keep string rendering and DOM replacement for v1. Delegated Events survives
replacement; node identity, focus, selection, composition, uncontrolled state and
third-party listeners do not automatically survive. `track` is not a key for a
diff algorithm. Scoped access and explicit cleanup can improve this architecture
without a reconciler. Applications own state and choose when to replace a view.

Events is sufficient in scope for v1: the parser accepts event names and the
runtime delegates click, input, change, submit and keyboard events using the same
path; focus/blur use capture, focusin/focusout bubble. Arguments already include
`$event`, `$el`, JSON literals and template property paths. This is source-level
support, not a claim that every event has browser acceptance today. Freeze the
existing handler-call model; M3 must prove the full forms/event matrix. M2 may
add scoped reference resolution only if its design needs it. No event modifiers,
implicit preventDefault, arbitrary handler expressions or new state model.

### Static/Rust

**Precompiled Static Templates (AOT) is required before v1 (M4).** It solves a
measured deployment cost without syntax or framework ownership. Preserve Oxc;
move compilation out of the consumer, do not invent a second expression parser.
Runtime source compilation remains available for callers that actually need it.

`render_serializable` is sufficient for v1. It still materializes
`serde_json::Value`; a zero-copy evaluator adds a new value abstraction without a
measured need. Existing performance is sufficient on reported workloads, not a
universal latency guarantee. No separate performance milestone. Preserve
whitespace: recorded gzip/Brotli differences of about 3–8% do not justify changing
observable text. No minifier, output-style toggle or whitespace collapse for v1.

**Safe static optional access is deferred beyond v1.** Oxc and JS output already
support JavaScript optional chaining, but the static evaluator rejects it with
`FV0016`; `??` already works. Explicit guards and host-derived values are adequate
for v1. Extending the subset while splitting distribution would enlarge M4's
parity burden without solving its binary cost. This is not a parser limitation.
A future proposal must resolve chain short-circuit boundaries, parentheses,
missing/null/undefined values, literal indexed access, diagnostics/maps and shared
fixtures. No arbitrary calls, dynamic keys, mutation or assignments follow from
such a proposal.

**Local fragments/recursion are deferred beyond v1, not dismissed as components.**
Trees are a valid generic use case, but the current AST/render contract has no
local call/scope/recursion contract. Four higher-priority milestones already
address adoption on both tracks. Hosts can render trusted fragments today. A
future design gate must prove local-only definitions, explicit parameters/scope
and interaction with `context`/loop variables, bounded recursion and cycle/stack
failure diagnostics, escaping/raw rules, source mapping, JS/static output parity,
formatter and editor behavior. A small model can be reconsidered after v1; imports,
slots, state, lifecycle, hydration or package resolution fail that gate. This is
not approval for a component model or an automatic v2 commitment.

## Milestone sequence and dependencies

Four bounded implementation milestones, one stabilization milestone, then RC.
Labels are planning identifiers, not version bumps. Each ships an appropriately
scoped pre-1.0 minor on affected package lines; unchanged packages need not move.
Rust and npm numbering remain independent. No release is created by this plan.

| Milestone                          | Status       | Goal / track                                                           | Ownership                                                                      | Potential contract impact                                              | Dependency / exit                                                                                                                                    |
| ---------------------------------- | ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Editor experience               | Complete     | Located diagnostics and trustworthy highlighting / shared tooling      | VS Code, compiler transport, Astro region discovery                            | Editor behavior only; reuse compiler APIs where possible               | [PR #41 exit evidence](https://github.com/Andersseen/flowview/pull/41); release [#42](https://github.com/Andersseen/flowview/pull/42)                |
| M2 Browser composition             | Complete     | Scoped references plus explicit reactive bridge / Browser/JS           | DOM, reactive, Events/integrations; compiler only if reference syntax needs it | Additive DOM/bridge APIs; no new template syntax                       | [PR #43 exit evidence](https://github.com/Andersseen/flowview/pull/43); isolation, replacement and disposal evidence; 117/117 spec coverage          |
| M3 Forms and replacement semantics | Complete     | Predictable bounded form usage / Browser/JS with shared HTML semantics | DOM, Events/integrations, examples; compiler bindings only if justified        | Explicit supported form contract; no generic property-binding language | [PR #45 exit evidence](https://github.com/Andersseen/flowview/pull/45); real-browser native-control matrix; 126/126 coverage; required Actions green |
| M4 Precompiled Static Templates    | Active       | Compiler-free final static consumer / Static/Rust                      | Compiler static backend, CLI, possible runtime crate, Cargo/release tooling    | AOT production/consumption API and compatibility envelope              | M3 complete; measured parity and packaging                                                                                                           |
| S Stabilization and freeze         | Queued       | Close all contracts and release evidence / both tracks                 | All public surfaces, docs, release workflows                                   | No new outcomes; finalize support inventory                            | M1–M4; all RC entry gates                                                                                                                            |
| RC → 1.0                           | Blocked on S | Validate frozen artifacts / both tracks                                | Release owners and consumers                                                   | Fixes only under RC rules                                              | [RC contract](rc-contract.md)                                                                                                                        |

```text
Baseline ── M1 ── M2 ── M3 ───────┐
    └────────────── M4 ────────────┼── S ── rc.1 ── evidence ── 1.0
                    ↑             │
          final M2/M3 shared semantics
```

M1 makes later syntax/API mistakes visible while authoring. References and bridge
share replacement/disposal concerns, so combine them in M2 with references
resolved first; the bridge does not intrinsically require references. M3 depends
on the resulting scoped DOM contract. AOT has no intrinsic browser dependency,
but shipping it last avoids freezing artifacts before any shared binding changes.
There is no authorization for parallel milestone implementation from this graph.

## Execution contract for every implementation milestone

Before implementation, put the design answers in the milestone PR: chosen public
behavior, rejected alternatives, affected exports/spec requirements, compatibility
risks, tests and an acceptance example. Maintainer review resolves those questions
within the approved outcome; unresolved questions block implementation, not invite
scope invention. A new package or dependency needs a recorded necessity and
release/consumer coverage. Candidate examples (`#search`, `view.ref(...)`,
`view.bind(...)`, `[value]`) are illustrative and **not approved API spellings**.

For every M1–M4 release: run the repository verification gate plus relevant
integration/browser/consumer suites; preserve 100% spec mapping and execute the
mapped tests. Shipping behavior updates the spec, package usage docs, compatibility
and migration notes in the same PR. npm-visible changes require Changesets; Rust
changes follow `RELEASE.md`. Record exact commands, commit, artifact versions and
results before merge. A pre-1.0 breaking change requires explicit migration notes,
not the assumption that pre-1.0 makes it harmless. Each exit requires reviewed
evidence, not just test files. The following contracts add milestone-specific
requirements to these common obligations.

### M1 — Editor experience

**Objective/problem/why now:** eliminate terminal-only feedback for syntax errors
in `.flow` and inline Astro; basic highlighting alone does not make authoring
predictable. Shared tooling track; no language expansion.

**Current → end-state:** grammar/snippets → compiler-backed diagnostics on open and
save, cleared after correction/close, with correct filename/range/code/severity
for standalone files and multiple inline regions. Use the existing compiler,
never a second validator. VS Code support is the required editor deliverable;
a complete general-purpose LSP is not.

**Ownership:** `packages/vscode-flowview`, compiler diagnostic transport,
`packages/astro` region/offset logic; `packages/prettier` only for preservation
regressions. Keep compiler usable without Node.

**Resolve first:** bundled WASM versus CLI transport and version matching;
installation without Rust; workspace trust and configured executable policy;
UTF-8 bytes versus editor UTF-16; region discovery reuse; unsaved buffer/version
races; cancellation and stale error removal; malformed wrappers; Events diagnostic
ownership without double-transforming source. Document the chosen trigger model;
on-type diagnostics are not required.

**In scope:** compiler errors/warnings; TextMate scopes for control keywords,
`of`/`track`, `context`, escaped/raw interpolation, boolean/attr/class bindings,
Events and embedded argument expressions. Preserve Astro highlighting outside
regions and existing snippets.

**Out of scope/invariants:** completion, rename, go-to-definition, new formatter,
full LSP suite, evaluating template code, type inference or new expression syntax.

**Impact/risk:** editor contract and packaging; no required core API expansion.
Offsets, embedded-language interference and compiler version skew are primary
risks. Any transport API addition must be justified in design review.

**Tests/evidence:** lowest-layer range conversion, malformed regions, Unicode and
stale-result tests; grammar fixtures; extension-host tests on installed VSIX with
`.flow` and multiple Astro regions; corrected files lose errors. Smoke installation
on supported OSes without Rust. Verify editor diagnostic codes/locations against
CLI/compiler fixtures and ensure Prettier preserves those fixtures.

**Docs/release:** extension README/install instructions, support limits, spec/editor
requirements and conformance mapping; extension pre-release/minor and only affected
npm packages. **Exit:** reproducible packaged editor transcript/test results cover
all preceding cases. **Next may assume:** later shipped syntax gets diagnostics,
grammar and formatter regression coverage in its own milestone.

### M2 — Browser composition

**Objective/problem/why now:** ordinary access to FlowView-owned nodes should not
require global selectors; effect-to-view wiring should have an explicit cleanup
path. Browser track. Combining these bounded utilities prevents two incompatible
ownership models before APIs stabilize.

**Current → end-state:** `createView` returns `render/update`; callers manually run
`effect(() => view.update(...))`. Deliver scoped node access and one explicit,
optional reactive-to-view composition mechanism with a documented stop/dispose
contract. Manual updates remain supported.

**Ownership:** `packages/dom`, `packages/reactive`, Events plus Vite/Astro Events;
compiler AST/parser/codegen/static backend and tooling only if declarative refs are
selected. Prefer solving scope without changing the generated module export shape.

**Resolve first:** authoring marker versus programmatic lookup; view-root boundaries
including nested views; duplicate names; references in loops (collection/key/error,
never an accidental last match); conditional absence; stale handles after update;
handler visibility and collisions with context/loop variables; typing and missing
reference result; standalone/Astro behavior; inert SSR/static representation and
escaping; source maps and diagnostics. Resolve references before bridge API.
For the bridge choose package ownership/dependency direction, initial render,
synchronous update timing, error propagation, repeated binding, reentrancy, cleanup
order and stop/dispose idempotence. Reuse existing effect cleanup; no hidden global
scheduler or implicit lifecycle.

**In scope:** scoped access in two instances of one template, explicit replacement
invalidation, optional bridge and lifecycle documentation. Any marker must work
through one parser/AST and have explicit string/static meaning.

**Out of scope/invariants:** components, automatic signal reads in compiler output,
zones, hydration, DOM identity preservation, inferred state, framework ownership.
DOM remains optional; reactive remains independently usable; app owns state.

**Impact/risk:** possible additive syntax/API, plus event argument resolution;
reference leakage, detached nodes and duplicate subscriptions are release blockers.
No promise of generated TypeScript template types without a separate approval.

**Tests/evidence:** unit tests at the owning layer for scope, duplicate/loop/branch
behavior, replacement, stop and errors; compiler/shared parity and map tests if
syntax changes. Browser tests in Astro and standalone Vite/Hono for two instances,
conditional/loop replacement, events using current nodes, repeated mount/dispose
and no updates after stop. Prove no required reactive dependency for manual DOM
consumers and no DOM dependency for reactive-only consumers.

**Docs/release:** DOM/reactive usage, Events reference rules, examples and any new
spec/conformance requirements; affected npm minors and Rust minor only if compiler
contracts change. **Exit:** scoped-access example needs no global query for owned
nodes; cleanup and replacement behaviors pass the complete matrix. **Next may
assume:** explicit node-lifetime and bridge ownership contracts, not preserved nodes.

### M3 — Forms and DOM replacement semantics

**Objective/problem/why now:** make initial HTML attributes versus live form
properties predictable before promising a pleasant browser v1. This is bounded
forms support, not a general property-binding language.

**Current → end-state:** boolean bindings serialize attributes and `update`
replaces nodes. Document and demonstrate working text input, checkbox, select and
`details` flows, including user edits and subsequent explicit renders. Preserve
replacement as the default and expose its limits honestly.

**Ownership:** DOM and Events first, Astro/Hono browser examples; compiler binding
lowering/static parity, editor/Prettier only if a narrow new binding is justified.

**Resolve first:** a behavior table for `value`, `checked`, `selected`, `open` in
static HTML, JS string output, initial browser parse, dirty live controls and later
replacement. Include boolean removal, textarea/select differences, reset/default
values, focus/selection, IME composition and uncontrolled fields. Decide whether
existing attributes plus explicit scoped property writes suffice or whether a
small enumerated DOM helper is necessary. `[checked]` already exists as an
attribute binding: do not relabel it as a new live-property contract. `[value]`
is only a non-normative candidate. No general arbitrary property assignment.

**In scope:** one documented supported pattern per control; Events matrix for
click/input/change/submit/keyboard/focus/blur, `$event`/`$el`, literals/property
paths and replacement delegation. Explicit user-controlled update boundaries.
If convenience requires retaining nodes or a reconciler, defer that convenience
and demonstrate the explicit-update pattern; changing the approved outcome needs
a roadmap amendment.

**Out of scope/invariants:** two-way binding, validation framework, form ownership,
VDOM/diffing, automatic caret/IME restoration and automatic preservation of
uncontrolled state. Event handlers call native preventDefault explicitly.

**Impact/risk:** possible bounded DOM API; syntax only with approved semantics for
both string targets. Existing generated HTML and boolean semantics cannot drift
silently. Property writes must not create new raw-HTML/security bypasses.

**Tests/evidence:** lowest-layer attribute/property and event dispatch tests;
shared JS/static output fixtures if serialization changes; real browser tests
cover typing, check/uncheck, selection, reset, submit prevention, keyboard and
focus before/after replacement. Include a composition scenario showing the
supported update boundary without losing input; cover dev and production preview.
No promise of every browser/platform from Chromium-only evidence.

**Docs/release:** form recipes, replacement limitations, capability page, Events
support matrix, any spec/API migration; affected npm minor and Rust minor only if
shared compiler behavior changes. **Exit:** all supported patterns work with no
unexpected browser errors; unsupported continuity behavior is explicit and no
reconciler was needed. **Next may assume:** final shared binding semantics for AOT.

### M4 — Precompiled Static Templates (AOT)

**Objective/problem/why now:** known-ahead-of-time templates should render repeatedly
without linking the full compiler/Oxc stack. This is a first-class Static/Rust
adoption issue, not an Entwine optimization or a new language.

**Current → end-state:** `compile_static` lowers Oxc AST into owned internal
expressions/nodes; the same crate renders them. Add a supported production path
from trusted `.flow` at codegen/build time to a compiler-free final application,
while preserving runtime compilation APIs.

**Ownership:** compiler static lowering/evaluation and diagnostics, CLI, possible
small static-runtime crate, Cargo manifests/package fixtures and Rust release
scripts. Do not split the language parser. No Node in native consumption.

**Design gate before implementation:** compare at least generated Rust (included
source) and serialized IR using representative small and multi-template consumers.
Consider CLI codegen, `build.rs` and proc macro delivery separately from artifact
format; choose one primary path, not a suite of new tools. Generated Rust is a
candidate, not a decision. A proc macro is not automatically compiler-free during
build. Record why a new runtime crate is or is not necessary and which APIs stay
in the compiler. Avoid making internal expression enums a permanent public format.

Resolve all of these in the reviewed design:

- Artifact contents, compiler/runtime compatibility identifiers and supported
  version pairings. Either version and validate the format or require regeneration
  with a documented compatibility check; stale/unsupported artifacts must fail
  clearly, never render silently with changed meaning.
- Deterministic output, source/options/version fingerprints, stale-output detection,
  reproducible codegen, portability and path-independent output.
- Original `.flow` filenames/spans for compile-time and runtime diagnostics;
  generated Rust errors versus source attribution; no promise of JS maps for static
  rendering. Decide what source metadata is shipped and its size/privacy cost.
- Trust model: trusted templates and generated source; no untrusted-code sandbox.
  If bytes are loaded, validate structure/version/limits and reject malformed data
  without panic or unbounded allocation. Rust compiler rejection alone is not an
  answer for a serialized artifact.
- Cargo packaging of generated files/source templates, offline/reproducible builds,
  include paths, CLI regeneration and release order for a runtime crate.
- Compiler MSRV versus runtime-only consumer MSRV. Moving the compiler to
  `[build-dependencies]` can remove it from the final binary but still requires
  Rust 1.91 to build. Only separately generated artifacts plus an independently
  tested runtime may permit a lower floor; do not promise one before measurement.

**In scope/invariants:** same parser/validation, same static subset, same escaping,
whitespace, diagnostics and context behavior; compile once/render many; retain
`render_serializable` allocation semantics. No Oxc removal from the compiler.

**Out of scope:** optional chaining, fragments, custom parser, zero-copy evaluator,
new expression semantics, arbitrary artifact execution, minification, prescribed
binary-size or render-speed target.

**Impact/risk:** public AOT production/consumption APIs and possibly crate; artifact
compatibility is a new release obligation. Keep raw representation internal if
possible, but never use “internal” to excuse silently accepting stale output.

**Tests/evidence:** shared fixtures through runtime-compiled static, AOT and JS
within the common subset; unsupported expressions still fail at compilation;
Unicode/missing/raw failures retain source locations. Determinism, version mismatch,
stale output and malformed input tests appropriate to the chosen format. Clean
packaged consumers on Linux/macOS/Windows, concurrent repeated rendering, actual
runtime-only dependency graph with no Oxc/compiler; cargo package/install/dry-run
and registry smoke where available.

Measure before/after on the same target/profile/toolchain and contexts: stripped
binary size, normal/build dependency graphs, compiler and runtime-only MSRVs,
clean/incremental compile cost, compile/render time, artifact size, output parity
and diagnostic quality. Report totals and deltas, including code size growth with
many templates; do not call the entire binary “Oxc size.”

**Docs/release:** embedding guide, AOT regeneration/compatibility/migration guide,
crate READMEs, release order and support matrix; Rust minor/new crate as justified,
no npm bump unless npm behavior changes. **Exit:** a packaged consumer renders
without compiler/Oxc in its final dependency/link path, parity passes and measured
tradeoffs are accepted. If that cannot be achieved, M4 is blocked; removing AOT
from v1 requires a roadmap amendment. **Next may assume:** a measured, supported
AOT path, not a settled lower MSRV or eternal IR ABI.

### S — Stabilization and feature freeze

**Objective/problem/why now:** convert completed milestone outcomes into a release
contract with no unsettled product questions. Both tracks; all public packages,
crates, docs, website, editor and workflows are owned surfaces.

**Current → end-state:** evolving pre-1.0 APIs → audited export/entry-point inventory,
final support policy, migration docs and reproducible consumer evidence. Resolve
any remaining version pairings, support floors and artifact compatibility before
entry to RC. No new features, packages or syntax during S; a missing outcome goes
back through roadmap review rather than becoming stabilization scope.

**Tests/evidence:** run the full repository gate, all browser/preview, portability,
MSRV, packed compatibility, fuzz and Rust/AOT consumer checks listed in the RC
contract. Inventory exports, CLI flags, diagnostic codes and artifact contracts
against docs. Review security boundaries and actual downstream evidence.

**Docs/release/exit:** publish the evidence ledger, final compatibility and migration
notes, accurate website/editor instructions and changelogs. Release owners choose
prerelease versions without coupling independent package lines accidentally.
S makes no new API promises; its exit is every RC entry checkbox satisfied on the
candidate commit. RC may assume no unresolved design questions. Later features
wait beyond v1.

## What 1.0 stabilizes

S must turn this checklist into an explicit inventory of shipped names and
signatures. Publicly exported items cannot be called internal after release
without the appropriate compatibility change.

| Contract                                                                       | 1.0 classification                                             | Boundary                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Template syntax, shared semantics and static expression subset                 | Stable for 1.x                                                 | Exactly the shipped normative spec; no implied full JS evaluator in Rust                                           |
| Compiler Rust API, CLI and npm compiler API                                    | Stable for 1.x                                                 | Documented public exports/options/results/errors; WASM glue internals are internal                                 |
| JS generated-module contract                                                   | Stable for 1.x                                                 | `render(context): string`, supported runtime pairing and map behavior; emitted variable names/text are internal    |
| Diagnostics                                                                    | Stable for 1.x                                                 | Structure, code meaning, coordinate convention; improved prose/precision is allowed                                |
| Static render API and typed convenience                                        | Stable for 1.x                                                 | No Node, deterministic repeated rendering and documented errors; no zero-copy promise                              |
| AOT production/consumption API                                                 | Stable for 1.x                                                 | Regeneration and compiler/runtime version rules required; representation internal or explicitly versioned per M4   |
| Runtime helpers and types                                                      | Stable for 1.x                                                 | Public exports and escaping/raw contracts; no sanitizer                                                            |
| Events syntax/runtime and both integrations                                    | Stable for 1.x                                                 | Handler calls, scope, registration, event/argument rules and supported delegation                                  |
| Vite/Astro                                                                     | Stable for 1.x                                                 | Documented options, entry points and supported peer matrix, not plugin implementation details                      |
| DOM / reactive / bridge                                                        | Stable for 1.x                                                 | Explicit state, replacement, reference lifetime, update and stop semantics; not node identity                      |
| Prettier                                                                       | Stable for 1.x                                                 | Preservation inside FlowView regions and supported Prettier compatibility; surrounding formatting follows upstream |
| VS Code                                                                        | Stable supported behavior; highlighting appearance best-effort | Diagnostics, ranges, snippets, installation; theme rendering is not a stable visual ABI                            |
| npm package names/exports/types and public Rust crates                         | Stable for 1.x                                                 | Audit manifests and packed artifacts; no private-source deep imports                                               |
| Security and compatibility policies                                            | Stable for 1.x                                                 | Trusted templates, explicit raw trust, contextual escaping limits and declared floors                              |
| Compiler AST/lowering internals, generated identifiers, hashes, website layout | Internal/best-effort                                           | Unless actually public in the final audited API; do not freeze unnecessary details                                 |
| Fragments, safe static optional access, reconciler, zero-copy evaluator        | Not part of v1                                                 | No experimental feature may silently become required to pass v1 acceptance                                         |

No required v1 surface is left “experimental.” Optional experiments, if ever
approved separately, must be clearly isolated and excluded from these guarantees.

### SemVer after 1.0

- **Patch:** restore documented behavior, fix diagnostics/escaping/security bugs,
  improve message prose or performance without changing contracts, repair packaging.
  A bug fix that breaks relied-on behavior still needs impact/migration review.
- **Minor:** backward-compatible syntax or exports, new opt-in capability, new
  supported peer version without dropping existing support, deprecation without
  removal. Generated code may change while behavior and runtime compatibility hold.
- **Major:** remove/change syntax or expression meaning, break JS/TS or Rust public
  API/CLI/entry points, repurpose diagnostic codes, change documented generated HTML
  semantics, drop peer support, raise Node floor or Rust MSRV. Pre-1.0 MSRV policy
  was minor; 1.x intentionally adopts the stronger major-version floor guarantee.

AOT representation revisions may be internal only if documented compatibility
checking/regeneration and stable consumption APIs remain intact. Breaking the
promised artifact acceptance window or runtime API requires a major. At S record
the exact pairing/window; do not promise every compiler can consume every artifact.
Public diagnostic codes are not reused. Exact generated source bytes are not
stable across versions, though identical input/options on one version remain
deterministic. Security emergencies require an explicit advisory and compatibility
decision, not an unannounced policy exception.

## Explicit post-v1 boundary

Post-v1 is a discussion boundary, not a commitment to ship a framework in v2.
Local fragments and optional static access need the bounded gates above. Zero-copy
Rust evaluation needs demonstrated allocation pressure; whitespace/output-style
changes need semantic evidence. Neither is needed for present consumer performance.

Full components/lifecycle/state, slots with framework semantics, template module
resolution, routing/SSG/Markdown/CMS ownership, dependency injection, compiler-level
signal tracking, two-way binding, VDOM/full reconciliation, hydration, server
components and Suspense-style transport are outside the v1 identity because they
make FlowView own application structure, state or execution. A custom JS parser
risks dialect divergence; a JS engine or large template runtime defeats the native
static subset. Difficulty alone is not the reason for these exclusions.

## Freeze and graduation

Features stop at S entry; `1.0.0-rc.1` adds the strict public contract freeze.
The [RC contract](rc-contract.md) defines entry, allowed fixes, blocker severity,
artifact evidence and graduation. Version count and elapsed dogfood time cannot
replace those gates.
