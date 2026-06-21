use flowmark_compiler::{compile, CompileOptions};

fn compile_source(source: &str) -> String {
    compile(source, CompileOptions::new("@flowmark/runtime"))
        .unwrap()
        .code
}

fn expect_error(source: &str) -> Vec<String> {
    compile(source, CompileOptions::new("@flowmark/runtime"))
        .err()
        .unwrap()
        .into_iter()
        .map(|d| d.message)
        .collect()
}

#[test]
fn plain_text() {
    let output = compile_source("Hello, world!");
    assert!(output.contains("output += 'Hello, world!';"));
}

#[test]
fn html_like_markup() {
    let source = "<main><h1>Title</h1></main>";
    let output = compile_source(source);
    assert!(output.contains("output += '<main><h1>Title</h1></main>';"));
}

#[test]
fn interpolation() {
    let output = compile_source("<h1>{{ ctx.title }}</h1>");
    assert!(output.contains("output += renderValue(ctx.title);"));
}

#[test]
fn multiple_interpolations() {
    let source = "<p>{{ ctx.first }} {{ ctx.last }}</p>";
    let output = compile_source(source);
    assert_eq!(
        output.matches("renderValue(").count(),
        2,
        "expected two renderValue calls"
    );
    assert!(output.contains("output += ' ';"));
}

#[test]
fn preserves_significant_space_before_interpolation() {
    let output = compile_source("<p>Hello {{ ctx.name }}</p>");
    assert!(output.contains("output += '<p>Hello ';"));
}

#[test]
fn preserves_preformatted_whitespace() {
    let output = compile_source("<pre>first\n  second</pre>");
    assert!(output.contains("output += '<pre>first\\n  second</pre>';"));
}

#[test]
fn preserves_whitespace_after_complete_control_flow_blocks() {
    let after_if = compile_source("@if (ctx.visible) {x} next");
    assert!(after_if.contains("output += ' next';"));

    let after_for = compile_source("@for (item of ctx.items) {x} next");
    assert!(after_for.contains("output += ' next';"));
}

#[test]
fn consumes_only_whitespace_that_separates_block_continuations() {
    let if_output = compile_source("@if (ctx.visible) {x}\n  @else {y} next");
    assert!(!if_output.contains("output += '\\n  ';"));
    assert!(if_output.contains("output += ' next';"));

    let for_output = compile_source("@for (item of ctx.items) {x}\n  @empty {y} next");
    assert!(!for_output.contains("output += '\\n  ';"));
    assert!(for_output.contains("output += ' next';"));
}

#[test]
fn r#if() {
    let source = "@if (ctx.visible) { <p>Visible</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (ctx.visible) {"));
    assert!(output.contains("<p>Visible</p>"));
}

#[test]
fn if_else() {
    let source = "@if (ctx.visible) { <p>Visible</p> } @else { <p>Hidden</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (ctx.visible) {"));
    assert!(output.contains("} else {"));
    assert!(output.contains("<p>Visible</p>"));
    assert!(output.contains("<p>Hidden</p>"));
}

#[test]
fn else_if() {
    let source = "@if (ctx.a) { <p>A</p> } @else if (ctx.b) { <p>B</p> } @else { <p>C</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (ctx.a) {"));
    assert!(output.contains("else if (ctx.b) {"));
    assert!(output.contains("} else {"));
}

#[test]
fn nested_if() {
    let source = "@if (ctx.outer) { @if (ctx.inner) { <p>Both</p> } }";
    let output = compile_source(source);
    assert_eq!(output.matches("if (").count(), 2);
}

#[test]
fn r#for() {
    let source = "@for (product of ctx.products; track product.id) { <p>{{ product.name }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("const __items0 = Array.from((ctx.products) ?? []);"));
    assert!(output.contains("for (const product of __items0) {"));
    assert!(output.contains("renderValue(product.name)"));
}

#[test]
fn for_without_track() {
    let source = "@for (product of ctx.products) { <p>{{ product.name }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("const __items0 = Array.from((ctx.products) ?? []);"));
    assert!(output.contains("for (const product of __items0) {"));
    assert!(output.contains("renderValue(product.name)"));
}

#[test]
fn for_empty() {
    let source = "@for (item of ctx.items; track item.id) { <p>{{ item.name }}</p> } @empty { <p>Empty</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (__items0.length === 0) {"));
    assert!(output.contains("<p>Empty</p>"));
    assert!(output.contains("for (const item of __items0) {"));
}

#[test]
fn for_with_set() {
    let source = "@for (item of ctx.items) { <p>{{ item }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("Array.from((ctx.items) ?? [])"));
    assert!(output.contains("for (const item of __items0) {"));
}

