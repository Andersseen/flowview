use flowview_compiler::{compile, CompileOptions};

fn compile_source(source: &str) -> String {
    compile(source, CompileOptions::new("@flowview/runtime"))
        .unwrap()
        .code
}

fn expect_error(source: &str) -> Vec<String> {
    compile(source, CompileOptions::new("@flowview/runtime"))
        .err()
        .unwrap()
        .into_iter()
        .map(|d| d.message)
        .collect()
}

fn expect_warnings(source: &str) -> Vec<flowview_compiler::Diagnostic> {
    compile(source, CompileOptions::new("@flowview/runtime"))
        .unwrap()
        .warnings
}

#[test]
fn javascript_source_maps_resolve_template_expressions() {
    let cases = [
        ("<p>{{ context.user.name }}</p>", "context.user.name"),
        ("<p>é{{ context.value }}</p>", "context.value"),
        ("<p>{{{ context.html }}}</p>", "context.html"),
        ("@if (context.visible) {x}", "context.visible"),
        ("@if (context.a) {x} @else if (context.b) {y}", "context.b"),
        (
            "@for (item of context.items) { {{ item.title }} }",
            "context.items",
        ),
        (
            "@for (item of context.items) { @for (child of item.children) { {{ child.name }} } }",
            "child.name",
        ),
        ("<p title=\"{{ context.title }}\">x</p>", "context.title"),
        (
            "<button [disabled]=\"context.disabled\">x</button>",
            "context.disabled",
        ),
        ("<p [attr.title]=\"context.title\">x</p>", "context.title"),
        (
            "<p [class.active]=\"context.active\">x</p>",
            "context.active",
        ),
        (
            "@switch (context.kind) { @case ('a') { A } }",
            "context.kind",
        ),
        ("@switch (context.kind) { @case ('a') { A } }", "'a'"),
    ];

    for (source, expression) in cases {
        let compiled = compile(
            source,
            CompileOptions::new("@flowview/runtime")
                .with_filename("src/page.flow")
                .with_source_map(true),
        )
        .unwrap();
        let map = sourcemap::SourceMap::from_slice(compiled.source_map.unwrap().as_bytes())
            .expect("valid Source Map v3");
        let generated = compiled
            .code
            .find(expression)
            .expect("expression in generated code");
        let (generated_line, generated_column) = line_column(&compiled.code, generated);
        let token = map
            .lookup_token(generated_line, generated_column)
            .expect("expression mapping exists");
        let original = source.find(expression).expect("expression in template");
        let (original_line, original_column) = line_column(source, original);
        assert_eq!(token.get_source(), Some("src/page.flow"), "{source}");
        assert_eq!(token.get_src_line(), original_line, "{source}");
        assert_eq!(token.get_src_col(), original_column, "{source}");
    }
}

#[test]
fn source_maps_are_opt_in_and_line_offsets_apply_once() {
    let source = "\n{{ context.name }}";
    let plain = compile(source, CompileOptions::new("@flowview/runtime")).unwrap();
    assert!(plain.source_map.is_none());
    let mapped = compile(
        source,
        CompileOptions::new("@flowview/runtime")
            .with_filename("component.astro")
            .with_source_map_source("component.astro", "<template>\n{{ context.name }}", 1, 0),
    )
    .unwrap();
    assert_eq!(plain.code, mapped.code);
    let map = sourcemap::SourceMap::from_slice(mapped.source_map.unwrap().as_bytes()).unwrap();
    let generated = mapped.code.find("context.name").unwrap();
    let (line, column) = line_column(&mapped.code, generated);
    let token = map.lookup_token(line, column).unwrap();
    assert_eq!(token.get_src_line(), 2);
    assert_eq!(
        map.get_source_contents(0),
        Some("<template>\n{{ context.name }}")
    );
}

#[test]
fn source_map_includes_a_source_location_for_multiline_static_html() {
    let source = "<p>first\n  second</p>";
    let compiled = compile(
        source,
        CompileOptions::new("@flowview/runtime")
            .with_filename("page.flow")
            .with_source_map(true),
    )
    .unwrap();
    let map = sourcemap::SourceMap::from_slice(compiled.source_map.unwrap().as_bytes()).unwrap();
    let generated = compiled.code.find("<p>first").unwrap();
    let (line, column) = line_column(&compiled.code, generated);
    let token = map.lookup_token(line, column).unwrap();
    assert_eq!(token.get_src_line(), 0);
    assert_eq!(token.get_src_col(), 0);
}

