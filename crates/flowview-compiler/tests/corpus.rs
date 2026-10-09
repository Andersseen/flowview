use flowview_compiler::{
    ast::Node, compile, parse_ast, render_static, CompileOptions, StaticRenderOptions,
};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::json;

#[test]
fn authored_html_corpus_compiles_parses_and_preserves_static_bytes() {
    let source = include_str!("corpus/document.html");
    let ast = parse_ast(source).unwrap_or_else(|e| panic!("document.html parse failed: {e:?}"));
    assert!(
        !contains_control_flow(&ast.children),
        "document.html: marker-like content was misdetected as control flow"
    );
    let output = compile(source, CompileOptions::new("@flowview/runtime"))
        .unwrap_or_else(|e| panic!("document.html compile failed: {e:?}"));
    let allocator = Allocator::default();
    let js = Parser::new(&allocator, &output.code, SourceType::mjs()).parse();
    assert!(
        js.diagnostics.is_empty(),
        "document.html generated invalid JS: {:?}",
        js.diagnostics
    );
    let html = render_static(source, &json!({}), StaticRenderOptions::default())
        .unwrap_or_else(|e| panic!("document.html static render failed: {e:?}"));
    let normalized = source
        .replace("<meta charset=\"utf-8\">", "<meta charset=\"utf-8\"/>")
        .replace(
            "<input name=\"name\" required>",
            "<input name=\"name\" required/>",
        );
    assert_eq!(html.html, normalized, "document.html static HTML changed");
}

fn contains_control_flow(nodes: &[Node]) -> bool {
    nodes.iter().any(|node| match node {
        Node::IfBlock(_) | Node::ForBlock(_) | Node::SwitchBlock(_) => true,
        Node::Element(element) => contains_control_flow(&element.children),
        Node::Text(_) | Node::Interpolation(_) => false,
    })
}
