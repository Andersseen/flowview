use flowview_compiler::{compile_static, StaticCompileOptions};
use serde::Serialize;

const SOURCE: &str = include_str!("../../aot-consumer/page.flow");

#[derive(Serialize)]
struct NavigationItem {
    label: String,
    href: String,
    active: bool,
}

#[derive(Serialize)]
struct Page {
    title: String,
    description: String,
    body_html: String,
    navigation: Vec<NavigationItem>,
}

fn main() {
    let template = compile_static(
        SOURCE,
        StaticCompileOptions::default().with_filename("pages/page.flow"),
    )
    .expect("template compiles");
    let page = Page {
        title: "FlowView & Rust".into(),
        description: "Precompiled documentation".into(),
        body_html: "<p>trusted body</p>".into(),
        navigation: vec![NavigationItem {
            label: "Home".into(),
            href: "/".into(),
            active: true,
        }],
    };
    let html = template
        .render_serializable(&page)
        .expect("the example page context renders");
    assert!(html.contains("FlowView &amp; Rust"));
    assert!(html.contains("<p>trusted body</p>"));
    assert!(html.contains("class=\"active\""));
    println!("{html}");
}