#[test]
fn source_map_applies_host_column_offset_to_first_template_line() {
    let source = "{{ context.name }}";
    let compiled = compile(
        source,
        CompileOptions::new("@flowview/runtime").with_source_map_source(
            "component.astro",
            "12345{{ context.name }}",
            0,
            5,
        ),
    )
    .unwrap();
    let map = sourcemap::SourceMap::from_slice(compiled.source_map.unwrap().as_bytes()).unwrap();
    let generated = compiled.code.find("context.name").unwrap();
    let (line, column) = line_column(&compiled.code, generated);
    assert_eq!(map.lookup_token(line, column).unwrap().get_src_col(), 8);
}

fn line_column(source: &str, offset: usize) -> (u32, u32) {
    let before = &source[..offset];
    let line = before.bytes().filter(|byte| *byte == b'\n').count() as u32;
    let column = before
        .rsplit('\n')
        .next()
        .unwrap_or_default()
        .encode_utf16()
        .count() as u32;
    (line, column)
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
    let output = compile_source("<h1>{{ context.title }}</h1>");
    assert!(output.contains("export function render(context)"));
    assert!(output.contains("output += renderValue(context.title);"));
}

#[test]
fn multiple_interpolations() {
    let source = "<p>{{ context.first }} {{ context.last }}</p>";
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
    let output = compile_source("<p>Hello {{ context.name }}</p>");
    assert!(output.contains("output += '<p';"));
    assert!(output.contains("output += '>';"));
    assert!(output.contains("output += 'Hello ';"));
    assert!(output.contains("renderValue(context.name)"));
    assert!(output.contains("output += '</p>';"));
}

#[test]
fn preserves_preformatted_whitespace() {
    let output = compile_source("<pre>first\n  second</pre>");
    assert!(output.contains("output += '<pre>first\\n  second</pre>';"));
}

#[test]
fn preserves_whitespace_after_complete_control_flow_blocks() {
    let after_if = compile_source("@if (context.visible) {x} next");
    assert!(after_if.contains("output += ' next';"));

    let after_for = compile_source("@for (item of context.items) {x} next");
    assert!(after_for.contains("output += ' next';"));
}

#[test]
fn consumes_only_whitespace_that_separates_block_continuations() {
    let if_output = compile_source("@if (context.visible) {x}\n  @else {y} next");
    assert!(!if_output.contains("output += '\\n  ';"));
    assert!(if_output.contains("output += ' next';"));

    let for_output = compile_source("@for (item of context.items) {x}\n  @empty {y} next");
    assert!(!for_output.contains("output += '\\n  ';"));
    assert!(for_output.contains("output += ' next';"));
}

#[test]
fn r#if() {
    let source = "@if (context.visible) { <p>Visible</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (context.visible) {"));
    assert!(output.contains("<p>Visible</p>"));
}

#[test]
fn if_else() {
    let source = "@if (context.visible) { <p>Visible</p> } @else { <p>Hidden</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (context.visible) {"));
    assert!(output.contains("} else {"));
    assert!(output.contains("<p>Visible</p>"));
    assert!(output.contains("<p>Hidden</p>"));
}

#[test]
fn else_if() {
    let source =
        "@if (context.a) { <p>A</p> } @else if (context.b) { <p>B</p> } @else { <p>C</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (context.a) {"));
    assert!(output.contains("else if (context.b) {"));
    assert!(output.contains("} else {"));
}

#[test]
fn nested_if() {
    let source = "@if (context.outer) { @if (context.inner) { <p>Both</p> } }";
    let output = compile_source(source);
    assert_eq!(output.matches("if (").count(), 2);
}

#[test]
fn r#for() {
    let source =
        "@for (product of context.products; track product.id) { <p>{{ product.name }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("const __flowview_items0 = Array.from((context.products) ?? []);"));
    assert!(output.contains("for (const product of __flowview_items0) {"));
    assert!(output.contains("renderValue(product.name)"));
}

#[test]
fn for_without_track() {
    let source = "@for (product of context.products) { <p>{{ product.name }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("const __flowview_items0 = Array.from((context.products) ?? []);"));
    assert!(output.contains("for (const product of __flowview_items0) {"));
    assert!(output.contains("renderValue(product.name)"));
}

#[test]
fn for_empty() {
    let source = "@for (item of context.items; track item.id) { <p>{{ item.name }}</p> } @empty { <p>Empty</p> }";
    let output = compile_source(source);
    assert!(output.contains("if (__flowview_items0.length === 0) {"));
    assert!(output.contains("<p>Empty</p>"));
    assert!(output.contains("for (const item of __flowview_items0) {"));
}

#[test]
fn for_with_set() {
    let source = "@for (item of context.items) { <p>{{ item }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("Array.from((context.items) ?? [])"));
    assert!(output.contains("for (const item of __flowview_items0) {"));
}

#[test]
fn nested_for() {
    let source = "@for (row of context.rows; track row.id) { @for (cell of row.cells; track cell.id) { <span>{{ cell.value }}</span> } }";
    let output = compile_source(source);
    assert!(output.contains("const __flowview_items0 = Array.from((context.rows) ?? []);"));
    assert!(output.contains("const __flowview_items1 = Array.from((row.cells) ?? []);"));
    assert_eq!(output.matches("for (const ").count(), 2);
}

