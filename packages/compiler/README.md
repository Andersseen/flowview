# @flowview/compiler

The FlowView compiler parses trusted `.flow` template source and compiles it to
plain JavaScript render functions. It uses the bundled WASM compiler; npm
consumers do not need Rust, Cargo, or a native FlowView executable.

```ts
import { compileFlowview } from "@flowview/compiler";

const { code, warnings } = compileFlowview("<h1>{{ context.title }}</h1>", {
  filename: "page.flow",
});
```

`compileFlowview` returns generated code, optional source maps, and structured
warnings. Compilation errors throw `FlowviewCompilerError`, whose `diagnostics`
contain the compiler's message, severity, code, filename, line, column, and
UTF-8 byte span. The compiler validates expressions but does not evaluate them.

FlowView templates are trusted source code. Normal interpolation (`{{ value }}`)
escapes HTML. Triple braces (`{{{ value }}}`) are the only raw interpolation
path and require an already trusted string. FlowView does not sanitize HTML.
Mixed static text and interpolation in one attribute value is unsupported.
`track` is accepted but has no rendering effect and produces `FV0015`.

See the root [FlowView guide](../../README.md) and
[language specification](../../docs/flowview-spec.md).
