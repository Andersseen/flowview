# Public API and compatibility contract

This is the maintained map of the shipped consumer surface. It is derived from
crate roots, package `exports` maps, package entry declarations, CLI argument
definitions, and the release compatibility workflows. It describes the current
pre-1.0 contract; it does not freeze APIs or replace the language spec.

## Rust

| Artifact                  | Consumer surface                                                                                                                                                                                                                                                                 | Distribution and support                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `flowview-compiler`       | `compile`, `parse_ast`, `compile_static`, `render_static`, `compile_static_artifact`; `CompileOptions`, `CompileOutput`, `CompiledStaticTemplate`, `StaticCompileOptions`, `StaticRenderOptions`, `StaticRenderOutput`, `StaticArtifactOutput`; diagnostics and `CursorPosition` | crates.io; Rust 1.91; compiler and Oxc are linked.                                                   |
| `flowview-static-runtime` | `Template::{from_bytes, render, render_serializable}`, `Diagnostic`, `ARTIFACT_MAGIC`, `FORMAT_VERSION`, `MAX_ARTIFACT_BYTES`; malformed/oversized/unsupported artifacts return `ArtifactError`                                                                                  | crates.io; Rust 1.85; no parser, compiler, Oxc, or Node dependency.                                  |
| `flowview-cli`            | `flowview compile` and `flowview precompile`; command options are listed below                                                                                                                                                                                                   | crates.io binary named `flowview`; depends on compiler.                                              |
| `flowview-wasm`           | No crates.io API; internal WASM wrapper used to build `@flowview/compiler`                                                                                                                                                                                                       | `publish = false`; the generated Node WASM bindings and `.wasm` payload ship inside the npm tarball. |

The compiler root also publicly exposes `ast`, `parser`, `codegen`, `cursor`,
`diagnostics`, and `static_html`. `javascript` and `validation` remain private.
The AST types, parser entry, code-generation helpers, and static implementation
module are reachable today because they are declared `pub`.
Their visibility makes them Rust public API even though the crate-level
functions and re-exports are the intended embedding interface. This inventory
records that compatibility risk; these modules remain visible for the current
release line. Making them private requires a reviewed migration and release
decision, not a documentation-only interpretation.

The intended compiler flow is one parser and one AST with JavaScript and native
static backends. `compile` returns a `CompileOutput` with generated module text,
an optional source map, and warnings; `parse_ast` returns the current public AST.
Both return diagnostic vectors on failure. `compile_static` prepares a reusable
immutable `CompiledStaticTemplate` with `render(&serde_json::Value)` and
`filename()` methods; `render_static` is the one-off path and returns HTML plus
warnings. `compile_static_artifact` returns canonical versioned bytes for the
smaller runtime. Source spans are UTF-8 byte offsets;
diagnostics also carry 1-based line and column values. Rust diagnostics have a
message, severity, optional string code, line, column, and start/end offsets.
`DiagnosticCode::as_str()` maps the defined identities to `FV0001`–`FV0025`;
codes are identities and are not reused for different failures.

The CLI supports `compile <input>` with `--out`, `--target js|static-html`,
`--data`, `--runtime`, `--display-name`, `--line-offset`, `--source-map`,
`--source-map-name`, `--source-map-input-json`, `--source-map-column-offset`,
and `--diagnostic-format human|json`. `precompile <input> --out <path>` accepts
`--display-name`, `--check`, and `--diagnostic-format`. JSON diagnostics are a
machine-readable output option; command names and documented flags are CLI
contracts.

The AOT envelope has `FORMAT_VERSION = 1`; this format version is independent
of the compiler crate version. It records compiler metadata for inspection but
the runtime accepts artifacts by magic, format version, size, and schema, not
by exact compiler/runtime version equality. Regenerate artifacts with the
intended compiler when source or compiler semantics change. `flowview precompile
--check` compares bytes against canonical output from the selected compiler.
Determinism is promised for identical source, options, and compiler version;
generated JavaScript bytes are not promised stable across compiler versions.
See the [embedding guide](embedding-rust.md) for supported examples and
packaged-runtime evidence.

## npm packages

All packages are ESM. The published contract is each package's declared
`exports` map; private `src/` paths and undeclared deep imports are unsupported.
The compiler's wasm files are distribution assets, not extra JS entry points.

Choose packages by the work performed in the consumer:

| Consumer                                  | Install                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite template compilation                 | `npm install @flowview/vite @flowview/runtime`                                                                                               |
| Astro template compilation                | `npm install @flowview/astro @flowview/runtime`                                                                                              |
| Browser DOM views                         | `npm install @flowview/dom @flowview/runtime`                                                                                                |
| Optional signals/computed/effects         | `npm install @flowview/reactive`                                                                                                             |
| Events compilation and browser delegation | `npm install @flowview/events`; Vite/Astro builds also use the corresponding `@flowview/vite-events` or `@flowview/astro-events` integration |
| Prettier formatting for Astro             | `npm install -D @flowview/prettier prettier`                                                                                                 |
| Compile templates from Rust               | `cargo add flowview-compiler`                                                                                                                |
| Render precompiled artifacts in Rust      | `cargo add flowview-static-runtime`; generate artifacts with `flowview-cli` at build time                                                    |

Rust commands use the independent crates.io release line; npm package versions
are not synchronized with Rust crate versions. Use the [embedding guide](embedding-rust.md)
for runtime versus AOT build requirements.