#[test]
fn switch_default() {
    let source = "@switch (context.status) { @default { <p>Unknown</p> } }";
    let output = compile_source(source);
    assert!(output.contains("const __flowview_switch0 = context.status;"));
    assert!(output.contains("switch (__flowview_switch"));
    assert!(output.contains("default:"));
    assert!(!output.contains("break;"));
}

#[test]
fn multiple_switch_cases() {
    let source = "@switch (context.status) { @case ('a') { <p>A</p> } @case ('b') { <p>B</p> } }";
    let output = compile_source(source);
    assert!(output.contains("case 'a':"));
    assert!(output.contains("case 'b':"));
    assert_eq!(output.matches("break;").count(), 2);
}

#[test]
fn switch() {
    let source = "@switch (context.status) { @case ('a') { <p>A</p> } @case ('b') { <p>B</p> } @default { <p>Default</p> } }";
    let output = compile_source(source);
    assert!(output.contains("case 'a':"));
    assert!(output.contains("case 'b':"));
    assert!(output.contains("default:"));
}

#[test]
fn blocks_nested_inside_switch_cases() {
    let source = "@switch (context.status) { @case ('a') { @if (context.ok) { <p>OK</p> } } }";
    let output = compile_source(source);
    assert!(output.contains("case 'a':"));
    assert!(output.contains("if (context.ok) {"));
}

#[test]
fn interpolation_inside_loop() {
    let source = "@for (item of context.items; track item.id) { <p>{{ item.value }}</p> }";
    let output = compile_source(source);
    assert!(output.contains("for (const item of __flowview_items0) {"));
    assert!(output.contains("renderValue(item.value)"));
}

#[test]
fn nested_control_flow_blocks() {
    let source = "@if (context.show) { @for (item of context.items; track item.id) { @switch (item.kind) { @case ('a') { <p>A</p> } } } }";
    let output = compile_source(source);
    assert!(output.contains("if (context.show) {"));
    assert!(output.contains("for (const item of __flowview_items0) {"));
    assert!(output.contains("switch (__flowview_switch"));
}

#[test]
fn optional_track_expression() {
    let output = compile_source("@for (item of context.items) { <p></p> }");
    assert!(output.contains("Array.from((context.items) ?? [])"));
}

#[test]
fn track_expression_is_accepted_but_not_emitted() {
    let output =
        compile_source("@for (item of context.items; track item.id) { <p>{{ item.name }}</p> }");
    assert!(output.contains("for (const item of __flowview_items0) {"));
    assert!(!output.contains("item.id"));
}

#[test]
fn track_expression_emits_warning() {
    let warnings = expect_warnings("@for (item of context.items; track item.id) { <p></p> }");
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].message.contains("track"));
    assert_eq!(warnings[0].code.as_deref(), Some("FV0015"));
    assert_eq!(
        warnings[0].severity,
        flowview_compiler::DiagnosticSeverity::Warning
    );
}

#[test]
fn invalid_track_syntax() {
    let errors = expect_error("@for (item of context.items; item.id) { <p></p> }");
    assert!(errors.iter().any(|m| m.contains("track")));
}

#[test]
fn empty_track_syntax() {
    let errors = expect_error("@for (item of context.items; track) { <p></p> }");
    assert!(errors.iter().any(|m| m.contains("track")));
}

#[test]
fn rejects_invalid_or_internal_loop_bindings() {
    for binding in [
        "item-name",
        "output",
        "context",
        "__flowview_items0",
        "class",
    ] {
        let source = format!("@for ({binding} of context.items) {{ <p></p> }}");
        let errors = expect_error(&source);
        assert!(errors.iter().any(|message| message.contains("binding")));
    }
}

#[test]
fn supports_semicolons_inside_for_expressions() {
    let output = compile_source(
        "@for (item of context.find('a;b'); track (() => { return item.id; })()) { {{ item }} }",
    );
    assert!(output.contains("Array.from((context.find('a;b')) ?? [])"));
}

#[test]
fn supports_semicolons_inside_regular_expressions_in_for_headers() {
    let source = "@for (item of context.values.filter((value) => /;/.test(value)); track item) { {{ item }} }";
    let output = compile_source(source);

    assert!(output.contains("context.values.filter((value) => /;/.test(value))"));
}

#[test]
fn invalid_for_syntax() {
    let errors = expect_error("@for (item in context.items; track item.id) { <p></p> }");
    assert!(errors.iter().any(|m| m.contains("@for")));
}

