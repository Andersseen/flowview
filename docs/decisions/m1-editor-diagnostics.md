# M1 editor diagnostics design

## Status

Approved for implementation in M1 by the editor milestone brief.

## Decisions

- The VS Code extension bundles the same `@flowview/compiler` WASM build used by
  the JavaScript integrations. The VSIX includes the compiler wrapper, generated
  WASM glue, WASM binary, and compiler version used at build time. It has no
  Rust, Cargo, native executable, PATH, checkout, or network requirement.
- `compileFlowview` is sufficient as the compiler diagnostics API: successful
  compilation returns warnings and failed compilation throws
  `FlowviewCompilerError` containing all compiler diagnostics. M1 adds no
  compiler API or second validation pass.
- The extension only parses and validates source. It does not evaluate template
  expressions, inspect user context types, or execute handler functions.
- `.flow` documents are diagnosed immediately on open and save. Changes are
  diagnosed after a 120 ms debounce. A document version check rejects delayed
  work for an old buffer; close cancels the timer and clears the collection.
  Compilation runs synchronously in the extension host because the compiler
  call is local and does not perform I/O.
- Astro region discovery is the extracted `packages/astro/src/embedded-regions.ts`
  helper, shared by the integration transform and VS Code. It uses
  `@astrojs/compiler` AST nodes, checks wrapper requirements, and returns
  code-unit source boundaries for each region.
- FlowView compiler spans are UTF-8 byte offsets. One extension boundary maps
  those spans to JS UTF-16 code units before constructing VS Code ranges.
- Astro Events diagnostics come from `@flowview/astro-events`' existing
  transform pipeline. The Events transform runs before FlowView compilation,
  matching integration plugin order. Unchanged embedded regions retain direct
  host offsets; changed regions use the Events source map to return locations to
  the original file.
- Workspace trust and external executable policy are not needed: the extension
  starts no process and executes no template source.

## Risks and limits

- Astro itself and the FlowView compiler contribute WASM payloads to the VSIX.
  The package acceptance check verifies all required files are present and
  usable from a clean unpacked directory.
- Context expressions are not type-checked. Diagnostics cover syntax and the
  existing FlowView and Events compiler contracts only.
- VS Code ESM activation and native module compatibility remain governed by the
  extension's minimum VS Code version. The bundle leaves only the VS Code API
  and the packaged TypeScript parser as runtime module dependencies.
