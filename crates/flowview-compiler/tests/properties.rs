use flowview_compiler::{
    ast::{Attribute, Node, RootNode, Span},
    compile, compile_static, parse_ast, render_static, CompileOptions, StaticRenderOptions,
};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use proptest::prelude::*;
use serde_json::json;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    // @spec SPEC-HTML-031
    #[test]
    fn structured_templates_compile_and_emit_valid_modules(source in valid_template()) {
        let output = compile(&source, options()).unwrap_or_else(|errors| panic!("generator emitted rejected syntax: {source:?}: {errors:?}"));
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &output.code, SourceType::mjs()).parse();
        prop_assert!(parsed.diagnostics.is_empty(), "generated JS failed to parse for {source:?}: {:?}", parsed.diagnostics);
    }

    // @spec SPEC-HTML-075
    #[test]
    fn javascript_compilation_is_deterministic(source in valid_template()) {
        let mapped_options = options().with_source_map(true);
        let first = compile(&source, mapped_options.clone()).unwrap();
        let second = compile(&source, mapped_options).unwrap();
        prop_assert_eq!(first.code, second.code);
        prop_assert_eq!(first.source_map, second.source_map);
        prop_assert_eq!(first.warnings, second.warnings);
        let first_static = compile_static(&source, Default::default());
        let second_static = compile_static(&source, Default::default());
        prop_assert_eq!(first_static.as_ref().map(|t| t.warnings().to_vec()), second_static.as_ref().map(|t| t.warnings().to_vec()));
        prop_assert_eq!(first_static.err(), second_static.err());
    }

    // @spec SPEC-HTML-072
    #[test]
    fn parsed_spans_are_bounded_and_nested(source in valid_template()) {
        let root = parse_ast(&source).unwrap();
        check_nodes(&root, None, &source);
    }

    // @spec SPEC-HTML-076
    #[test]
    fn escaped_and_raw_interpolations_use_distinct_helpers(raw in proptest::collection::vec(any::<bool>(), 1..20)) {
        let source = raw.iter().map(|is_raw| if *is_raw { "{{{ context.value }}}" } else { "{{ context.value }}" }).collect::<Vec<_>>().join("|");
        let output = compile(&source, options()).unwrap().code;
        prop_assert_eq!(output.matches("renderValue(context.value)").count(), raw.iter().filter(|v| !**v).count());
        prop_assert_eq!(output.matches("renderRawValue(context.value)").count(), raw.iter().filter(|v| **v).count());
    }

    // @spec SPEC-HTML-001
    #[test]
    fn static_templates_preserve_literal_bytes(text in static_text()) {
        let output = render_static(&text, &json!({}), StaticRenderOptions::default()).unwrap();
        prop_assert_eq!(output.html, text);
    }

    #[test]
    fn bounded_control_blocks_remain_nested(kinds in proptest::collection::vec(0u8..3, 0..8)) {
        let mut source = "leaf".to_owned();
        for kind in &kinds {
            source = match kind {
                0 => format!("@if (true) {{{source}}}"),
                1 => format!("@for (item of context.items) {{{source}}}"),
                _ => format!("@switch ('x') {{ @case ('x') {{{source}}} }}"),
            };
        }
        let ast = parse_ast(&source).unwrap();
        prop_assert_eq!(max_block_depth(&ast), kinds.len());
    }
}

fn options() -> CompileOptions {
    CompileOptions::new("@flowview/runtime")
}

fn valid_template() -> impl Strategy<Value = String> {
    let text = prop_oneof![
        Just("hello".to_owned()),
        Just("héllo 🌱".to_owned()),
        Just(" ".to_owned())
    ];
    let leaf = prop_oneof![
        text,
        Just("<x-card title='plain'>static</x-card>".to_owned()),
        Just("{{ context.value }}".to_owned()),
        Just("{{{ context.value }}}".to_owned()),
        Just("<button [disabled]=\"context.disabled\" [attr.title]=\"context.title\" [class.active]=\"context.active\">go</button>".to_owned()),
        Just("@if (context.ok) {yes} @else {no}".to_owned()),
        Just("@for (item of context.items) {{{ item }}} @empty {none}".to_owned()),
        Just("@switch (context.kind) { @case ('a') {A} @default {B} }".to_owned()),
    ];
    leaf.prop_recursive(4, 48, 8, |inner| {
        prop_oneof![
            inner
                .clone()
                .prop_map(|body| format!("<section data-x=\"ok\">{body}</section>")),
            inner
                .clone()
                .prop_map(|body| format!("@if (context.ok) {{{body}}}")),
            inner
                .clone()
                .prop_map(|body| format!("@for (item of context.items) {{{body}}}")),
        ]
    })
}

fn static_text() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("  spaced\ntext &amp; unicode: café 🌱  ".to_owned()),
        Just("<!-- @if (x) { literal } -->".to_owned()),
        Just("<script>const text = '{{ value }}';</script>".to_owned()),
        Just("<style>.x::after { content: '@for'; }</style>".to_owned()),
        Just("<x-card aria-label='hello' data-kind=\"demo\"></x-card>".to_owned()),
        Just("<input disabled/>\n<title>é</title>".to_owned()),
    ]
}

fn check_span(span: Span, source: &str, parent: Option<Span>) {
    assert!(
        span.start <= span.end && span.end <= source.len(),
        "invalid span {span:?} in {source:?}"
    );
    assert!(source.is_char_boundary(span.start) && source.is_char_boundary(span.end));
    if let Some(parent) = parent {
        assert!(
            parent.start <= span.start && span.end <= parent.end,
            "child {span:?} escaped parent {parent:?}"
        );
    }
}