#[test]
fn unclosed_interpolation() {
    let errors = expect_error("<p>{{ context.title</p>");
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
    let errors = expect_error("<div data-value={{ context.value }}></div>");
    assert!(errors
        .iter()
        .any(|message| message.contains("quoted attribute")));

    let output = compile_source("<div data-value=\"{{ context.value }}\"></div>");
    assert!(output.contains("renderValue(context.value)"));
}

#[test]
fn expressions_ignore_parentheses_inside_comments() {
    let output = compile_source("@if (context.ok /* ) */) { <p>OK</p> }");
    assert!(output.contains("if (context.ok /* ) */)"));
}

#[test]
fn expressions_support_regular_expression_literals() {
    let output = compile_source(r"@if (/\)/.test(context.value)) { <p>OK</p> }");
    assert!(output.contains(r"if (/\)/.test(context.value))"));
}

#[test]
fn unclosed_block() {
    let errors = expect_error("@if (context.visible) { <p>Visible</p>");
    assert!(errors.iter().any(|m| m.contains("Expected '}'")));
}

#[test]
fn requires_a_closing_brace_before_else_and_empty() {
    let if_errors = expect_error("@if (context.visible) {x @else {y}");
    assert!(if_errors
        .iter()
        .any(|message| message.contains("Unexpected '@else'")));

    let for_errors = expect_error("@for (item of context.items) {x @empty {y}");
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
    let output = compile_source(r"\@if \(context.visible) \{ literal \} and \{{ value \}\}");
    assert!(output.contains("output += '@if"));
    assert!(output.contains("{{ value }}"));
}

#[test]
fn control_flow_keywords_require_boundaries() {
    let output = compile_source("@foreach is text and @ifx is text");
    assert!(output.contains("@foreach is text and @ifx is text"));
}

