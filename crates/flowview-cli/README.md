# flowview-cli

Command-line interface for the [Flowview](https://github.com/andersseen/flowview) template compiler.
Installs the `flowview` binary.

```bash
cargo install flowview-cli

# JavaScript render function
flowview compile page.flow --out page.js

# Final HTML, rendered natively from JSON data
flowview compile page.flow --target static-html --data context.json --out page.html
```

Templates can be read from stdin with `-` (use `--display-name` to label diagnostics).
Use `--diagnostic-format json` for machine-readable diagnostics.

To embed Flowview in a Rust tool, depend on
[`flowview-compiler`](https://crates.io/crates/flowview-compiler) instead.

License: MIT