fn check_nodes(root: &RootNode, parent: Option<Span>, source: &str) {
    for node in &root.children {
        check_node(node, parent, source);
    }
}

fn check_node(node: &Node, parent: Option<Span>, source: &str) {
    let span = match node {
        Node::Text(n) => n.span,
        Node::Interpolation(n) => n.span,
        Node::Element(n) => n.span,
        Node::IfBlock(n) => n.span,
        Node::ForBlock(n) => n.span,
        Node::SwitchBlock(n) => n.span,
    };
    check_span(span, source, parent);
    match node {
        Node::Element(n) => {
            for attr in &n.attributes {
                let s = match attr {
                    Attribute::Plain(a) => a.span,
                    Attribute::Dynamic(a) => a.span,
                    Attribute::BooleanBinding(a) => a.span,
                    Attribute::AttributeBinding(a) => a.span,
                    Attribute::ClassBinding(a) => a.span,
                };
                check_span(s, source, Some(span));
            }
            for child in &n.children {
                check_node(child, Some(span), source);
            }
        }
        Node::IfBlock(n) => {
            for branch in &n.branches {
                check_span(branch.span, source, Some(span));
                for child in &branch.children {
                    check_node(child, Some(branch.span), source);
                }
            }
            if let Some(nodes) = &n.else_branch {
                for child in nodes {
                    check_node(child, Some(span), source);
                }
            }
        }
        Node::ForBlock(n) => {
            for child in &n.children {
                check_node(child, Some(span), source);
            }
            if let Some(nodes) = &n.empty {
                for child in nodes {
                    check_node(child, Some(span), source);
                }
            }
        }
        Node::SwitchBlock(n) => {
            for case in &n.cases {
                check_span(case.span, source, Some(span));
                for child in &case.children {
                    check_node(child, Some(case.span), source);
                }
            }
            if let Some(nodes) = &n.default {
                for child in nodes {
                    check_node(child, Some(span), source);
                }
            }
        }
        Node::Text(_) | Node::Interpolation(_) => {}
    }
}

fn max_block_depth(root: &RootNode) -> usize {
    root.children.iter().map(depth).max().unwrap_or(0)
}
fn depth(node: &Node) -> usize {
    let children: Vec<&Node> = match node {
        Node::Element(n) => n.children.iter().collect(),
        Node::IfBlock(n) => n
            .branches
            .iter()
            .flat_map(|b| &b.children)
            .chain(n.else_branch.iter().flatten())
            .collect(),
        Node::ForBlock(n) => n.children.iter().chain(n.empty.iter().flatten()).collect(),
        Node::SwitchBlock(n) => n
            .cases
            .iter()
            .flat_map(|c| &c.children)
            .chain(n.default.iter().flatten())
            .collect(),
        _ => Vec::new(),
    };
    let own = if matches!(
        node,
        Node::IfBlock(_) | Node::ForBlock(_) | Node::SwitchBlock(_)
    ) {
        1
    } else {
        0
    };
    own + children.into_iter().map(depth).max().unwrap_or(0)
}

fn unicode_malformed_source() -> impl Strategy<Value = String> {
    let piece = prop_oneof![
        Just("é"),
        Just("€"),
        Just("🙂"),
        Just("\u{FFFD}"),
        Just("\u{00A0}"),
        Just("\u{3000}"),
        Just("ß"),
        Just("日本"),
        Just("{{"),
        Just("{{{"),
        Just("}}"),
        Just("}}}"),
        Just("@if"),
        Just("@for"),
        Just("@switch"),
        Just("@case"),
        Just("@else"),
        Just("("),
        Just(")"),
        Just("{"),
        Just("}"),
        Just("<"),
        Just(">"),
        Just("<p "),
        Just("</p>"),
        Just("[x]="),
        Just("["),
        Just("]"),
        Just("\""),
        Just("'"),
        Just("`"),
        Just("\\"),
        Just("\\\\"),
        Just(" "),
        Just("\n"),
        Just("a"),
        Just("item of items"),
    ];
    // Wrap the payload in constructs that reach the JavaScript expression
    // validator, where offsets are translated from unescaped text.
    (0usize..6, proptest::collection::vec(piece, 0..24)).prop_map(|(wrapper, pieces)| {
        let body = pieces.concat();
        match wrapper {
            0 => body,
            1 => format!("<p [x]=\"{body}\">"),
            2 => format!("<p [x]='{body}'></p>"),
            3 => format!("{{{{ {body} }}}}"),
            4 => format!("{{{{{{ {body} }}}}}}"),
            _ => format!("@if ({body}) {{ x }}"),
        }
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    // @spec SPEC-HTML-073
    #[test]
    fn diagnostics_on_unicode_malformed_source_have_valid_utf8_spans(source in unicode_malformed_source()) {
        let mut diagnostics = Vec::new();
        if let Err(errors) = parse_ast(&source) {
            diagnostics.extend(errors);
        }
        match compile(&source, options()) {
            Err(errors) => diagnostics.extend(errors),
            Ok(output) => diagnostics.extend(output.warnings),
        }
        match compile_static(&source, StaticRenderOptions::default()) {
            Err(errors) => diagnostics.extend(errors),
            Ok(template) => diagnostics.extend(template.warnings().to_vec()),
        }
        if let Err(errors) = render_static(&source, &json!({}), StaticRenderOptions::default()) {
            diagnostics.extend(errors);
        }
        for d in diagnostics {
            prop_assert!(d.start <= d.end, "{d:?} in {source:?}");
            prop_assert!(d.end <= source.len(), "{d:?} in {source:?}");
            prop_assert!(source.is_char_boundary(d.start), "{d:?} in {source:?}");
            prop_assert!(source.is_char_boundary(d.end), "{d:?} in {source:?}");
        }
    }
}
