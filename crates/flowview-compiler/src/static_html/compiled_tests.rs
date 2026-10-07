//! Contract tests for the reusable compiled static template.

use serde_json::{json, Value};

use super::{compile_static, render_static, CompiledStaticTemplate, StaticRenderOptions};

fn compile(source: &str) -> CompiledStaticTemplate {
    compile_static(source, Default::default()).unwrap()
}

fn code(errors: Vec<crate::Diagnostic>) -> Option<String> {
    errors.into_iter().next().and_then(|d| d.code)
}

#[test]
fn compiled_template_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<CompiledStaticTemplate>();
}

#[test]
fn compile_once_render_many_contexts() {
    let template = compile(
        "<a href=\"{{ context.url }}\" [class.on]=\"context.on\">{{ context.title }}</a>\
         @if (context.show) {<p>{{{ context.html }}}</p>} @else {<i>hidden</i>}\
         <ul>@for (x of context.xs; track x) {<li>{{ x }}</li>} @empty {<li>none</li>}</ul>",
    );
    let a = template
        .render(&json!({"url": "/a", "on": true, "title": "A", "show": true, "html": "<b>1</b>", "xs": [1, 2]}))
        .unwrap();
    let b = template
        .render(&json!({"url": "/b", "on": false, "title": "<B>", "show": false, "html": "<b>2</b>", "xs": []}))
        .unwrap();
    let c = template
        .render(&json!({"url": "/c", "on": true, "title": "C", "show": true, "html": "<u>3</u>", "xs": ["z"]}))
        .unwrap();
    assert!(a.contains("href=\"/a\"") && a.contains("class=\"on\"") && a.contains("<b>1</b>"));
    assert!(a.contains("<li>1</li><li>2</li>"));
    assert!(b.contains("href=\"/b\"") && !b.contains("class=") && b.contains("&lt;B&gt;"));
    assert!(b.contains("<i>hidden</i>") && b.contains("<li>none</li>") && !b.contains("<b>2</b>"));
    assert!(c.contains("<u>3</u>") && c.contains("<li>z</li>") && !c.contains("<b>1</b>"));
}

#[test]
fn compiled_template_outlives_source() {
    let template = {
        let source = String::from("<p>{{ context.n }}</p>");
        compile(&source)
    };
    assert_eq!(template.render(&json!({"n": 7})).unwrap(), "<p>7</p>");
}

#[test]
fn nested_loops_do_not_leak_scope() {
    let template = compile(
        "@for (s of context.sections) {[@for (p of s.pages) {{{ p }}}]{{ s.name }}} {{ s.name }}",
    );
    // `s` is out of scope after the loop: fails with an unresolved identifier.
    let err = template
        .render(&json!({"sections": [{"name": "a", "pages": [1]}]}))
        .unwrap_err();
    assert_eq!(code(err).as_deref(), Some("FV0017"));

    let template =
        compile("@for (s of context.sections) {[@for (p of s.pages) {{{ p }}}]{{ s.name }}}");
    let first = template
        .render(
            &json!({"sections": [{"name": "a", "pages": ["1", "2"]}, {"name": "b", "pages": []}]}),
        )
        .unwrap();
    assert_eq!(first, "[12]a[]b");
    let second = template
        .render(&json!({"sections": [{"name": "c", "pages": ["9"]}]}))
        .unwrap();
    assert_eq!(second, "[9]c");
}

#[test]
fn failed_render_does_not_corrupt_later_renders() {
    let template = compile(
        "@for (s of context.sections) {@for (p of s.pages) {{{ p.x }}}}|{{ context.tail }}",
    );
    let bad = json!({"sections": [{"pages": [{"x": "ok"}, 5]}]});
    let err = template.render(&bad).unwrap_err();
    assert_eq!(code(err).as_deref(), Some("FV0018"));
    let good = json!({"sections": [{"pages": [{"x": "a"}]}], "tail": "t"});
    assert_eq!(template.render(&good).unwrap(), "a|t");
    assert_eq!(template.render(&good).unwrap(), "a|t");
}

