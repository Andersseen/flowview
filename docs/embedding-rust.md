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

## Install

```toml
[dependencies]
flowview-compiler = "0.2"
serde_json = "1"
```

`flowview-compiler` 0.2.0 is the first release prepared for crates.io. Until it
has been published, depend on a Git revision of this repository instead; the
release process is in [RELEASE.md](../RELEASE.md). The npm packages
(`@flowview/*`) do not provide the Rust crate and the crate does not provide
the npm packages: the two install stories are independent.

- **MSRV: Rust 1.91.** Declared as `rust-version` and verified in CI on
  exactly 1.91.0. It is set by the JavaScript parser dependency (`oxc_parser`);
  see [rust-consumer-readiness.md](rust-consumer-readiness.md) for the
  evidence. Raising it is a minor-version change while Flowview is pre-1.0.
- **Dependencies:** `serde`, `serde_json`, `sourcemap` and the Oxc parser
  family. The static API links Oxc because both backends share one expression
  validator; there is no feature that removes it (see the same document).
- **Binary cost:** a minimal consumer of the static API is about 1.2 MB as a
  stripped, LTO release binary. This is a measurement on one machine, not a
  guarantee; `scripts/measure-static-footprint.sh` reproduces it.

## Public surface

| Item                                                 | Role                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `compile_static(source, StaticCompileOptions)`       | Parse, validate and lower a template once.                   |
| `CompiledStaticTemplate::render(&Value)`             | Render one context. Immutable, `Send + Sync`.                |
| `CompiledStaticTemplate::render_serializable(&T)`    | `T: Serialize` convenience over `render` (see below).        |
| `render_static(source, &Value, StaticRenderOptions)` | One-shot convenience.                                        |
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
