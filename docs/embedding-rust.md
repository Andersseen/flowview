# Embedding Flowview in Rust tools

`flowview-compiler` is an independent Rust library. The native static backend
turns a template and a JSON-shaped page model into final HTML with no Node, no
JavaScript runtime, no browser and no WASM. The generated HTML does not depend
on `@flowview/runtime` or any client code.

```
structured Rust model
        ↓ serde
serde_json::Value
        ↓
CompiledStaticTemplate::render
        ↓
HTML String
```

There are two supported ways to consume a static template:

- **Runtime compilation:** use `flowview-compiler` when the template is chosen
  or created while the application is running.
- **AOT:** use the compiler/CLI during development or release, commit the
  generated artifact, then use `flowview-static-runtime` in the final app. The
  app does not need the compiler or Oxc in its dependency graph.

## Install

```toml
[dependencies]
flowview-compiler = "0.3"
serde_json = "1"
```

`flowview-compiler` 0.3.0 is the first release prepared for crates.io. Until it
has been published, depend on a Git revision of this repository instead; the
release process is in [RELEASE.md](../RELEASE.md). The npm packages
(`@flowview/*`) do not provide the Rust crate and the crate does not provide
the npm packages: the two install stories are independent.

- **Compiler MSRV: Rust 1.91.** Declared as `rust-version` and verified in CI on
  exactly 1.91.0. It is set by the JavaScript parser dependency (`oxc_parser`);
  see [rust-consumer-readiness.md](rust-consumer-readiness.md) for the
  evidence. Raising it is a minor-version change while Flowview is pre-1.0.
- **Dependencies:** `serde`, `serde_json`, `sourcemap` and the Oxc parser
  family. The static API links Oxc because both backends share one expression
  validator; there is no feature that removes it (see the same document).
- **Binary cost:** a minimal consumer of the static API is about 1.2 MB as a
  stripped, LTO release binary. This is a measurement on one machine, not a
  guarantee; `scripts/measure-static-footprint.sh` reproduces it.

## Precompiled templates (AOT)

Use this path when templates are known before building the final application.
It does not change `compile_static`, `CompiledStaticTemplate` or
`render_static`; those remain supported for runtime compilation.

Generate and commit the artifact:

```bash
cargo install flowview-cli --version 0.3.0
flowview precompile templates/page.flow --out src/page.flowview.json \
  --display-name templates/page.flow
flowview precompile templates/page.flow --out src/page.flowview.json \
  --display-name templates/page.flow --check
```

Consume it without the compiler:

```toml
[dependencies]
flowview-static-runtime = "0.1"
serde = { version = "1", features = ["derive"] }
```

```rust
use flowview_static_runtime::Template;

const PAGE: &[u8] = include_bytes!("page.flowview.json");
let template = Template::from_bytes(PAGE)?; // decode and prepare once
let html = template.render_serializable(&page_model)?;
```

The artifact is compact JSON data with identity `FLOWVIEW-STATIC` and format
version `1`. The runtime rejects unknown format versions, malformed input and
artifacts larger than 16 MiB. Regenerate artifacts when the format version is
unsupported; the compiler version is recorded for diagnosis. The `.flow`
source and logical filename are included for runtime source locations, so
artifact generation must avoid putting secrets in templates and must use a
relative `--display-name`. Raw interpolation remains a trust boundary: it emits
strings verbatim and does not sanitize HTML.

- **Runtime MSRV: Rust 1.85.** The separate runtime crate is tested with exactly
  1.85.0. A final consumer using only that crate and dependencies can build from
  Rust 1.85, subject to its own dependency and target requirements.
- **Regeneration toolchain: Rust 1.91.** The compiler and CLI use the Oxc
  parser and require the compiler MSRV to regenerate artifacts.
- **Consumer toolchain: Rust 1.85 or newer** for the runtime-only dependency
  graph; this is distinct from the compiler/regeneration floor.

The CI packaged-consumer check runs `scripts/verify-aot-packaged-consumer.sh`.
It packages `flowview-static-runtime`, inspects and extracts the `.crate`, then
builds a fresh consumer from that extracted package on Linux, macOS and Windows.
This proves the candidate Cargo package boundary; it does not prove a crates.io
installation. The release workflow separately checks registry-installed crate
versions after publication. See the [M4 exit evidence](milestones/m4-exit.md).

### AOT design measurements

The checked-in prototype compares serialized artifacts with generated Rust
modules that embed the same artifact bytes and call the same runtime decoder.
On macOS with Rust 1.91, the shared release profile (opt-level 3, LTO, one codegen
unit, stripped, panic abort) produced these results for the included page model:

| Consumer                            | Compile/prepare per template | Render per call | Binary size |
| ----------------------------------- | ---------------------------: | --------------: | ----------: |
| Runtime compiler (`compile_static`) |                       600 µs |         6.14 µs | 1,163,504 B |
| AOT (`Template::from_bytes`)        |                      18.9 µs |         1.67 µs |   517,824 B |

