use flowview_static_runtime::Template;
use serde::Serialize;

const PAGE: &[u8] = include_bytes!("../page.flowview.json");

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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let template = Template::from_bytes(PAGE)?;
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
    Ok(())
}