#[test]
fn unsupported_expressions_fail_at_compile_time_even_if_unreachable() {
    let errors = compile_static(
        "@if (false) {{{ context.items.map((x) => x) }}}",
        Default::default(),
    )
    .unwrap_err();
    assert_eq!(code(errors).as_deref(), Some("FV0016"));
    let errors =
        compile_static("{{ context.items.map((x) => x) }}", Default::default()).unwrap_err();
    assert_eq!(code(errors).as_deref(), Some("FV0016"));
}

#[test]
fn context_errors_are_render_time_and_recoverable() {
    let template = compile("@for (x of context.xs) {{{ x }}}{{{ context.raw }}}{{ context.a.b }}");
    let ok = json!({"xs": ["a"], "raw": "<i>", "a": {"b": 1}});
    assert_eq!(template.render(&ok).unwrap(), "a<i>1");

    let err = template
        .render(&json!({"xs": 3, "raw": "", "a": {"b": 1}}))
        .unwrap_err();
    assert_eq!(code(err).as_deref(), Some("FV0019"));
    let err = template
        .render(&json!({"xs": [], "raw": 5, "a": {"b": 1}}))
        .unwrap_err();
    let diagnostic = err.into_iter().next().unwrap();
    assert_eq!(diagnostic.code.as_deref(), Some("FV0025"));
    assert!(diagnostic.line >= 1);
    let err = template
        .render(&json!({"xs": [], "raw": "", "a": null}))
        .unwrap_err();
    assert_eq!(code(err).as_deref(), Some("FV0018"));
    let err = template.render(&json!([])).unwrap_err();
    assert_eq!(code(err).as_deref(), Some("FV0021"));

    assert_eq!(template.render(&ok).unwrap(), "a<i>1");
}

#[test]
fn raw_values_are_not_cached_between_renders() {
    let template = compile("{{{ context.html }}}|{{ context.html }}");
    assert_eq!(
        template.render(&json!({"html": "<b>1</b>"})).unwrap(),
        "<b>1</b>|&lt;b&gt;1&lt;/b&gt;"
    );
    assert_eq!(
        template.render(&json!({"html": "<i>2</i>"})).unwrap(),
        "<i>2</i>|&lt;i&gt;2&lt;/i&gt;"
    );
}

#[test]
fn matches_legacy_render_static() {
    let sources = [
        "<p class=\"a\" [class.b]=\"context.b\" title=\"{{ context.t }}\">{{ context.t }}</p>",
        "{{{ context.html }}} {{ context.html }}",
        "@switch (context.k) { @case ('a') {A} @default {D} }",
        "@for (x of context.xs; track x) {<i>{{ x }}</i>} @empty {none}",
    ];
    let ctx = json!({"b": true, "t": "<T>", "html": "<em>x</em>", "k": "a", "xs": [1, 2]});
    for source in sources {
        let legacy = render_static(source, &ctx, StaticRenderOptions::default()).unwrap();
        let template = compile(source);
        assert_eq!(legacy.html, template.render(&ctx).unwrap(), "{source}");
        assert_eq!(legacy.warnings, template.warnings(), "{source}");
    }
}

#[test]
fn warnings_are_compile_time_and_stable() {
    let source = "@for (i of context.xs; track i) {{{ i }}}";
    let template = compile(source);
    assert_eq!(template.warnings().len(), 1);
    assert_eq!(template.warnings()[0].code.as_deref(), Some("FV0015"));
    let before = template.warnings().to_vec();
    template.render(&json!({"xs": [1]})).unwrap();
    assert_eq!(template.warnings(), before.as_slice());
    let legacy = render_static(source, &json!({"xs": [1]}), Default::default()).unwrap();
    assert_eq!(legacy.warnings, before);
}

#[test]
fn legacy_invalid_context_still_reported_first() {
    let errors =
        render_static("{{ context.x.map(1) }}", &Value::Null, Default::default()).unwrap_err();
    assert_eq!(code(errors).as_deref(), Some("FV0021"));
}
