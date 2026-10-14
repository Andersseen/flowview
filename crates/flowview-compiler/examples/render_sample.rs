//! Prints one rendered page of the representative site fixture to stdout.
//!
//! Input for `scripts/measure-whitespace-compression.mjs`.
//! Run with
//! `cargo run --release -p flowview-compiler --example render_sample -- [paragraphs] [nav_items]`
//! (defaults: 40 paragraphs of trusted body HTML, 12 navigation items).

use flowview_compiler::{compile_static, StaticCompileOptions};
use serde_json::json;

const TEMPLATE: &str = include_str!("site-page.flow");

const WORDS: [&str; 16] = [
    "static", "template", "render", "context", "heading", "section", "docs", "route", "markup",
    "compile", "parse", "output", "layout", "anchor", "inline", "escape",
];

/// Deterministic, varied prose so compression is not flattered by repetition.
fn paragraph(n: usize) -> String {
    let mut state = n as u64 * 2_654_435_761 + 1;
    let mut words = Vec::new();
    for _ in 0..18 {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        words.push(WORDS[(state >> 33) as usize % WORDS.len()]);
    }
    format!(
        "<p>{} <code>item-{n}</code> <a href=\"/p/{n}/\">more</a>.</p>\n",
        words.join(" ")
    )
}

fn main() {
    let mut args = std::env::args().skip(1);
    let paragraphs: usize = args.next().map_or(40, |v| v.parse().expect("paragraphs"));
    let nav_items: usize = args.next().map_or(12, |v| v.parse().expect("nav items"));
    let template = compile_static(TEMPLATE, StaticCompileOptions::default()).expect("compiles");
    let body: String = (0..paragraphs).map(paragraph).collect();
    let html = template
        .render(&json!({
            "site": { "title": "Project docs" },
            "page": { "title": "Page 7", "route": "/page-7/", "body_html": body },
            "navigation": (0..nav_items).map(|i| json!({
                "title": format!("Section {i}"),
                "route": format!("/section-{i}/"),
                "current": i == 7,
                "aria_current": if i == 7 { json!("page") } else { json!(null) },
            })).collect::<Vec<_>>(),
            "headings": (0..6).map(|i| json!({ "href": format!("#h{i}"), "text": format!("Heading {i}") })).collect::<Vec<_>>(),
            "backlinks": (0..4).map(|i| json!({ "title": format!("Link {i}"), "route": format!("/l{i}/") })).collect::<Vec<_>>(),
        }))
        .expect("renders");
    print!("{html}");
}