The measurement loops ran 500 compilations/preparations and 10,000 renders per
consumer. They are one-machine observations, not performance guarantees. The
AOT consumer binary was 645,680 bytes (55.5%) smaller, and its normal/build
dependency tree contains no compiler or Oxc crate.

The scaling prototype measured a single artifact several times and reports the
bytes for the requested set. Generated Rust adds its wrapper source around the
same serialized bytes; it did not change binary size or behavior in this
prototype. `n=1` is a clean consumer build; `n=10` and `n=50` are incremental
builds in that same temporary project.

| Templates | Serialized artifacts | Generated Rust source | Binary, either form |
| --------: | -------------------: | --------------------: | ------------------: |
|         1 |              4,455 B |               4,722 B |           517,776 B |
|        10 |             44,550 B |              47,220 B |           567,312 B |
|        50 |            222,830 B |             236,180 B |           748,944 B |

Reproduce the scaling run with `CARGO_NET_OFFLINE=true python3
scripts/measure-aot.py`; it needs the Rust CLI build and Node already available.
The paired operation loops live in `examples/compiler-consumer` and
`examples/aot-consumer` (`cargo run --release --bin measure` in each project).

## Public surface

| Item                                                 | Role                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `compile_static(source, StaticCompileOptions)`       | Parse, validate and lower a template once.                   |
| `CompiledStaticTemplate::render(&Value)`             | Render one context. Immutable, `Send + Sync`.                |
| `CompiledStaticTemplate::render_serializable(&T)`    | `T: Serialize` convenience over `render` (see below).        |
| `render_static(source, &Value, StaticRenderOptions)` | One-shot convenience.                                        |
| `compile_static_artifact(source, options)`           | Produce deterministic versioned AOT bytes.                   |
| `Diagnostic`, `DiagnosticFormatter`                  | Structured errors (code, severity, line, column, byte span). |
| `compile(source, CompileOptions)`                    | The JavaScript backend (used by the npm packages).           |

## Minimal example

```rust
use flowview_compiler::{compile_static, DiagnosticFormatter, StaticCompileOptions};
use serde::Serialize;

// Ship the template inside the binary.
const TEMPLATE: &str = include_str!("page.flow");

#[derive(Serialize)]
struct PageModel {
    title: String,
    body_html: String, // trusted HTML produced by the caller
}

fn main() {
    let options = StaticCompileOptions::default().with_filename("page.flow");
    let template = match compile_static(TEMPLATE, options) {
        Ok(template) => template,
        Err(diagnostics) => {
            eprintln!("{}", DiagnosticFormatter::new(&diagnostics, "page.flow", 0).format_human());
            std::process::exit(1);
        }
    };

    let model = PageModel { title: "Hello".into(), body_html: "<p>Hi</p>".into() };
    let value = serde_json::to_value(model).unwrap();
    let html = template.render(&value).unwrap();
    println!("{html}");
}
```

`serde_json::Value` is the deliberate decoupling boundary: Flowview has no
typed-template API and no schema generation. The root context must be a JSON
object and is visible to the template as `context`.

### Typed models: `render_serializable`

```rust
let html = template.render_serializable(&model)?; // model: impl Serialize
```

is exactly `template.render(&serde_json::to_value(&model)?)`, with a
serialization failure reported as an `FV0021` diagnostic instead of a
`serde_json::Error`. It is an ergonomic shortcut, **not** a performance
feature: the model is still materialized as a `serde_json::Value` on every
call, so it costs the same allocation as doing it by hand. Rendering straight
from a typed model without that intermediate value would need a different
data-access abstraction in the evaluator; it is deferred (see
[rust-consumer-readiness.md](rust-consumer-readiness.md)).

## Compile once, render many

```rust
let template = compile_static(TEMPLATE, StaticCompileOptions::default())?;
for page in &pages {
    let html = template.render(&serde_json::to_value(page)?)?;
    // write html …
}
```

Rendering keeps all state local to the call, so output is deterministic and a
template never accumulates state. Share it across threads with `Arc` or scoped
threads; `CompiledStaticTemplate` is asserted `Send + Sync` in the test suite.

## Trusted body HTML

Flowview does not parse Markdown. The caller renders the body, and the template
places it explicitly:

```
Markdown/parser owned by caller → trusted body HTML → Flowview page template → document HTML
```

```html
<h1>{{ context.page.title }}</h1>
{{{ context.page.body_html }}}
```

- `{{ value }}` is always escaped.
- `{{{ value }}}` emits a **string** verbatim; `null`, `undefined` and `false`
  render nothing; numbers, `true`, arrays and objects are error `FV0025`.
- Use `{{{ }}}` only for content from a trusted source. Flowview never detects HTML.

