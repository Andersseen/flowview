# Rust consumer readiness (0.2.0)

Evidence and decisions behind the `flowview-compiler` 0.2.0 release (workstream
WS6B in [spec-driven-development.md](spec-driven-development.md)). The usage
guide is [embedding-rust.md](embedding-rust.md).

## Downstream evidence

A real multi-page Rust documentation tool replaced its built-in page renderer
with `compile_static` + `CompiledStaticTemplate::render`, driven by a typed page
model converted to `serde_json::Value`. This was an adoption experiment on a
Git revision, not a release.

What worked:

- Compile once, render many; about 19 µs per page and ~0.15 ms to compile.
  Roughly 6 ms slower than the built-in renderer across 1000 pages, which is
  not an adoption cost.
- Semantic parity of the rendered pages, route/href handling, hostile values
  (escaping survived), Unicode, Linux/macOS/Windows, browser E2E, accessibility
  and no-JS behaviour.

What blocked adoption, and how 0.2.0 answers each item:

| Finding                                        | Outcome                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Crate not on crates.io                         | Release prepared: exact-order publish, registry smoke, packaging gates (below). |
| No declared or tested MSRV                     | `rust-version = "1.91"`, tested on exactly 1.91.0 in CI.                        |
| Oxc 0.137 raised the effective MSRV to 1.94    | Oxc moved to 0.116; MSRV 1.91 (below).                                          |
| Oxc adds ~1.2 MB (+32%) to a native binary     | Measured; not removable cleanly. Documented, not hidden (below).                |
| Readable indentation made HTML ~24% larger raw | Measured; ≤8% after gzip/Brotli. Semantics unchanged (below).                   |
| Typed model needs `serde_json::to_value`       | `render_serializable` convenience added; no zero-copy claim (below).            |
| Unclear truthiness / `.length` support         | Tested and documented; no language change.                                      |
| No recursion / partials                        | Deferred to v2 (below).                                                         |
| `<meta ... />` instead of `<meta ...>`         | Cosmetic; deferred.                                                             |

## MSRV and the Oxc investigation

The Rust floor of `flowview-compiler` is the highest `rust-version` in its
normal dependency graph. At Oxc 0.137 that is 1.94.0 (every `oxc_*` crate);
no other normal dependency declares a floor above the Oxc one. Oxc raises its floor roughly
every 6–8 releases and tracks recent stable, so the choice of Oxc version _is_
the choice of MSRV.

All four direct crates (`oxc_allocator`, `oxc_ast`, `oxc_parser`, `oxc_span`)
were moved together. Newest release in each Rust-floor tier, built and run
through the full compiler test suite (compiler, static, spec fixtures,
proptests, corpus):

| Oxc     | Oxc floor | Builds / tests pass    | Stripped static consumer | Normal deps |
| ------- | --------- | ---------------------- | ------------------------ | ----------- |
| 0.137.0 | 1.94      | yes (previous)         | 1,260,384 B              | 130         |
| 0.133.0 | 1.93      | yes, 2-line API change | 1,233,728 B              | 130         |
| 0.116.0 | 1.91      | yes, 2-line API change | 1,227,856 B              | 129         |
| 0.102.0 | 1.89      | yes, 2-line API change | 1,188,384 B              | 127         |

The adaptation between 0.137 and every older release is the same: the parse
error's `labels` field is `Option<Vec<LabeledSpan>>` and the parser result's
diagnostics field is `errors`. No behaviour, diagnostic or source-map change: 27 invalid expressions
(plain interpolations, `@if`/`@for` conditions and a binding) produced
byte-identical CLI diagnostics, messages and positions on 0.137 and 0.116.

**Selected: Oxc 0.116.0, MSRV Rust 1.91.** It is the newest release at the 1.91
floor, lowers the requirement by three minor versions, and needs no Flowview
behaviour change. Going older would gain little (the next tier down, 0.102 at
1.89, saves two more versions and a few percent of binary size) while giving up
parser fixes; going to 0.133 only gets to 1.93 and does not help consumers on
1.91/1.92 toolchains. Reaching Rust 1.85, the downstream project's own floor,
would need Oxc 0.75 or older, over forty releases back; that is the
"arbitrarily old" direction and was not attempted.

Evidence:

```text
1.91.0  cargo build/test --workspace --locked      PASS (all targets, -D warnings)
1.90.0  cargo build -p flowview-compiler --locked  REJECTED:
        oxc_allocator/oxc_ast/oxc_parser/oxc_span/... 0.116.0 require rustc 1.91.0
1.93.1  original main (Oxc 0.137)                  REJECTED: Oxc 0.137 requires 1.94
```

The declared version lives once in `[workspace.package]`, is inherited by all
crates and is enforced by `.github/workflows/rust-msrv.yml`, which installs
exactly `1.91.0`, checks that its pin equals `rust-version`, then builds and
tests the workspace. It runs on every PR and as a gate of the Rust release
workflow. Raising the Oxc version later raises the MSRV; that is a deliberate,
reviewed minor-version change, not something a lockfile refresh may do silently.

## Oxc binary footprint

The static backend and the JavaScript backend share one parser and one
expression validator (`javascript::validate_expression`, Oxc), and the static
evaluator lowers every expression from the Oxc AST
(`static_html/evaluator.rs`) into its own small expression tree. Validation of
`{{ … }}`, `@if (…)` and binding expressions is therefore identical for both
targets, and the static path cannot run without Oxc.

