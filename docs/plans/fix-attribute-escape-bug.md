# Plan: Fix escaped interpolation (`\{{`) inside quoted attributes

Status: ready to implement. No open decisions — follow the steps as written.

## Background (read this, skip re-analysis)

Flowmark compiles `.flow` templates to JS render functions. Attribute parsing
lives in `crates/flowmark-compiler/src/parser/html.rs`. Escape handling for
syntax markers is `is_escaped_syntax` in
`crates/flowmark-compiler/src/parser/lexer.rs:85-87`, which matches a `\`
followed by `@`, `{`, `}`, or `\`.

Per the README and the compiler's own diagnostic (html.rs:177-183), users
escape literal braces in attributes as `attr="\{{ ... }}"`.

## The bug (verified with the real binary)

```sh
printf '<div title="\\{{ x }}">hi</div>' | target/debug/flowmark compile - --display-name t.flow
```

Current (wrong) output — compiles the escaped braces as a **dynamic
interpolation** and exits 0:

```js
output += ' title="';
output += renderValue(x);   // wrong: user asked for literal braces; `x` is not even defined
output += '"';
```

Expected output: a static attribute with literal braces, i.e. the element folds
into one string containing `title="{{ x }}"` and there is **no** `renderValue`
call.

Note the mixed case already works correctly today
(`title="a \{{ x }} b"` → static `title="a {{ x }} b"`). Only the case where
the escaped interpolation spans the whole value is broken.

## Root cause

In `parse_attribute_value` (html.rs:315-319), when `is_escaped_syntax` fires,
the code consumes the backslash and pushes the raw character — the escape
information is discarded. The resulting `AttributeValue.value` for input
`\{{ x }}` is the string `{{ x }}`. Then `parse_attribute` (html.rs:158) calls
`extract_dynamic_expression(&value.value)`, which sees a value that starts with
`{{` and ends with `}}` and classifies it as a dynamic attribute.

(`has_interpolation_marker` is NOT set in this case: the `cursor.starts_with("{{")`
check at html.rs:322 never sees two consecutive unescaped braces, because the
first `{` was already consumed by the escape branch.)

## Fix — all edits in `crates/flowmark-compiler/src/parser/html.rs`

### 1. Add a flag to `AttributeValue` (struct at html.rs:284-291)

```rust
struct AttributeValue {
    value: String,
    quote: char,
    content_start: usize,
    has_interpolation_marker: bool,
    has_escaped_braces: bool,   // NEW
}
```

### 2. Set it in the quoted-value loop (html.rs:315-319)

Current code:

```rust
if is_escaped_syntax(cursor) {
    cursor.advance();
    value.push(cursor.advance().unwrap());
    continue;
}
```

New code — check the escaped character BEFORE consuming; only `{`/`}` matter
(escaped `@` or `\` cannot affect interpolation detection):

```rust
if is_escaped_syntax(cursor) {
    if matches!(cursor.peek(1), Some('{' | '}')) {
        has_escaped_braces = true;
    }
    cursor.advance();
    value.push(cursor.advance().unwrap());
    continue;
}
```

Declare `let mut has_escaped_braces = false;` next to
`has_interpolation_marker` and include it in the `Ok(AttributeValue { ... })`
constructor of this function.

### 3. Initialize it in `parse_unquoted_attribute_value` (constructor at html.rs:385-390)

That path never processes escapes; add `has_escaped_braces: false` to its
`AttributeValue` constructor so the struct compiles.

### 4. Guard the dynamic extraction in `parse_attribute` (html.rs:158)

Change:

```rust
if let Some(expression) = extract_dynamic_expression(&value.value) {
```

to:

```rust
if !value.has_escaped_braces {
    if let Some(expression) = extract_dynamic_expression(&value.value) {
        // ... existing body unchanged ...
    }
}
```

Do NOT touch the `has_interpolation_marker` error path below it. Resulting
behavior matrix:

| Input | Result |
|---|---|
| `title="{{ x }}"` | dynamic attribute (unchanged) |
| `title="\{{ x }}"` | plain attribute, literal `{{ x }}` (FIXED) |
| `title="a \{{ x }} b"` | plain attribute (unchanged, regression-guard it) |
| `title="\{{ x }} {{ y }}"` | error FM "must span the entire attribute value" (correct: real marker present, extraction skipped) |

## Quick win A (same file): drop backtick as an attribute quote

At html.rs:300-309, `parse_attribute_value` accepts `` ` `` as a quote char and
codegen re-emits it, producing invalid HTML (`<div class=`x`>`). Change the
match from `Some('\'' | '"' | '`')` to `Some('\'' | '"')`. Backtick then falls
through to the unquoted-value path, and the value is re-emitted with `"`
quotes (valid HTML). No existing test uses backtick-quoted attributes (the
backtick tests in `compiler_tests.rs` lines 402-413 are template literals
inside `@if` expressions — unaffected).

## Quick win B: fix wrong `filename` argument in `packages/astro/src/index.ts`

`FlowmarkAstroError`'s constructor is
`(message, filename, offset, code)` (index.ts:33-47), but every throw site
inside `findEmbeddedTemplates` passes the whole source `code` as the
`filename` argument (index.ts:222-227, 244-249, 252-257, 262-267, 271-276).

Fix: change the signature to
`findEmbeddedTemplates(code: string, filename: string)`, pass `filename` from
the caller in `transformAstroSource` (index.ts:157, which already has a
`filename` parameter), and pass `filename` as the second constructor argument
at all throw sites. No behavior change expected — the catch block in
`flowmarkAstroPlugin` uses `cleanId`, not `error.filename`.

## New tests — `crates/flowmark-compiler/tests/compiler_tests.rs`

Use the existing helpers `compile_source` / `expect_error` (defined at the top
of the file). Add:

```rust
#[test]
fn escaped_interpolation_spanning_entire_attribute_value_is_literal() {
    let output = compile_source(r#"<div title="\{{ x }}">hi</div>"#);
    assert!(!output.contains("renderValue"));
    assert!(output.contains(r#"title="{{ x }}""#));
}

#[test]
fn escaped_interpolation_mixed_with_text_stays_literal() {
    let output = compile_source(r#"<div title="a \{{ x }} b">hi</div>"#);
    assert!(!output.contains("renderValue"));
    assert!(output.contains(r#"title="a {{ x }} b""#));
}

#[test]
fn escaped_and_real_interpolation_in_one_attribute_is_an_error() {
    let errors = expect_error(r#"<div title="\{{ x }} {{ y }}">hi</div>"#);
    assert!(errors[0].contains("span the entire attribute value"));
}

#[test]
fn backtick_is_not_an_attribute_quote() {
    let output = compile_source("<div class=`x`>hi</div>");
    assert!(output.contains(r#"class="`x`""#));
}
```

A dynamic-attribute regression test (`attr="{{ expr }}"` → `renderValue`)
already exists in the suite; verify it still passes, do not duplicate it.

## Verification checklist (run in order)

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check

# Manual smoke test of the two shapes:
cargo build -p flowmark-cli
printf '<div title="\\{{ x }}">hi</div>' | target/debug/flowmark compile -
#   -> must NOT contain renderValue; must contain title="{{ x }}"
printf '<div title="{{ context.x }}">hi</div>' | target/debug/flowmark compile -
#   -> must contain renderValue(context.x)

# TS side (consumes the rebuilt binary; test:vite rebuilds Rust itself):
pnpm run test:vite
pnpm run test:astro
pnpm exec prettier --check "packages/astro/src/index.ts"
```

## Acceptance criteria

- All commands above pass.
- `\{{` in a quoted attribute never produces a `renderValue` call.
- No changes outside `crates/flowmark-compiler/src/parser/html.rs`,
  `crates/flowmark-compiler/tests/compiler_tests.rs`, and
  `packages/astro/src/index.ts`.
