use serde_json::{json, Value};

use super::evaluator::{eval, lower, Scope, Val};
use super::{render_static, StaticRenderOptions};
use crate::Diagnostic;

fn render(source: &str, context: Value) -> String {
    render_static(source, &context, StaticRenderOptions::default())
        .unwrap()
        .html
}

fn render_err(source: &str, context: Value) -> Diagnostic {
    let errors = render_static(source, &context, StaticRenderOptions::default()).unwrap_err();
    errors.into_iter().next().unwrap()
}

fn evaluate(expression: &str, context: &Value) -> Result<Value, String> {
    let expr = lower(expression).map_err(|e| e.message)?;
    match eval(&expr, &Scope::new(context)).map_err(|e| e.message)? {
        Val::Undefined => Ok(Value::String("<undefined>".into())),
        Val::Json(v) => Ok(v.into_owned()),
    }
}

// --- renderer -------------------------------------------------------------

#[test]
fn plain_static_markup() {
    assert_eq!(
        render("<main><h1 id=\"a\">Hi</h1><br></main>", json!({})),
        "<main><h1 id=\"a\">Hi</h1><br/></main>"
    );
}

#[test]
fn interpolation_and_nested_member_access() {
    let ctx = json!({"user": {"name": "Ada", "age": 36}, "ok": true, "gone": null});
    assert_eq!(
        render(
            "<p>{{ context.user.name }} {{ context.user.age }} {{ context.ok }}[{{ context.gone }}][{{ context.missing }}]</p>",
            ctx
        ),
        "<p>Ada 36 true[][]</p>"
    );
}

#[test]
fn escapes_interpolated_text_and_attributes() {
    let ctx = json!({"t": "<b>\"x\" & 'y'</b>"});
    assert_eq!(
        render("<p>{{ context.t }}</p>", ctx.clone()),
        "<p>&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;</p>"
    );
    assert_eq!(
        render("<a title=\"{{ context.t }}\"></a>", ctx),
        "<a title=\"&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;\"></a>"
    );
}

#[test]
fn false_renders_empty_in_interpolation() {
    assert_eq!(render("[{{ context.f }}]", json!({"f": false})), "[]");
}

#[test]
fn if_else_if_else() {
    let tpl = "@if (context.n === 1) {one} @else if (context.n === 2) {two} @else {many}";
    assert_eq!(render(tpl, json!({"n": 1})), "one");
    assert_eq!(render(tpl, json!({"n": 2})), "two");
    assert_eq!(render(tpl, json!({"n": 3})), "many");
}

#[test]
fn for_with_empty_and_missing_collection() {
    let tpl = "@for (i of context.xs) {<i>{{ i }}</i>} @empty {none}";
    assert_eq!(render(tpl, json!({"xs": [1, "b"]})), "<i>1</i><i>b</i>");
    assert_eq!(render(tpl, json!({"xs": []})), "none");
    assert_eq!(render(tpl, json!({"xs": null})), "none");
    assert_eq!(render(tpl, json!({})), "none");
}

#[test]
fn track_is_accepted_and_warned() {
    let out = render_static(
        "@for (i of context.xs; track i) {{{ i }}}",
        &json!({"xs": [1, 2]}),
        StaticRenderOptions::default(),
    )
    .unwrap();
    assert_eq!(out.html, "12");
    assert_eq!(out.warnings.len(), 1);
    assert_eq!(out.warnings[0].code.as_deref(), Some("FV0015"));
}

#[test]
fn nested_loops_resolve_lexical_locals() {
    let tpl = "@for (s of context.sections) {<h2>{{ s.title }}</h2>@for (p of s.pages) {<a href=\"{{ p.url }}\">{{ p.title }}</a>}}";
    let ctx = json!({"sections": [
        {"title": "A", "pages": [{"title": "a1", "url": "/a1"}]},
        {"title": "B", "pages": [{"title": "b1", "url": "/b1"}, {"title": "b2", "url": "/b2"}]}
    ]});
    assert_eq!(
        render(tpl, ctx),
        "<h2>A</h2><a href=\"/a1\">a1</a><h2>B</h2><a href=\"/b1\">b1</a><a href=\"/b2\">b2</a>"
    );
}

#[test]
fn shadowing_and_scope_cleanup() {
    let tpl = "@for (x of context.a) {@for (x of context.b) {{{ x }}}{{ x }}}";
    assert_eq!(render(tpl, json!({"a": ["o"], "b": ["i1", "i2"]})), "i1i2o");
    let diag = render_err("@for (x of context.a) {} {{ x }}", json!({"a": [1]}));
    assert_eq!(diag.code.as_deref(), Some("FV0017"));
}

