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

`{{ value }}` is always escaped; `{{{ value }}}` is explicit trusted raw HTML.
Flowview is a template compiler, not a framework: no Markdown, routing, layouts or components.

See the [language specification](https://github.com/andersseen/flowview/blob/main/docs/flowview-spec.md)
and the [Rust embedding guide](https://github.com/andersseen/flowview/blob/main/docs/embedding-rust.md).

License: MIT
