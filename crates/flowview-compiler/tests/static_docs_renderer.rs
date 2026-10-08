//! A documentation-site-shaped model rendered through the public static API.
//!
//! Proves that a host which precomputes every derived value (relative hrefs,
//! current-page flags, asset URLs) can drive a generic docs template with no
//! routing, asset or schema support in Flowview. Nothing here is specific to
//! any one consumer.

use flowview_compiler::{compile_static, CompiledStaticTemplate, StaticCompileOptions};
use serde_json::{json, Value};

const TEMPLATE: &str = include_str!("fixtures/site/docs-page.flow");

fn template() -> CompiledStaticTemplate {
    compile_static(
        TEMPLATE,
        StaticCompileOptions::default().with_filename("docs-page.flow"),
    )
    .expect("docs template compiles")
}

/// `prefix` is the host-computed relative path back to the site root
/// (`""`, `"../"`, `"../../"`, ...). Flowview never derives it.
fn context(prefix: &str) -> Value {
    json!({
        "site": { "title": "Project docs", "lang": "en", "root": format!("{prefix}index.html") },
        "assets": {
            "styles": format!("{prefix}assets/site.css"),
            // `<script>` elements are opaque to Flowview (see the spec), so the
            // host supplies the whole tag as trusted HTML.
            "script_tag": format!("<script src=\"{prefix}assets/site.js\"></script>"),
            "logo": format!("{prefix}assets/logo.svg"),
        },
        "page": {
            "title": "Guide",
            "canonical": format!("{prefix}guide/"),
            "source_path": "docs/guide.md",
            "role": "guide",
            "body_html": "<p>Body</p>",
        },
        "sidebar": [{
            "title": "Start",
            "items": [
                { "href": format!("{prefix}guide/"), "label": "Guide", "current": true, "aria_current": "page" },
                { "href": format!("{prefix}architecture/"), "label": "Architecture", "current": false, "aria_current": null },
            ],
        }],
        "headings": [{ "href": "#intro", "text": "Intro" }],
        "backlinks": [{ "href": format!("{prefix}index.html"), "label": "Home" }],
        "references": [{ "href": format!("{prefix}api/"), "label": "API" }],
    })
}

#[test]
fn host_prepared_relative_urls_render_unchanged_at_any_depth() {
    let t = template();
    for prefix in ["", "../", "../../", "../../../"] {
        let html = t.render(&context(prefix)).unwrap();
        for expected in [
            format!("<link rel=\"stylesheet\" href=\"{prefix}assets/site.css\"/>"),
            format!("<script src=\"{prefix}assets/site.js\"></script>"),
            format!("<img src=\"{prefix}assets/logo.svg\""),
            format!("<link rel=\"canonical\" href=\"{prefix}guide/\"/>"),
            format!("href=\"{prefix}architecture/\""),
            format!("href=\"{prefix}index.html\""),
        ] {
            assert!(
                html.contains(&expected),
                "{prefix:?}: missing {expected}\n{html}"
            );
        }
    }
}

#[test]
fn absolute_subpath_and_pathlike_values_are_not_rewritten() {
    let t = template();
    let mut ctx = context("");
    ctx["assets"]["styles"] = json!("/project/subpath/assets/site.css?v=1&b=2");
    ctx["page"]["canonical"] = json!("/project/subpath/guide/#top");
    let html = t.render(&ctx).unwrap();
    // `&` in a URL is attribute-escaped, everything else is untouched
    assert!(html.contains("href=\"/project/subpath/assets/site.css?v=1&amp;b=2\""));
    assert!(html.contains("href=\"/project/subpath/guide/#top\""));
}

#[test]
fn sidebar_sections_current_flags_and_optional_blocks() {
    let t = template();
    let html = t.render(&context("../")).unwrap();
    assert_eq!(html.matches("aria-current=\"page\"").count(), 1);
    assert!(html.contains("class=\"current\""));
    assert!(html.contains("data-source=\"docs/guide.md\""));
    assert!(html.contains("<p class=\"role\">guide</p>"));
    assert!(html.contains("<ol class=\"references\">"));

    let mut ctx = context("");
    ctx["sidebar"] = json!([]);
    ctx["backlinks"] = json!([]);
    ctx["references"] = json!([]);
    ctx["headings"] = json!([]);
    let bare = t.render(&ctx).unwrap();
    for absent in ["<nav", "backlinks", "references", "class=\"toc\""] {
        assert!(!bare.contains(absent), "{absent} should be omitted");
    }
}