#[test]
fn switch_case_default_without_fallthrough() {
    let tpl = "@switch (context.k) {@case ('a') {A}@case ('b') {B}@default {D}}";
    assert_eq!(render(tpl, json!({"k": "a"})), "A");
    assert_eq!(render(tpl, json!({"k": "b"})), "B");
    assert_eq!(render(tpl, json!({"k": "z"})), "D");
}

#[test]
fn dynamic_and_boolean_attributes() {
    let ctx = json!({"url": "/x?a=1&b=2", "off": true, "on": false, "nothing": null});
    assert_eq!(
        render(
            "<a href=\"{{ context.url }}\" title=\"{{ context.nothing }}\" [disabled]=\"context.off\" [hidden]=\"context.on\">x</a>",
            ctx
        ),
        "<a href=\"/x?a=1&amp;b=2\" title=\"\" disabled>x</a>"
    );
}

#[test]
fn attr_bindings() {
    let ctx = json!({"busy": false, "n": 3, "none": null});
    assert_eq!(
        render(
            "<div [attr.aria-busy]=\"context.busy\" [attr.data-n]=\"context.n\" [attr.data-x]=\"context.none\" [attr.data-y]=\"context.missing\"></div>",
            ctx
        ),
        "<div aria-busy=\"false\" data-n=\"3\"></div>"
    );
}

#[test]
fn class_bindings_merge_and_deduplicate() {
    let ctx = json!({"on": true, "off": false, "dyn": "b  c"});
    assert_eq!(
        render(
            "<p class=\"a b\" [class.on]=\"context.on\" [class.off]=\"context.off\" [class.a]=\"context.on\">x</p>",
            ctx.clone()
        ),
        "<p class=\"a b on\">x</p>"
    );
    assert_eq!(
        render(
            "<p id=\"i\" class=\"{{ context.dyn }}\" [class.a]=\"context.on\"></p>",
            ctx.clone()
        ),
        "<p class=\"b c a\" id=\"i\"></p>"
    );
    assert_eq!(
        render("<p class=\"x\" [class.off]=\"context.off\"></p>", ctx),
        "<p class=\"x\"></p>"
    );
}

#[test]
fn preserves_whitespace() {
    assert_eq!(
        render("  <p>\n  a {{ context.x }}  b\n</p>\n", json!({"x": 1})),
        "  <p>\n  a 1  b\n</p>\n"
    );
}

#[test]
fn nested_control_flow() {
    let tpl =
        "<ul>@for (i of context.items) {@if (i.show) {<li>{{ i.n }}</li>} @else {<li>-</li>}}</ul>";
    let ctx = json!({"items": [{"show": true, "n": 1}, {"show": false, "n": 2}]});
    assert_eq!(render(tpl, ctx), "<ul><li>1</li><li>-</li></ul>");
}

#[test]
fn generic_page_fixture() {
    let tpl = include_str!("../../tests/fixtures/static/page.flow");
    let ctx: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/static/page.json")).unwrap();
    let expected = include_str!("../../tests/fixtures/static/page.html");
    assert_eq!(render(tpl, ctx), expected);
}

// --- diagnostics ------------------------------------------------------------

#[test]
fn unsupported_expression_is_a_located_diagnostic() {
    let source = "<p>\n  {{ context.xs.map((x) => x) }}\n</p>";
    let d = render_err(source, json!({"xs": []}));
    assert_eq!(d.code.as_deref(), Some("FV0016"));
    assert_eq!(d.line, 2);
    assert!(d
        .message
        .contains("not supported by the static HTML target"));
    assert!(d.end > d.start);
}

#[test]
fn unsupported_expression_reported_even_in_untaken_branch() {
    let d = render_err("@if (false) {{{ context.f() }}}", json!({}));
    assert_eq!(d.code.as_deref(), Some("FV0016"));
}

#[test]
fn invalid_context_input() {
    let d = render_err("x", json!([1]));
    assert_eq!(d.code.as_deref(), Some("FV0021"));
}

#[test]
fn array_interpolation_is_rejected() {
    let d = render_err("{{ context.xs }}", json!({"xs": [1]}));
    assert_eq!(d.code.as_deref(), Some("FV0020"));
}

#[test]
fn non_array_iteration_is_rejected() {
    let d = render_err("@for (x of context.s) {a}", json!({"s": "abc"}));
    assert_eq!(d.code.as_deref(), Some("FV0019"));
}

#[test]
fn parse_errors_still_use_shared_parser_diagnostics() {
    let errors =
        render_static("{{ context. }}", &json!({}), StaticRenderOptions::default()).unwrap_err();
    assert_eq!(errors[0].code.as_deref(), Some("FV0011"));
}

// --- evaluator ----------------------------------------------------------------