#[test]
fn nested_for() {
    let source = "@for (row of ctx.rows; track row.id) { @for (cell of row.cells; track cell.id) { <span>{{ cell.value }}</span> } }";
    let output = compile_source(source);
    assert!(output.contains("const __items0 = Array.from((ctx.rows) ?? []);"));
    assert!(output.contains("const __items1 = Array.from((row.cells) ?? []);"));
    assert_eq!(output.matches("for (const ").count(), 2);
}

#[test]
fn switch_default() {
    let source = "@switch (ctx.status) { @default { <p>Unknown</p> } }";
    let output = compile_source(source);
    assert!(output.contains("const __switch0 = ctx.status;"));
    assert!(output.contains("switch (__switch"));
    assert!(output.contains("default:"));
    assert!(!output.contains("break;"));
}

#[test]
fn multiple_switch_cases() {
    let source = "@switch (ctx.status) { @case ('a') { <p>A</p> } @case ('b') { <p>B</p> } }";
    let output = compile_source(source);
    assert!(output.contains("case 'a':"));
    assert!(output.contains("case 'b':"));
    assert_eq!(output.matches("break;").count(), 1);
}

#[test]
fn switch() {
    let source = "@switch (ctx.status) { @case ('a') { <p>A</p> } @case ('b') { <p>B</p> } @default { <p>Default</p> } }";
    let output = compile_source(source);
    assert!(output.contains("case 'a':"));
    assert!(output.contains("case 'b':"));
    assert!(output.contains("default:"));
}

#[test]
fn blocks_nested_inside_switch_cases() {
    let source = "@switch (ctx.status) { @case ('a') { @if (ctx.ok) { <p>OK</p> } } }";
    let output = compile_source(source);
    assert!(output.contains("case 'a':"));
    assert!(output.contains("if (ctx.ok) {"));
}