| Package                  | Supported imports and main API                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@flowview/runtime`      | `.` — `escapeHtml`, `renderValue`, `renderRawValue`, `renderAttributeValue`, `RenderContext`, `RenderFunction`. Small renderer helpers; works in JS runtimes and browsers, without Rust.                                                         |
| `@flowview/compiler`     | `.` — `compileFlowview`, `FlowviewCompilerError`, and compiler option/result/source-map/diagnostic types. Node ESM package; bundled WASM means no Rust installation.                                                                             |
| `@flowview/dom`          | `.` — `createView`, `FlowviewView`, `FlowviewValueSource`, `RenderFunction`, `FlowviewTarget`. Requires a DOM when a view is created.                                                                                                            |
| `@flowview/reactive`     | `.` — `signal`, `computed`, `effect`, `untracked`, and their public types. Optional, independent of compiler and DOM.                                                                                                                            |
| `@flowview/events`       | `.` — Events compilation/parsing, edits, diagnostics, scope helpers and types; `./runtime` — `registerFlowHandlers`, `FlowEventHandlers`. Compiler utilities can run in Node; delegated runtime requires a browser document to attach listeners. |
| `@flowview/vite`         | `.` — default Vite plugin, `compileFlowview`, diagnostics and option types; `./client` — ambient `.flow` render declaration. Requires Vite 6, 7, or 8.                                                                                           |
| `@flowview/vite-events`  | `.` — default Vite Events plugin, `compileFlowviewEvents`, `FlowviewViteEventsError`, and request/result/options types. Requires Vite 6, 7, or 8 and `@flowview/events`.                                                                         |
| `@flowview/astro`        | `.` — default Astro integration and `FlowviewAstroOptions`. Requires Astro 5, 6, or 7.                                                                                                                                                           |
| `@flowview/astro-events` | `.` — default Astro Events integration, `analyzeAstroEvents`, and analysis/options types. Requires Astro 5, 6, or 7 and the Events Vite integration.                                                                                             |
| `@flowview/prettier`     | `.` — default Prettier plugin and `languages`, `options`, `defaultOptions`, `parsers`, `printers`. Requires Prettier 3; formats Astro while preserving FlowView template regions and does not format standalone `.flow` files.                   |
| `vscode-flowview`        | VS Code extension package; VS Code `^1.90.0`. It ships grammar/snippets/extension behavior, not a compiler API.                                                                                                                                  |

The browser DOM API returns a view with `render`/`update`, scoped `ref`/`refs`,
one optional `bind`, and idempotent `dispose`. Rendering deliberately replaces
the root's `innerHTML`; node identity, focus, selection, uncontrolled state and
third-party listeners are not preserved automatically. References are owned by
their view and do not cross nested view roots. Disposal releases the view's
active subscription and nested views. Native controls retain browser form
behavior; FlowView does not own application state. Reactive values are optional
and the DOM package accepts only the small `subscribe` source contract.

Events attaches delegated native DOM listeners for compiled event attributes
when a scope is registered. Registration is explicit; removing a scope makes
its handlers inert, while installed document listeners remain attached. It does
not supply implicit state, prevent-default rules, or application lifecycle.

## Version compatibility and post-1.0 policy

The current executable compatibility source is
[`scripts/compatibility.json`](../scripts/compatibility.json), checked against
peer ranges and compatibility jobs by `pnpm run check:compatibility`.
Node 22.12 is the tested FlowView tooling floor; consumers must also satisfy a
host tool's own engine floor. Vite 6–8, Astro 5–7, and Prettier 3 are the tested
integration ranges. `flowview-compiler` and CLI use Rust 1.91; the standalone
static runtime uses Rust 1.85. These support floors are tested, not inferred
from the current developer machine. npm packages are independently versioned;
they do not share a monorepo release number.

After 1.0, apply SemVer to consumer-visible contracts:

| Surface                  | Patch                                                                                           | Minor                                                           | Major                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Rust and TypeScript APIs | Compatible fixes and clarifications                                                             | Additive APIs/types                                             | Remove/rename APIs, tighten accepted inputs, or incompatible type/behavior changes      |
| CLI                      | Compatible bug fix                                                                              | Add an option or command                                        | Remove/rename a command/flag or change its meaning incompatibly                         |
| Template language        | Fix behavior contrary to the normative spec                                                     | Add syntax or semantics                                         | Remove syntax or incompatibly change specified meaning                                  |
| Diagnostics              | Correct text without changing code/location contract                                            | Add a diagnostic identity                                       | Reuse/change an identity or incompatibly change structured fields/locations             |
| Generated JS/runtime     | Compatible implementation fix; identical inputs/options stay deterministic on the same compiler | Additive compatible generated/runtime behavior                  | Break required imports, module format, render signature, or runtime interaction         |
| AOT artifact             | Compatible runtime fix for format 1                                                             | Add compatible behavior without invalidating format 1 artifacts | Invalidate format-1 artifacts or change its decoding contract; use a new format version |
| Support floors and peers | Correct an inaccurate declaration without changing actual support                               | Add support for a Node/Rust version or host-tool major          | Raise a minimum Node/Rust/tool floor or remove a previously supported version/major     |

The floors and peer ranges are part of the published compatibility contract;
raising a minimum or dropping supported versions requires a major release with
migration notes and CI evidence. Current packages remain
pre-1.0 and may make breaking changes under their existing release policy, with
explicit migration notes. This inventory does not freeze the API. Formal freeze
requires all S exit criteria, the RC entry contract, and maintainer acceptance.

The release readiness workflow packs the publishable artifacts, inspects every
declared target, and runs isolated Vite/Astro/Prettier consumers. The packed
public-export consumer additionally imports runtime/compiler/DOM/reactive/Events
entry points and typechecks their declarations under NodeNext and Bundler
resolution. The Vite and Astro consumers cover their plugin imports and `.flow`
declaration usage. No CommonJS support is declared or tested.
