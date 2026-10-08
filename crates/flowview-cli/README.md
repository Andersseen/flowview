# flowview-cli

Command-line interface for the [Flowview](https://github.com/andersseen/flowview) template compiler.
Installs the `flowview` binary.

```bash
cargo install flowview-cli

# JavaScript render function
flowview compile page.flow --out page.js

# JSON containing generated code and a Source Map v3
flowview compile page.flow --source-map --display-name src/page.flow

# Final HTML, rendered natively from JSON data
flowview compile page.flow --target static-html --data context.json --out page.html
```

Templates can be read from stdin with `-` (use `--display-name` to label diagnostics).
Use `--diagnostic-format json` for machine-readable diagnostics.
With `--source-map`, stdout contains a JSON object with `code` and `sourceMap`;
when `--out` is supplied, the map is written beside the JavaScript as `.map`.
For embedded templates, `--source-map-input-json` reads `source` and the full
`sourceMapSourceContent` from a JSON object on stdin.

To embed Flowview in a Rust tool, depend on
[`flowview-compiler`](https://crates.io/crates/flowview-compiler) instead.

License: MIT