Reproduce with `scripts/measure-static-footprint.sh` (builds
`examples/static_consumer.rs` with opt-level 3, LTO, one codegen unit, `strip`,
`panic = "abort"`): 1,227,856 bytes with Oxc 0.116, versus 1,260,384 with
0.137. These are totals for the whole minimal consumer (std, `serde_json`,
Flowview and Oxc); the downstream +1.19 MB / +31.8% figure was the delta in a
larger binary. One machine, one consumer, not a benchmark.

**Outcome B — no clean reduction.** No Oxc version or configuration removes the
dependency from the static path, and the footprint is nearly flat across a span
of 35 releases (about 6% from 0.137 to 0.102). Adding a "light" feature would
either link the same Oxc stack anyway or fork the expression language between
targets. Replacing Oxc with a hand-written expression parser is rejected before
v1: it would make the JavaScript target (Oxc) and the static target (custom)
interpret the same text differently, trading a one-time 1.2 MB for permanent
parity risk. Revisit only with a design in which both targets share one
parser. Consumers for whom ~1.2 MB matters should know the trade-off, not
expect a switch.

## Package contents and registry release

`cargo package` inspection (version 0.2.0):

| Crate               | Files | Compressed |
| ------------------- | ----- | ---------- |
| `flowview-compiler` | 36    | ~51 KiB    |
| `flowview-cli`      | 7     | ~14 KiB    |

Both carry `README.md` and `LICENSE`, `Cargo.toml` with `rust-version`, and
`publish = ["crates-io"]`. Tests and fixtures are excluded
(`exclude = ["tests/"]`); examples are self-contained
(`examples/site-page.flow`). `flowview-wasm` stays `publish = false` and is
only bundled into the npm package. Cargo prints "ignoring test … not included"
warnings while packaging; they are expected.

The Rust release workflow (`.github/workflows/rust-release.yml`) runs:
MSRV gate → fmt/clippy/tests/docs (`-D warnings`) → package + archive
inspection → dry-run publish → (publish only) `flowview-compiler` → wait for
the exact version in the sparse index → **registry-consumer smoke**
(`scripts/verify-registry-consumer.sh`) → `flowview-cli` → `cargo install
flowview-cli --version =X` from the registry. Everything fails closed, the
token is only read by cargo from `CARGO_REGISTRY_TOKEN`, and reruns skip a
version already public with a matching checksum.

The smoke project depends on `flowview-compiler = "=<version>"` with no
`path`, `git` or workspace dependency, compiles a template and asserts both
escaped and trusted-raw output. `cargo publish --dry-run` for the CLI is only
possible once the compiler version is already in the registry; the dry-run
mode of `scripts/publish-rust.sh` runs it exactly then and otherwise says why it
skipped it.

## Whitespace and output size

`scripts/measure-whitespace-compression.mjs` renders the representative page
with `examples/render_sample.rs` and compares it to an indentation-trimmed copy
(a measurement proxy, not a shipped transform). Node `zlib`; gzip level 9,
Brotli quality 11:

| Scenario                              | raw   | gzip  | Brotli |
| ------------------------------------- | ----- | ----- | ------ |
| Body-heavy (40 paragraphs, 12 nav)    | +7.7% | +2.8% | +3.7%  |
| Template-heavy (4 paragraphs, 60 nav) | +36%  | +7.0% | +8.3%  |

In the template-heavy case that is 997 vs 932 bytes gzipped, 65 bytes. The
downstream ~24% raw increase falls between the two scenarios; after normal
transfer compression the difference is a few percent and tens of bytes per
page. **Decision: keep exact whitespace preservation and add no option.** A
naive "drop whitespace between tags" would change
`<span>a</span> <span>b</span>`, which is observable and part of the tested
language contract; a semantics-safe minifier would need an HTML-aware model of
inline/block/`pre`/`textarea` contexts that is out of scope. A host that cares
about raw bytes can post-process the output with a purpose-built minifier.
A future opt-in option is possible only if it provably cannot change text
output.

## Decisions and deferrals

- **Truthiness and `.length`:** already specified (SPEC-HTML-048, -050, -051,
  -052); now tested through the public API (`tests/static_embedding.rs`) and
  documented, including the recommendation to test collections with
  `.length > 0`. No new spec IDs, no language change.
- **Typed contexts:** `render_serializable<T: Serialize>` added as sugar over
  `serde_json::to_value` with an `FV0021` diagnostic on failure. It still
  allocates the `Value`; documentation says so.
- **Zero-copy typed rendering (deferred to v2):** rendering without a
  `serde_json::Value` needs a data-access abstraction under the evaluator
  (a trait over values or a custom Serde serializer). That is a design change
  with parity implications for both backends, not a small additive API.
- **Partials, components, recursion, imports (deferred to v2):** they raise
  scope, parameter, resolution, cycle, diagnostic, source-map and JS/static
  parity questions, and the v1 language surface stays frozen. The documented
  workaround is trusted pre-rendered HTML via `{{{ … }}}`.
- **Void-element style (`<meta … />`) (deferred):** valid HTML, cosmetic, not a
  v1 blocker. No formatting mode.
- **Timing:** the ~19 µs/page cost is not optimized.
