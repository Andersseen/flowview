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

## Public surface

| Item                                                 | Role                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `compile_static(source, StaticCompileOptions)`       | Parse, validate and lower a template once.                   |
| `CompiledStaticTemplate::render(&Value)`             | Render one context. Immutable, `Send + Sync`.                |
| `render_static(source, &Value, StaticRenderOptions)` | One-shot convenience.                                        |
| `Diagnostic`, `DiagnosticFormatter`                  | Structured errors (code, severity, line, column, byte span). |

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

Interpolations in attribute values must span the whole value
(`href="{{ link.href }}"`), so compute derived strings such as `href` in Rust.

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

## Performance

`cargo run --release -p flowview-compiler --example bench_static` renders a
realistic page (12 nav items, 6 headings, 4 backlinks, ~1.4 KiB trusted body).
Reference numbers (Apple Silicon, Rust 1.99, release):

| Workload   | compile once + `render` | `render_static` per page |
| ---------- | ----------------------- | ------------------------ |
| compile    | ~0.3 ms (once)          | —                        |
| 10 pages   | ~0.09 ms (9 µs/page)    | ~0.48 ms (48 µs/page)    |
| 100 pages  | ~0.65 ms (7 µs/page)    | ~3.9 ms (39 µs/page)     |
| 1000 pages | ~7.3 ms (7 µs/page)     | ~48 ms (48 µs/page)      |

Compile once and reuse the template: it is roughly 6× cheaper per page than
the one-shot API. The numbers validate the design; no timing assertions exist
in the tests.