#[test]
fn interpolation_inside_loop() {
    let source = "@for (item of ctx.items; track item.id) { <p>{{ item.value }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("for (const item of __items0) {"));
    assert!(output.contains("renderValue(item.value)"));
}

#[test]
fn nested_control_flow_blocks() {
    let source = "@if (ctx.show) { @for (item of ctx.items; track item.id) { @switch (item.kind) { @case ('a') { <p>A</p> } } } }";
    let output = compile_source(source);
    assert!(output.contains("if (ctx.show) {"));
    assert!(output.contains("for (const item of __items0) {"));
    assert!(output.contains("switch (__switch"));
}

#[test]
fn optional_track_expression() {
    let output = compile_source("@for (item of ctx.items) { <p></p> }");
    assert!(output.contains("Array.from((ctx.items) ?? [])"));
}

#[test]
fn track_expression_is_accepted_but_not_emitted() {
    let output =
        compile_source("@for (item of ctx.items; track item.id) { <p>{{ item.name }}</p> }");
    assert!(output.contains("for (const item of __items0) {"));
    assert!(!output.contains("item.id"));
}

#[test]
fn invalid_track_syntax() {
    let errors = expect_error("@for (item of ctx.items; item.id) { <p></p> }");
    assert!(errors.iter().any(|m| m.contains("track")));
}

#[test]
fn empty_track_syntax() {
    let errors = expect_error("@for (item of ctx.items; track) { <p></p> }");
    assert!(errors.iter().any(|m| m.contains("track")));
}

#[test]
fn rejects_invalid_or_internal_loop_bindings() {
    for binding in ["item-name", "output", "ctx", "__items0", "class"] {
        let source = format!("@for ({binding} of ctx.items) {{ <p></p> }}");
        let errors = expect_error(&source);
        assert!(errors.iter().any(|message| message.contains("binding")));
    }
}

#[test]
fn supports_semicolons_inside_for_expressions() {
    let output = compile_source(
        "@for (item of ctx.find('a;b'); track (() => { return item.id; })()) { {{ item }} }",
    );
    assert!(output.contains("Array.from((ctx.find('a;b')) ?? [])"));
}

#[test]
fn invalid_for_syntax() {
    let errors = expect_error("@for (item in ctx.items; track item.id) { <p></p> }");
    assert!(errors.iter().any(|m| m.contains("@for")));
}

#[test]
fn unclosed_interpolation() {
    let errors = expect_error("<p>{{ ctx.title</p>");
    assert!(errors.iter().any(|m| m.contains("Unclosed interpolation")));
}

#[test]
fn rejects_empty_interpolation_and_conditions() {
    assert!(expect_error("{{ }}")
        .iter()
        .any(|message| message.contains("cannot be empty")));
    assert!(expect_error("@if () { <p></p> }")
        .iter()
        .any(|message| message.contains("cannot be empty")));
}

#[test]
fn interpolation_supports_object_literals() {
    let output = compile_source("{{ { value: 1 } }}");
    assert!(output.contains("renderValue({ value: 1 })"));
}

#[test]
fn requires_quotes_around_interpolated_attribute_values() {
    let errors = expect_error("<div data-value={{ ctx.value }}></div>");
    assert!(errors
        .iter()
        .any(|message| message.contains("quoted attribute")));

    let output = compile_source("<div data-value=\"{{ ctx.value }}\"></div>");
    assert!(output.contains("renderValue(ctx.value)"));
}

#[test]
fn expressions_ignore_parentheses_inside_comments() {
    let output = compile_source("@if (ctx.ok /* ) */) { <p>OK</p> }");
    assert!(output.contains("if (ctx.ok /* ) */)"));
}

#[test]
fn expressions_support_regular_expression_literals() {
    let output = compile_source(r"@if (/\)/.test(ctx.value)) { <p>OK</p> }");
    assert!(output.contains(r"if (/\)/.test(ctx.value))"));
}

#[test]
fn unclosed_block() {
    let errors = expect_error("@if (ctx.visible) { <p>Visible</p>");
    assert!(errors.iter().any(|m| m.contains("Expected '}'")));
}

#[test]
fn requires_a_closing_brace_before_else_and_empty() {
    let if_errors = expect_error("@if (ctx.visible) {x @else {y}");
    assert!(if_errors
        .iter()
        .any(|message| message.contains("Unexpected '@else'")));

    let for_errors = expect_error("@for (item of ctx.items) {x @empty {y}");
    assert!(for_errors
        .iter()
        .any(|message| message.contains("Unexpected '@empty'")));
}

#[test]
fn unexpected_else() {
    let errors = expect_error("<p>Text</p> @else { <p>Else</p> }");
    assert!(errors.iter().any(|m| m.contains("Unexpected '@else'")));
}

#[test]
fn unexpected_empty() {
    let errors = expect_error("<p>Text</p> @empty { <p>Empty</p> }");
    assert!(errors.iter().any(|m| m.contains("Unexpected '@empty'")));
}

#[test]
fn unexpected_case() {
    let errors = expect_error("<p>Text</p> @case ('a') { <p>A</p> }");
    assert!(errors.iter().any(|m| m.contains("Unexpected '@case'")));
}

#[test]
fn unexpected_default() {
    let errors = expect_error("<p>Text</p> @default { <p>Default</p> }");
    assert!(errors.iter().any(|m| m.contains("Unexpected '@default'")));
}

#[test]
fn escaped_control_flow_markers_render_as_text() {
    let output = compile_source(r"\@if \(ctx.visible) \{ literal \} and \{{ value \}\}");
    assert!(output.contains("output += '@if"));
    assert!(output.contains("{{ value }}"));
}

#[test]
fn control_flow_keywords_require_boundaries() {
    let output = compile_source("@foreach is text and @ifx is text");
    assert!(output.contains("@foreach is text and @ifx is text"));
}

#[test]
fn expressions_support_escaped_quotes_and_template_literals() {
    let source =
        r#"@if (ctx.label === "a \"quoted\" value" || ctx.label === `a ) literal`) { <p>OK</p> }"#;
    let output = compile_source(source);
    assert!(output.contains(r#"ctx.label === "a \"quoted\" value""#));
    assert!(output.contains("ctx.label === `a ) literal`"));
}

#[test]
fn expressions_support_nested_template_literals() {
    let source = r#"@if (`outer ${`inner ) ${ctx.value}`}` === ctx.label) { <p>OK</p> }"#;
    let output = compile_source(source);
    assert!(output.contains(r#"`outer ${`inner ) ${ctx.value}`}` === ctx.label"#));
}

#[test]
fn expressions_support_regex_literals_after_javascript_keywords() {
    let source = r"@if ((() => { return /\)/.test(ctx.value); })()) { <p>OK</p> }";
    let output = compile_source(source);
    assert!(output.contains(r"return /\)/.test(ctx.value)"));
}

#[test]
fn interpolation_supports_closing_braces_inside_strings() {
    let output = compile_source(r#"<p>{{ "}}" }}</p>"#);
    assert!(output.contains(r#"renderValue("}}")"#));
}

#[test]
fn malformed_switch_block() {
    let errors = expect_error("@switch (ctx.status) { <p>Missing case</p> }");
    assert!(errors.iter().any(|m| m.contains("Unexpected")));
}