#[test]
fn unicode_long_and_empty_values() {
    let t = template();
    let mut ctx = context("");
    let long = "Ж".repeat(10_000);
    ctx["page"]["title"] = json!(format!("Ünïcode ✓ 日本語 {long}"));
    ctx["page"]["source_path"] = json!("docs/日本語/ünï.md");
    ctx["sidebar"][0]["items"][1]["label"] = json!("アーキテクチャ");
    ctx["page"]["body_html"] = json!("");
    let html = t.render(&ctx).unwrap();
    assert!(html.contains("Ünïcode ✓ 日本語 "));
    assert!(html.contains(&long));
    assert!(html.contains("data-source=\"docs/日本語/ünï.md\""));
    assert!(html.contains("アーキテクチャ"));
    assert!(html.contains("<h1>Ünïcode"));
    assert!(!html.contains("<p>Body</p>"));
    assert!(html.contains("</h1>"), "{html}");
}

#[test]
fn large_and_deep_navigation() {
    let t = template();
    let mut ctx = context("");
    let sections: Vec<Value> = (0..50)
        .map(|s| {
            let items: Vec<Value> = (0..100)
                .map(|i| json!({
                    "href": format!("s{s}/p{i}/"),
                    "label": format!("Item {s}.{i}"),
                    "current": s == 49 && i == 99,
                    "aria_current": if s == 49 && i == 99 { json!("page") } else { Value::Null },
                }))
                .collect();
            json!({ "title": format!("Section {s}"), "items": items })
        })
        .collect();
    ctx["sidebar"] = Value::Array(sections);
    let html = t.render(&ctx).unwrap();
    assert_eq!(
        html.matches("<li><a href=\"s").count()
            + html.matches("<li><a class=\"current\" href=\"s").count(),
        5000
    );
    assert_eq!(html.matches("aria-current").count(), 1);
    assert!(html.contains("Item 49.99"));
}

#[test]
fn multiple_raw_fragments_in_one_template() {
    let t = compile_static(
        "<div>{{{ context.a }}}</div><div>{{{ context.b }}}</div>{{ context.a }}",
        Default::default(),
    )
    .unwrap();
    let html = t
        .render(&json!({ "a": "<b>1</b>", "b": "<i>2</i>" }))
        .unwrap();
    assert_eq!(
        html,
        "<div><b>1</b></div><div><i>2</i></div>&lt;b&gt;1&lt;/b&gt;"
    );
}

#[test]
fn hostile_values_in_every_escaped_position_stay_inert() {
    let t = template();
    let hostile = "\"><script>alert(1)</script><img src=x onerror=alert(1)>";
    let mut ctx = context("");
    ctx["site"]["title"] = json!(hostile);
    ctx["site"]["lang"] = json!(hostile);
    ctx["page"]["title"] = json!(hostile);
    ctx["page"]["source_path"] = json!(hostile);
    ctx["page"]["role"] = json!(hostile);
    ctx["assets"]["styles"] = json!(hostile);
    ctx["assets"]["logo"] = json!(hostile);
    ctx["sidebar"][0]["title"] = json!(hostile);
    ctx["sidebar"][0]["items"][0]["label"] = json!(hostile);
    ctx["sidebar"][0]["items"][0]["href"] = json!(hostile);
    ctx["backlinks"][0]["label"] = json!(hostile);
    ctx["references"][0]["href"] = json!(hostile);
    let html = t.render(&ctx).unwrap();
    assert!(!html.contains("<script>alert"), "{html}");
    assert!(!html.contains("<img src=x"), "{html}");
    // the only real <script> is the template's own asset tag
    assert_eq!(html.matches("<script").count(), 1);
}

#[test]
fn raw_body_is_the_only_unescaped_position() {
    let t = template();
    let mut ctx = context("");
    ctx["page"]["body_html"] = json!("<script>trusted()</script>");
    let html = t.render(&ctx).unwrap();
    assert!(html.contains("<script>trusted()</script>"));
    assert_eq!(html.matches("<script").count(), 2);
}

#[test]
fn rendering_is_deterministic_and_thread_safe_for_docs_pages() {
    let t = std::sync::Arc::new(template());
    let expected = t.render(&context("../")).unwrap();
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let t = std::sync::Arc::clone(&t);
            std::thread::spawn(move || t.render(&context("../")).unwrap())
        })
        .collect();
    for h in handles {
        assert_eq!(h.join().unwrap(), expected);
    }
}

#[test]
fn script_elements_are_opaque_not_interpolated() {
    // Locks the documented behaviour: nothing inside (or on) a `<script>`
    // element is evaluated, so hosts must pass such tags as trusted HTML.
    let t = compile_static(
        "<script src=\"{{ context.x }}\">{{ context.x }}</script>",
        Default::default(),
    )
    .unwrap();
    assert_eq!(
        t.render(&json!({ "x": "a" })).unwrap(),
        "<script src=\"{{ context.x }}\">{{ context.x }}</script>"
    );
}