#[test]
fn escaped_interpolation_spanning_entire_attribute_value_is_literal() {
    let output = compile_source(r#"<div title="\{{ x }}">hi</div>"#);
    assert!(!output.contains("renderValue("));
    assert!(output.contains(r#"title="{{ x }}""#));
}

#[test]
fn escaped_interpolation_mixed_with_text_stays_literal() {
    let output = compile_source(r#"<div title="a \{{ x }} b">hi</div>"#);
    assert!(!output.contains("renderValue("));
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

#[test]
fn expressions_support_escaped_quotes_and_template_literals() {
    let source = r#"@if (context.label === "a \"quoted\" value" || context.label === `a ) literal`) { <p>OK</p> }"#;
    let output = compile_source(source);
    assert!(output.contains(r#"context.label === "a \"quoted\" value""#));
    assert!(output.contains("context.label === `a ) literal`"));
}

#[test]
fn expressions_support_nested_template_literals() {
    let source = r#"@if (`outer ${`inner ) ${context.value}`}` === context.label) { <p>OK</p> }"#;
    let output = compile_source(source);
    assert!(output.contains(r#"`outer ${`inner ) ${context.value}`}` === context.label"#));
}

#[test]
fn expressions_support_regex_literals_after_javascript_keywords() {
    let source = r"@if ((() => { return /\)/.test(context.value); })()) { <p>OK</p> }";
    let output = compile_source(source);
    assert!(output.contains(r"return /\)/.test(context.value)"));
}

#[test]
fn interpolation_supports_closing_braces_inside_strings() {
    let output = compile_source(r#"<p>{{ "}}" }}</p>"#);
    assert!(output.contains(r#"renderValue("}}")"#));
}

#[test]
fn malformed_switch_block() {
    let errors = expect_error("@switch (context.status) { <p>Missing case</p> }");
    assert!(errors.iter().any(|m| m.contains("Unexpected")));
}

#[test]
fn html_raw_text_and_comments_do_not_start_flowview_syntax() {
    let source = r#"
  <script>const marker = "@if";</script>
  <style>.card { color: red; }</style>
  <!-- @for (item of items) {} -->"#;
    let output = compile_source(source);

    assert!(output.contains(r#"const marker = "@if";"#));
    assert!(output.contains(".card { color: red; }"));
    assert!(output.contains("@for (item of items) {}"));
}

#[test]
fn control_flow_keywords_inside_html_attributes_are_plain_text() {
    let source = r#"
  <div data-example="@if (not syntax)" title="contact@if.example">OK</div>"#;
    let output = compile_source(source);

    assert!(output.contains(r#"data-example="@if (not syntax)""#));
    assert!(output.contains("contact@if.example"));
}

#[test]
fn embedded_at_signs_do_not_start_control_flow() {
    let source = "<p>contact@if.example</p>";
    let output = compile_source(source);

    assert!(output.contains(source));
}

#[test]
fn invalid_javascript_expressions_are_rejected_by_the_compiler() {
    for source in [
        "@if (context.) {x}",
        "@for (item of context.) {x}",
        "@for (item of context.items; track item.) {x}",
        "@switch (context.) {@default {x}}",
        "{{ context. }}",
    ] {
        let errors = expect_error(source);
        assert!(
            errors
                .iter()
                .any(|message| message.contains("Invalid JavaScript expression")),
            "expected a JavaScript diagnostic for {source:?}, got {errors:?}"
        );
    }
}

#[test]
fn text_that_is_invalid_inside_javascript_strings_is_escaped() {
    let output = compile_source("first\0second\u{2028}third\u{2029}fourth");

    assert!(output.contains("first\\u0000second\\u2028third\\u2029fourth"));
}

#[test]
fn empty_source_compiles_to_empty_render_function() {
    let output = compile_source("");
    assert!(output.contains("export function render(context)"));
    assert!(output.contains("let output = '';"));
    assert!(output.contains("return output;"));
}

#[test]
fn unicode_characters_are_preserved() {
    let output = compile_source("<p>Hellø 🌍</p>");
    assert!(output.contains("Hellø 🌍"));
}

#[test]
fn ast_models_html_elements_and_attributes() {
    use flowview_compiler::ast::{Attribute, ElementNode, Node};
    use flowview_compiler::parse_ast;

    let root = parse_ast("<div class=\"card\" id='main' data-active></div>").unwrap();
    assert_eq!(root.children.len(), 1);

    let Node::Element(ElementNode {
        tag, attributes, ..
    }) = &root.children[0]
    else {
        panic!("expected an element node");
    };

    assert_eq!(tag, "div");
    assert_eq!(attributes.len(), 3);

    let Attribute::Plain(class) = &attributes[0] else {
        panic!("expected plain attribute");
    };
    assert_eq!(class.name, "class");
    assert_eq!(class.value.as_deref(), Some("card"));

    let Attribute::Plain(id) = &attributes[1] else {
        panic!("expected plain attribute");
    };
    assert_eq!(id.name, "id");
    assert_eq!(id.value.as_deref(), Some("main"));

    let Attribute::Plain(active) = &attributes[2] else {
        panic!("expected plain attribute");
    };
    assert_eq!(active.name, "data-active");
    assert_eq!(active.value, None);
}

#[test]
fn ast_dynamic_attribute_is_recognized() {
    use flowview_compiler::ast::{Attribute, DynamicAttribute, ElementNode, Node};
    use flowview_compiler::parse_ast;

    let root = parse_ast("<div class=\"{{ context.css }}\"></div>").unwrap();
    let Node::Element(ElementNode { attributes, .. }) = &root.children[0] else {
        panic!("expected an element node");
    };

    assert_eq!(attributes.len(), 1);
    let Attribute::Dynamic(DynamicAttribute {
        name, expression, ..
    }) = &attributes[0]
    else {
        panic!("expected dynamic attribute");
    };
    assert_eq!(name, "class");
    assert_eq!(expression, "context.css");
}

#[test]
fn ast_binding_attributes_are_recognized() {
    use flowview_compiler::ast::{Attribute, ElementNode, Node};
    use flowview_compiler::parse_ast;

    let root = parse_ast(
        r#"<button [disabled]="context.loading" [attr.aria-busy]="context.loading" [class.loading]="context.loading"></button>"#,
    )
    .unwrap();
    let Node::Element(ElementNode { attributes, .. }) = &root.children[0] else {
        panic!("expected an element node");
    };

    assert_eq!(attributes.len(), 3);

    let Attribute::BooleanBinding(disabled) = &attributes[0] else {
        panic!("expected boolean binding");
    };
    assert_eq!(disabled.name, "disabled");
    assert_eq!(disabled.expression, "context.loading");

    let Attribute::AttributeBinding(aria_busy) = &attributes[1] else {
        panic!("expected attr binding");
    };
    assert_eq!(aria_busy.name, "aria-busy");
    assert_eq!(aria_busy.expression, "context.loading");

    let Attribute::ClassBinding(loading) = &attributes[2] else {
        panic!("expected class binding");
    };
    assert_eq!(loading.name, "loading");
    assert_eq!(loading.expression, "context.loading");
}

#[test]
fn unsupported_binding_attribute_reports_diagnostic() {
    let errors = expect_error(r#"<button [value]="context.value"></button>"#);
    assert!(errors.iter().any(|m| m.contains("Unsupported binding")));
}

#[test]
fn diagnostic_contains_precise_span_and_code() {
    let diagnostics = compile("@if () {}", CompileOptions::new("@flowview/runtime"))
        .err()
        .unwrap();

    assert!(
        diagnostics
            .iter()
            .any(|d| d.code == Some("FV0007".to_string())),
        "expected empty expression code"
    );
    assert!(
        diagnostics.iter().any(|d| d.start == 4 && d.end == 5),
        "expected diagnostic to point inside empty parentheses"
    );
}

#[test]
fn malformed_html_reports_error() {
    let errors = expect_error("<div>text</span>");
    assert!(errors
        .iter()
        .any(|m| m.contains("Expected closing tag") || m.contains("Unexpected")));
}

#[test]
fn unclosed_tag_reports_error() {
    let errors = expect_error("<div><span>text");
    assert!(errors
        .iter()
        .any(|m| m.contains("Unclosed tag") || m.contains("Expected closing tag")));
}

#[test]
fn diagnostic_formatter_outputs_human_and_json() {
    use flowview_compiler::{DiagnosticFormatter, DiagnosticSeverity};

    let filename = "test.flow";
    let diagnostics =
        vec![
            flowview_compiler::diagnostics::Diagnostic::new("example error", 2, 5, 10, 15)
                .with_code("FV9999")
                .with_severity(DiagnosticSeverity::Error),
        ];

    let formatter = DiagnosticFormatter::new(&diagnostics, filename, 0);
    let human = formatter.format_human();
    assert!(human.contains("test.flow:2:5"));
    assert!(human.contains("FV9999"));
    assert!(human.contains("example error"));

    let json = formatter.format_json();
    assert!(json.contains(filename));
    assert!(json.contains("FV9999"));
    assert!(json.contains("example error"));
}

#[test]
fn ast_serializes_to_json() {
    use flowview_compiler::parse_ast;

    let root = parse_ast("<p>{{ context.name }}</p>").unwrap();
    let json = serde_json::to_string(&root).unwrap();
    assert!(json.contains("\"type\":\"Element\""));
    assert!(json.contains("\"tag\":\"p\""));
    assert!(json.contains("\"type\":\"Interpolation\""));
    assert!(json.contains("\"expression\":\"context.name\""));
}

#[test]
fn dynamic_attribute_expression_is_validated() {
    let errors = expect_error(r#"<div class="{{ context. }}"></div>"#);
    assert!(
        errors
            .iter()
            .any(|m| m.contains("Invalid JavaScript expression")),
        "expected invalid JS expression for dynamic attribute, got {errors:?}"
    );
}

#[test]
fn dynamic_attribute_expression_valid_parses() {
    let output = compile_source(r#"<div class="{{ context.css }}"></div>"#);
    assert!(output.contains("renderValue(context.css)"));
}

#[test]
fn mixed_interpolation_in_quoted_attribute_is_rejected() {
    let errors = expect_error(r#"<div class="btn {{ context.active }}"></div>"#);
    assert!(
        errors
            .iter()
            .any(|m| m.contains("must span the entire attribute value")),
        "expected mixed-attribute error, got {errors:?}"
    );
}

#[test]
fn html_closing_tags_are_case_insensitive() {
    // The compiler normalizes tag names to lower case, but accepts any ASCII
    // casing for opening and closing tags.
    let output = compile_source("<DIV>text</DIV>");
    assert!(output.contains("<div>text</div>"));

    let output = compile_source("<div>text</DIV>");
    assert!(output.contains("<div>text</div>"));
}

#[test]
fn doctype_is_preserved() {
    let output = compile_source("<!DOCTYPE html><html></html>");
    assert!(output.contains("<!DOCTYPE html>"));
    assert!(output.contains("<html></html>"));
}

#[test]
fn raw_text_elements_are_case_insensitive() {
    let source = r#"<SCRIPT>const x = "@if";</SCRIPT><STYLE>.a { color: red; }</STYLE>"#;
    let output = compile_source(source);
    assert!(output.contains(r#"const x = "@if";"#));
    assert!(output.contains(".a { color: red; }"));
}

#[test]
fn javascript_output_matches_committed_baseline() {
    let source = include_str!("fixtures/js/baseline.flow");
    let expected = include_str!("fixtures/js/baseline.js");
    assert_eq!(compile_source(source), expected);
}

// --- raw interpolation: `{{{ expression }}}` ---------------------------------

mod raw_interpolation {
    use super::*;
    use flowview_compiler::{
        ast::{InterpolationMode, Node},
        parse_ast, Diagnostic,
    };

    fn errors(source: &str) -> Vec<Diagnostic> {
        compile(source, CompileOptions::new("@flowview/runtime"))
            .expect_err("template should fail to compile")
    }

    fn only_interpolation(source: &str) -> flowview_compiler::ast::InterpolationNode {
        let root = parse_ast(source).unwrap();
        match root.children.into_iter().next().unwrap() {
            Node::Interpolation(node) => node,
            other => panic!("expected an interpolation, got {other:?}"),
        }
    }

    #[test]
    fn normal_interpolation_stays_in_escaped_mode() {
        let node = only_interpolation("{{ context.title }}");
        assert_eq!(node.mode, InterpolationMode::Escaped);
        assert_eq!(node.expression, "context.title");
    }

    #[test]
    fn triple_braces_produce_a_raw_interpolation_node() {
        let node = only_interpolation("{{{ context.body }}}");
        assert_eq!(node.mode, InterpolationMode::Raw);
        assert_eq!(node.expression, "context.body");
        assert_eq!((node.span.start, node.span.end), (0, 20));
    }

    #[test]
    fn raw_mode_is_explicit_in_the_serialized_ast() {
        let escaped = serde_json::to_string(&parse_ast("{{ a }}").unwrap()).unwrap();
        let raw = serde_json::to_string(&parse_ast("{{{ a }}}").unwrap()).unwrap();
        assert!(escaped.contains(r#""mode":"escaped""#), "{escaped}");
        assert!(raw.contains(r#""mode":"raw""#), "{raw}");
    }

    #[test]
    fn raw_expressions_use_the_shared_javascript_scanner() {
        let node =
            only_interpolation("{{{ context.items.map((item) => ({ html: item })).length }}}");
        assert_eq!(node.mode, InterpolationMode::Raw);
        assert_eq!(
            node.expression,
            "context.items.map((item) => ({ html: item })).length"
        );

        let node = only_interpolation(r#"{{{ context.ok ? '}}}' : "}}}" }}}"#);
        assert_eq!(node.expression, r#"context.ok ? '}}}' : "}}}""#);

        let node = only_interpolation("{{{ { html: context.x }.html }}}");
        assert_eq!(node.expression, "{ html: context.x }.html");

        let node = only_interpolation("{{{context.body}}}");
        assert_eq!(node.expression, "context.body");
    }

    #[test]
    fn raw_and_escaped_can_share_a_template() {
        let root = parse_ast("<p>{{ a }}</p>{{{ b }}}").unwrap();
        let modes: Vec<_> = root
            .children
            .iter()
            .filter_map(|node| match node {
                Node::Interpolation(node) => Some(node.mode),
                _ => None,
            })
            .collect();
        assert_eq!(modes, [InterpolationMode::Raw]);
        let Node::Element(p) = &root.children[0] else {
            panic!("expected element")
        };
        let Node::Interpolation(inner) = &p.children[0] else {
            panic!("expected interpolation")
        };
        assert_eq!(inner.mode, InterpolationMode::Escaped);
    }

    #[test]
    fn empty_raw_interpolation_is_rejected_with_its_own_code() {
        for source in ["{{{}}}", "{{{   }}}", "<p>{{{\n}}}</p>"] {
            let diagnostics = errors(source);
            assert_eq!(diagnostics[0].code.as_deref(), Some("FV0023"), "{source}");
            assert!(diagnostics[0].message.contains("cannot be empty"));
        }
    }

    #[test]
    fn unclosed_raw_interpolation_is_rejected_with_its_own_code() {
        for source in [
            "{{{ context.body",
            "<p>{{{ context.body }}</p>",
            "{{{ a }} b",
        ] {
            let diagnostics = errors(source);
            assert_eq!(diagnostics[0].code.as_deref(), Some("FV0024"), "{source}");
            assert!(diagnostics[0]
                .message
                .contains("Unclosed raw interpolation"));
            assert!(diagnostics[0].message.contains("}}}"));
        }
    }

    #[test]
    fn invalid_javascript_in_raw_interpolation_is_rejected() {
        let diagnostics = errors("{{{ context. }}}");
        assert_eq!(diagnostics[0].code.as_deref(), Some("FV0011"));
    }

    #[test]
    fn diagnostics_keep_line_column_and_span() {
        let diagnostics = errors("<p>\n  {{{ }}}\n</p>");
        let diagnostic = &diagnostics[0];
        assert_eq!(diagnostic.code.as_deref(), Some("FV0023"));
        assert_eq!((diagnostic.line, diagnostic.column), (2, 3));
        assert_eq!(diagnostic.start, 6);
    }

    #[test]
    fn escaped_triple_brace_marker_is_literal() {
        let output = compile_source(r"\{{{ not raw \}\}\}");
        assert!(!output.contains("renderRawValue"));
        assert!(!output.contains("renderValue("));
        assert!(output.contains("output += '{{{ not raw }}}';"), "{output}");
    }

    #[test]
    fn brace_marker_forms_are_unambiguous() {
        // `\{{`  -> literal `{{`
        let output = compile_source(r"\{{ x \}\}");
        assert!(output.contains("output += '{{ x }}';"), "{output}");
        assert!(!output.contains("renderValue("));

        // `\{{{` -> literal `{{{`, never a normal interpolation after a `{`.
        let output = compile_source(r"a \{{{ x \}\}\} b");
        assert!(output.contains("output += 'a {{{ x }}} b';"), "{output}");
        assert!(!output.contains("renderValue("));
        assert!(!output.contains("renderRawValue("));

        // `{{`  -> escaped interpolation
        let output = compile_source("{{ x }}");
        assert!(output.contains("renderValue(x)"));
        assert!(!output.contains("renderRawValue"));

        // `{{{` -> raw interpolation
        let output = compile_source("{{{ x }}}");
        assert!(output.contains("renderRawValue(x)"));
        assert!(!output.contains("renderValue("));

        // A lone `{` before an escaped marker stays text.
        let output = compile_source(r"{ \{{{ x \}\}\}");
        assert!(output.contains("{ {{{ x }}}"), "{output}");

        // An escape before `{{{` keeps working when a real one follows.
        let output = compile_source(r"\{{{ \}\}\} {{{ context.html }}}");
        assert!(output.contains("output += '{{{ }}} ';"), "{output}");
        assert!(output.contains("renderRawValue(context.html)"));
    }

    #[test]
    fn escaped_triple_brace_is_literal_in_attribute_values() {
        let output = compile_source(r#"<div title="\{{{ x }}}">hi</div>"#);
        assert!(!output.contains("renderValue("), "{output}");
        assert!(!output.contains("renderRawValue"), "{output}");
        assert!(output.contains(r#"title="{{{ x }}}""#), "{output}");
    }

    #[test]
    fn comments_script_and_style_are_not_interpolated() {
        let source =
            "<!-- {{{ x }}} --><script>a = '{{{ y }}}';</script><style>/* {{{ z }}} */</style>";
        let output = compile_source(source);
        assert!(!output.contains("renderRawValue"));
        assert!(output.contains("{{{ x }}}"));
        assert!(output.contains("{{{ y }}}"));
        assert!(output.contains("{{{ z }}}"));
    }

    #[test]
    fn raw_interpolation_is_rejected_in_attribute_values() {
        let sources = [
            r#"<div title="{{{ context.html }}}"></div>"#,
            r#"<div title="a {{{ context.html }}} b"></div>"#,
            r#"<div title='{{{ context.html }}}'></div>"#,
            r#"<div title={{{ context.html }}}></div>"#,
            r#"<div class="{{{ context.html }}}"></div>"#,
        ];
        for source in sources {
            let diagnostics = errors(source);
            assert_eq!(diagnostics[0].code.as_deref(), Some("FV0022"), "{source}");
            assert!(
                diagnostics[0]
                    .message
                    .contains("not supported inside HTML tags"),
                "{}",
                diagnostics[0].message
            );
            assert!(diagnostics[0].start > 0);
            assert_eq!(diagnostics[0].line, 1);
        }
    }

    #[test]
    fn raw_interpolation_is_rejected_in_tag_and_attribute_names() {
        for source in [
            "<div {{{ context.attrs }}}></div>",
            "<{{{ context.tag }}}></{{{ context.tag }}}>",
            "<div data-{{{ x }}}=\"1\"></div>",
        ] {
            let diagnostics = errors(source);
            assert!(
                diagnostics
                    .iter()
                    .any(|d| d.code.as_deref() == Some("FV0022")),
                "{source}: {diagnostics:?}"
            );
        }
    }

    #[test]
    fn normal_interpolation_in_attributes_is_unchanged() {
        let output = compile_source(r#"<div title="{{ context.t }}"></div>"#);
        assert!(output.contains("renderValue(context.t)"));
        assert!(!output.contains("renderRawValue"));
    }

    #[test]
    fn javascript_output_calls_the_raw_helper_and_imports_it_only_when_used() {
        let raw = compile_source("<article>{{{ context.body }}}</article>");
        assert!(
            raw.contains("output += renderRawValue(context.body);"),
            "{raw}"
        );
        assert!(
            raw.starts_with(
                "import { renderAttributeValue, renderRawValue, renderValue } from '@flowview/runtime';"
            ),
            "{raw}"
        );
        for forbidden in ["innerHTML", "document", "DOMParser"] {
            assert!(!raw.contains(forbidden), "{forbidden} in {raw}");
        }

        let escaped = compile_source("<p>{{ context.body }}</p>");
        assert!(escaped
            .starts_with("import { renderAttributeValue, renderValue } from '@flowview/runtime';"));
        assert!(!escaped.contains("renderRawValue"));
    }

    #[test]
    fn raw_interpolation_is_emitted_inside_control_flow() {
        let source = "@if (context.a) {{{{ context.a }}}} @else {x}\n\
                      @for (s of context.sections) {<h2>{{ s.title }}</h2>{{{ s.html }}}}\n\
                      @switch (context.k) { @case ('a') {{{{ context.a }}}} @default {{{{ context.d }}}} }";
        let output = compile_source(source);
        assert_eq!(output.matches("renderRawValue(").count(), 4, "{output}");
        assert!(output.contains("renderValue(s.title)"));
    }
}