#[test]
fn literals() {
    let c = json!({});
    assert_eq!(evaluate("null", &c), Ok(Value::Null));
    assert_eq!(evaluate("true", &c), Ok(json!(true)));
    assert_eq!(evaluate("'s'", &c), Ok(json!("s")));
    assert_eq!(evaluate("-2", &c), Ok(json!(-2.0)));
    assert_eq!(evaluate("(1)", &c), Ok(json!(1.0)));
}

#[test]
fn context_lookup_and_member_access() {
    let c = json!({"a": {"b": [10, 20]}, "s": "héllo"});
    assert_eq!(evaluate("context.a.b[1]", &c), Ok(json!(20)));
    assert_eq!(evaluate("context['a'].b.length", &c), Ok(json!(2)));
    assert_eq!(evaluate("context.s.length", &c), Ok(json!(5)));
    assert_eq!(evaluate("context.a.b[5]", &c), Ok(json!("<undefined>")));
    assert_eq!(evaluate("context.nope", &c), Ok(json!("<undefined>")));
}

#[test]
fn unknown_identifier() {
    let err = evaluate("window", &json!({})).unwrap_err();
    assert!(err.contains("Unresolved identifier `window`"));
}

#[test]
fn invalid_member_access() {
    let c = json!({"n": null, "num": 1});
    assert!(evaluate("context.missing.x", &c)
        .unwrap_err()
        .contains("Cannot read property `x` of undefined"));
    assert!(evaluate("context.n.x", &c).unwrap_err().contains("of null"));
    assert!(evaluate("context.num.x", &c)
        .unwrap_err()
        .contains("number value"));
}

#[test]
fn truthiness_and_logic() {
    let c = json!({"z": 0, "e": "", "arr": [], "o": {}, "n": null});
    for falsy in ["context.z", "context.e", "context.n", "context.missing"] {
        assert_eq!(
            evaluate(&format!("!{falsy}"), &c),
            Ok(json!(true)),
            "{falsy}"
        );
    }
    for truthy in ["context.arr", "context.o", "'0'", "1"] {
        assert_eq!(
            evaluate(&format!("!{truthy}"), &c),
            Ok(json!(false)),
            "{truthy}"
        );
    }
    assert_eq!(evaluate("context.z || 'x'", &c), Ok(json!("x")));
    assert_eq!(evaluate("context.z ?? 'x'", &c), Ok(json!(0)));
    assert_eq!(evaluate("context.n ?? 'x'", &c), Ok(json!("x")));
    assert_eq!(evaluate("context.missing ?? 'x'", &c), Ok(json!("x")));
    assert_eq!(evaluate("1 && 'y'", &c), Ok(json!("y")));
    assert_eq!(evaluate("context.z && context.missing.x", &c), Ok(json!(0)));
}

#[test]
fn comparisons() {
    let c = json!({"n": 3, "s": "b", "z": null});
    assert_eq!(evaluate("context.n === 3", &c), Ok(json!(true)));
    assert_eq!(evaluate("context.n !== 3", &c), Ok(json!(false)));
    assert_eq!(evaluate("context.n === '3'", &c), Ok(json!(false)));
    assert_eq!(
        evaluate("context.z == context.missing", &c),
        Ok(json!(true))
    );
    assert_eq!(
        evaluate("context.z === context.missing", &c),
        Ok(json!(false))
    );
    assert_eq!(evaluate("context.n > 2", &c), Ok(json!(true)));
    assert_eq!(evaluate("context.n <= 2", &c), Ok(json!(false)));
    assert_eq!(evaluate("context.s < 'c'", &c), Ok(json!(true)));
    assert!(evaluate("context.n < 'c'", &c)
        .unwrap_err()
        .contains("Cannot compare"));
    assert!(evaluate("context.n == '3'", &c)
        .unwrap_err()
        .contains("coercion"));
    assert!(evaluate("context.o === context.o", &json!({"o": {}}))
        .unwrap_err()
        .contains("by reference"));
}

#[test]
fn unsupported_forms_are_rejected_with_reason() {
    for (expr, reason) in [
        ("context.f()", "function calls"),
        ("context.a.filter((x) => x).length", "function calls"),
        ("(x) => x", "functions"),
        ("context.a ? 1 : 2", "ternary"),
        ("`x${context.a}`", "template literals"),
        ("context?.a", "optional chaining"),
        ("context.a + 1", "binary operator `+`"),
        ("typeof context", "unary operator `typeof`"),
        ("context[context.k]", "computed member access"),
        ("[1]", "array and object literals"),
    ] {
        let err = lower(expr).unwrap_err().message;
        assert!(err.contains("static HTML target"), "{expr}: {err}");
        assert!(err.contains(reason), "{expr}: {err}");
    }
}