The trust boundary is the host's: Flowview never sanitizes, detects or
rewrites raw HTML, and `{{ value }}` is unaffected by it. Pre-rendering Markdown
in the host and placing the result with `{{{ }}}` is a supported pattern, but
deciding that the HTML is trustworthy is the caller's responsibility.

Interpolations in attribute values must span the whole value
(`href="{{ link.href }}"`), so compute derived strings such as `href` in Rust.

## Subpaths, assets and `<script>`

Flowview owns no routing or asset resolution. Compute every URL in the host
(for example `../../assets/site.css` for a page two levels deep, or
`/project/subpath/…`) and pass it through the context; `href="{{ … }}"` and
`src="{{ … }}"` emit it unchanged apart from attribute escaping (`&` → `&amp;`).

`<script>` and `<style>` elements are opaque: neither their content nor their
opening tag is interpolated. To emit a `<script src>` whose URL is computed,
have the host build the whole tag and place it with `{{{ context.assets.script_tag }}}`.
`<link rel="stylesheet" href="{{ … }}">` works normally.

## Static expressions: truthiness, `.length`, collections

The static backend evaluates a small JavaScript-like subset (full list in the
[spec](flowview-spec.md#static-expression-subset)): `context` and loop variables,
member access, string/array `.length`, literals, `!`, `&&`, `||`, `??`,
equality and ordering comparisons. Anything else is `FV0016` at compile time.

**Truthiness follows JavaScript.** `undefined`, `null`, `false`, `0` and `""` are
falsy; everything else, including an **empty array and an empty object**, is
truthy.

**Check collections with `.length`, not the collection itself:**

```flow
@if (context.items.length > 0) {
  <ul>@for (item of context.items) { <li>{{ item.title }}</li> }</ul>
}
```

`@if (context.items)` is true for `[]`. Use `.length` on arrays and strings (a
string's length counts UTF-16 units, as in JavaScript). `.length` of a missing
key is an error (`FV0018`, property of `undefined`), not `0`: put the
collection in the model even when it is empty, or guard with
`@if (context.items && context.items.length > 0)`. `@for` over `null` or a
missing key is simply empty, and `@empty` handles the no-items case without an
emptiness check at all.

There is no arithmetic, ternary or function call, so derived values
(`has_references`, a pre-joined `href`, a count) belong in the model.

## Keep logic in the model

Prefer a model that carries `current`, `href`, `label`, counts and groups, with
a template that only decides `@if`, `@for` and where to render. The static
expression subset is intentionally small; derive data before rendering.

## Diagnostics

Errors are `Vec<Diagnostic>`; nothing panics on bad input. Compile-time
failures (syntax, unsupported expressions) come from `compile_static`;
context-dependent ones (unknown identifier, invalid member access, non-array
`@for`, invalid raw value, non-object context) come from `render`. Use
`StaticCompileOptions::with_filename` to record a display name and pass the
same name to `DiagnosticFormatter`.

## Output formatting

- **Whitespace is preserved exactly.** Template indentation and newlines reach
  the output because whitespace between tags is observable
  (`<span>a</span> <span>b</span>` must not become `…</span><span>…`).
  Flowview has no collapsing mode. If output size matters, compress in transit
  (gzip/Brotli remove nearly all of the difference; measurements in
  [rust-consumer-readiness.md](rust-consumer-readiness.md)) or run a purpose-built
  HTML minifier on the result.
- **Void elements are written self-closed**, e.g. `<meta charset="utf-8" />`,
  as authored. This is valid HTML5 and cosmetic only; there is no option to
  rewrite it.

## Not supported (by design, for now)

Partials, components, recursion and template imports do not exist, so a
recursive structure such as a nested navigation tree cannot be expressed in a
template. Render that fragment in the host and place it with
`{{{ context.navigation_html }}}`. Reusable partials are a v2 design topic.
Routing, Markdown and asset resolution stay with the host.

## Performance

`cargo run --release -p flowview-compiler --example bench_static` renders a
realistic page (12 nav items, 6 headings, 4 backlinks, ~1.4 KiB trusted body)
at 10, 100 and 1000 pages, once through a compiled template and once through
the one-shot API. Reference numbers (Apple Silicon, Rust 1.99, release, one
machine, two runs):

| Workload   | compile once + `render` | `render_static` per page |
| ---------- | ----------------------- | ------------------------ |
| compile    | ~0.32 ms (once)         | —                        |
| 10 pages   | ~0.11 ms (11 µs/page)   | ~0.6 ms (60 µs/page)     |
| 100 pages  | ~0.94 ms (9 µs/page)    | ~5.5 ms (55 µs/page)     |
| 1000 pages | ~9 ms (9 µs/page)       | ~54 ms (54 µs/page)      |

Compile once and reuse the template: it is roughly 6× cheaper per page than
the one-shot API. Rendering is already tens of microseconds per page, so no
further optimization is planned. Timings are evidence, not assertions: no test
checks them.
