//! External-consumer tests for the native static backend.
//!
//! Everything here uses only the public `flowview_compiler` API plus
//! `serde`/`serde_json`, exactly as an embedding Rust tool would. No Node,
//! JavaScript runtime, browser or WASM is involved.

use std::sync::Arc;
use std::thread;

use flowview_compiler::{
    compile_static, render_static, CompiledStaticTemplate, Diagnostic, DiagnosticFormatter,
    DiagnosticSeverity, StaticCompileOptions,
};
use serde::Serialize;
use serde_json::{json, Value};

const PAGE_TEMPLATE: &str = include_str!("fixtures/site/page.flow");

#[derive(Serialize)]
struct Site {
    title: String,
}

#[derive(Serialize)]
struct Page {
    title: String,
    route: String,
    body_html: String,
}

#[derive(Serialize)]
struct NavItem {
    title: String,
    route: String,
    current: bool,
    aria_current: Option<&'static str>,
}

#[derive(Serialize)]
struct Heading {
    href: String,
    text: String,
}

#[derive(Serialize)]
struct Backlink {
    title: String,
    route: String,
}

#[derive(Serialize)]
struct PageModel {
    site: Site,
    page: Page,
    navigation: Vec<NavItem>,
    headings: Vec<Heading>,
    backlinks: Vec<Backlink>,
}

fn model(n: usize) -> PageModel {
    let titles = ["Architecture", "Guide", "Reference"];
    PageModel {
        site: Site {
            title: "Project docs".into(),
        },
        page: Page {
            title: format!("Page {n} <&>"),
            route: format!("/page-{n}/"),
            body_html: format!("<p>Trusted pre-rendered content {n}.</p>"),
        },
        navigation: titles
            .iter()
            .enumerate()
            .map(|(i, title)| NavItem {
                title: (*title).into(),
                route: format!("/{}/", title.to_lowercase()),
                current: i == n % 3,
                aria_current: (i == n % 3).then_some("page"),
            })
            .collect(),
        headings: if n.is_multiple_of(2) {
            vec![Heading {
                href: "#intro".into(),
                text: "Intro".into(),
            }]
        } else {
            vec![]
        },
        backlinks: if n.is_multiple_of(3) {
            vec![Backlink {
                title: "Home".into(),
                route: "/".into(),
            }]
        } else {
            vec![]
        },
    }
}

fn value(n: usize) -> Value {
    serde_json::to_value(model(n)).unwrap()
}

fn template() -> CompiledStaticTemplate {
    compile_static(
        PAGE_TEMPLATE,
        StaticCompileOptions::default().with_filename("page.flow"),
    )
    .expect("page template compiles")
}

#[test]
fn static_site_page_renders_final_html() {
    let html = template().render(&value(3)).unwrap();

    assert!(html.starts_with("<!doctype html>"));
    assert!(html.contains("<title>Page 3 &lt;&amp;&gt; · Project docs</title>"));
    assert!(html.contains("<link rel=\"canonical\" href=\"/page-3/\"/>"));
    // trusted body is verbatim, titles are escaped
    assert!(html.contains("<p>Trusted pre-rendered content 3.</p>"));
    assert!(html.contains("<h1>Page 3 &lt;&amp;&gt;</h1>"));
    // class + attribute bindings: item 0 is current for n = 3
    assert!(html.contains("class=\"current\""));
    assert!(html.contains("aria-current=\"page\""));
    assert_eq!(html.matches("aria-current").count(), 1);
    // optional sections: n = 3 has backlinks but no headings
    assert!(html.contains("Linked from") && !html.contains("class=\"toc\""));
    // final HTML carries no Flowview runtime or hydration
    assert!(!html.contains("@flowview") && !html.contains("<script"));
    assert!(!html.contains("data-flow"));
}

