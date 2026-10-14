# flowview-compiler

Small HTML template compiler with Angular-inspired control flow
(`@if`, `@for`, `@switch`). One parser and one AST feed two backends:

- a JavaScript render-function backend (used by the `@flowview/*` npm packages), and
- a **native static backend** that renders `template + JSON → final HTML` in pure Rust,
  with no Node, JavaScript runtime or client code.

```rust
use flowview_compiler::{compile_static, StaticCompileOptions};
use serde_json::json;

let template = compile_static(
    "<h1>{{ context.title }}</h1>{{{ context.body_html }}}",
    StaticCompileOptions::default().with_filename("page.flow"),
)?;

// Compile once, render many. The template is immutable and `Send + Sync`.
let html = template.render(&json!({
    "title": "A & B",
    "body_html": "<p>Trusted, pre-rendered.</p>",
}))?;
assert_eq!(html, "<h1>A &amp; B</h1><p>Trusted, pre-rendered.</p>");
# Ok::<(), Vec<flowview_compiler::Diagnostic>>(())
```

```toml
[dependencies]
flowview-compiler = "0.2"
```

Minimum supported Rust version: **1.91** (tested in CI on exactly that
toolchain). Typed models can use `template.render_serializable(&model)`, a
convenience over `serde_json::to_value` that does not avoid the JSON value
allocation. Prefer `@if (context.items.length > 0)` over `@if (context.items)`
for collections: empty arrays are truthy, as in JavaScript.

`{{ value }}` is always escaped; `{{{ value }}}` is explicit trusted raw HTML.
Flowview is a template compiler, not a framework: no Markdown, routing, layouts or components.

Evidence behind the MSRV, dependency footprint and output-size decisions:
[rust-consumer-readiness.md](https://github.com/andersseen/flowview/blob/main/docs/rust-consumer-readiness.md).

See the [language specification](https://github.com/andersseen/flowview/blob/main/docs/flowview-spec.md)
and the [Rust embedding guide](https://github.com/andersseen/flowview/blob/main/docs/embedding-rust.md).

License: MIT