#[test]
fn optional_sections_follow_the_model() {
    let t = template();
    let with_toc = t.render(&value(2)).unwrap();
    assert!(with_toc.contains("class=\"toc\"") && with_toc.contains("href=\"#intro\""));
    assert!(!with_toc.contains("Linked from"));

    let neither = t.render(&value(1)).unwrap();
    assert!(!neither.contains("class=\"toc\"") && !neither.contains("Linked from"));
}

#[test]
fn empty_navigation_uses_the_empty_branch() {
    let mut ctx = value(1);
    ctx["navigation"] = json!([]);
    assert!(template()
        .render(&ctx)
        .unwrap()
        .contains("<span>No pages</span>"));
}

#[test]
fn compile_once_render_one_hundred_contexts_deterministically() {
    let t = template();
    let first: Vec<String> = (0..100).map(|n| t.render(&value(n)).unwrap()).collect();
    let second: Vec<String> = (0..100).map(|n| t.render(&value(n)).unwrap()).collect();
    assert_eq!(first, second, "rendering must be deterministic");

    for (n, html) in first.iter().enumerate() {
        assert!(html.contains(&format!("/page-{n}/")), "page {n}");
        // no state leaks between renders of different contexts
        let other = (n + 1) % 100;
        assert!(!html.contains(&format!("content {other}.")), "page {n}");
    }
}

#[test]
fn rendering_the_same_context_repeatedly_is_stable() {
    let t = template();
    let ctx = value(4);
    let expected = t.render(&ctx).unwrap();
    for _ in 0..50 {
        assert_eq!(t.render(&ctx).unwrap(), expected);
    }
}

#[test]
fn one_shot_and_compiled_rendering_agree() {
    let ctx = value(5);
    let one_shot = render_static(PAGE_TEMPLATE, &ctx, Default::default()).unwrap();
    assert_eq!(one_shot.html, template().render(&ctx).unwrap());
    assert_eq!(one_shot.warnings, template().warnings());
}

#[test]
fn compiled_template_renders_in_parallel() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<CompiledStaticTemplate>();

    let t = Arc::new(template());
    let expected: Vec<String> = (0..64).map(|n| t.render(&value(n)).unwrap()).collect();

    let handles: Vec<_> = (0..8)
        .map(|worker| {
            let t = Arc::clone(&t);
            thread::spawn(move || {
                (0..64)
                    .filter(|n| n % 8 == worker)
                    .map(|n| (n, t.render(&value(n)).unwrap()))
                    .collect::<Vec<_>>()
            })
        })
        .collect();

    for handle in handles {
        for (n, html) in handle.join().unwrap() {
            assert_eq!(html, expected[n], "page {n}");
        }
    }
}

// --- security: escaped vs trusted ------------------------------------------

const HOSTILE: &str = "<script>alert(1)</script><img src=x onerror=alert(1)> \"q\" 'a' & <b>";

#[test]
fn escaped_interpolation_neutralises_hostile_values() {
    let html = compile_static(
        "<p>{{ context.v }}</p><a title=\"{{ context.v }}\">x</a>",
        Default::default(),
    )
    .unwrap()
    .render(&json!({ "v": HOSTILE }))
    .unwrap();
    assert!(!html.contains("<script") && !html.contains("<img") && !html.contains("<b>"));
    assert!(html.contains("&lt;script&gt;") && html.contains("&quot;q&quot;"));
    assert!(html.contains("&#39;a&#39;") && html.contains("&amp;"));
    // attribute context cannot be broken out of
    assert_eq!(html.matches("title=\"").count(), 1);
}

#[test]
fn raw_interpolation_is_verbatim_and_never_auto_detected() {
    let t = compile_static("[{{{ context.v }}}][{{ context.v }}]", Default::default()).unwrap();
    let html = t.render(&json!({ "v": HOSTILE })).unwrap();
    assert!(html.starts_with(&format!("[{HOSTILE}][")));
    // the same value through `{{ }}` stays escaped in the same template
    assert!(html.ends_with("&#39;a&#39; &amp; &lt;b&gt;]"));
}

#[test]
fn raw_value_type_contract() {
    let t = compile_static("[{{{ context.v }}}]", Default::default()).unwrap();
    for (v, out) in [
        (json!("<i>x</i>"), "[<i>x</i>]"),
        (json!(""), "[]"),
        (json!(null), "[]"),
        (json!(false), "[]"),
    ] {
        assert_eq!(t.render(&json!({ "v": v })).unwrap(), out);
    }
    assert_eq!(
        t.render(&json!({})).unwrap(),
        "[]",
        "undefined renders empty"
    );

    for bad in [json!(1), json!(true), json!([1]), json!({"a": 1})] {
        let errors = t.render(&json!({ "v": bad })).unwrap_err();
        assert_eq!(errors[0].code.as_deref(), Some("FV0025"));
    }
}

// --- diagnostics for embedding compilers -----------------------------------

fn assert_located(d: &Diagnostic, code: &str, source: &str) {
    assert_eq!(d.code.as_deref(), Some(code), "{d:?}");
    assert_eq!(d.severity, DiagnosticSeverity::Error);
    assert!(!d.message.is_empty());
    assert!(d.line >= 1 && d.column >= 1, "{d:?}");
    assert!(d.start <= d.end && d.end <= source.len(), "{d:?}");
}

#[test]
fn compile_time_diagnostics_are_structured() {
    let unsupported = "<p>{{ context.f(1) }}</p>";
    let errors = compile_static(unsupported, Default::default()).unwrap_err();
    assert_located(&errors[0], "FV0016", unsupported);
    assert_eq!(errors[0].line, 1);

    let invalid_js = "<p>{{ context.a + }}</p>";
    let errors = compile_static(invalid_js, Default::default()).unwrap_err();
    assert!(errors[0].code.is_some());
    assert_located(
        &errors[0],
        errors[0].code.clone().unwrap().as_str(),
        invalid_js,
    );

    let bad_syntax = "<div>\n  @if (context.a {\n</div>";
    let errors = compile_static(bad_syntax, Default::default()).unwrap_err();
    assert!(!errors.is_empty());
    assert!(errors[0].line >= 1 && errors[0].end <= bad_syntax.len());
}

#[test]
fn render_time_diagnostics_are_structured() {
    let cases: [(&str, Value, &str); 4] = [
        ("<p>{{ nope }}</p>", json!({}), "FV0017"),
        ("<p>{{ context.a.b }}</p>", json!({"a": 1}), "FV0018"),
        (
            "@for (x of context.a; track x) {<i></i>}",
            json!({"a": 5}),
            "FV0019",
        ),
        ("<p>{{{ context.a }}}</p>", json!({"a": 5}), "FV0025"),
    ];
    for (source, ctx, code) in cases {
        let t = compile_static(source, Default::default()).unwrap();
        let errors = t.render(&ctx).unwrap_err();
        assert_located(&errors[0], code, source);
    }
}

#[test]
fn invalid_context_is_a_diagnostic_not_a_panic() {
    let t = compile_static("<p></p>", Default::default()).unwrap();
    for ctx in [json!(null), json!([1]), json!("s"), json!(3)] {
        let errors = t.render(&ctx).unwrap_err();
        assert_eq!(errors[0].code.as_deref(), Some("FV0021"));
    }
}

#[test]
fn diagnostics_format_with_the_callers_display_name() {
    let source = "<p>{{ context.f(1) }}</p>";
    let options = StaticCompileOptions::default().with_filename("docs/page.flow");
    let filename = options.filename.clone().unwrap();
    let errors = compile_static(source, options).unwrap_err();

    let human = DiagnosticFormatter::new(&errors, &filename, 0).format_human();
    assert!(human.contains("docs/page.flow:1:"), "{human}");
    let json: Value =
        serde_json::from_str(&DiagnosticFormatter::new(&errors, &filename, 0).format_json())
            .unwrap();
    assert!(json.to_string().contains("FV0016"));
}
