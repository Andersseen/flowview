//! Repeated-render workload for the native static backend.
//!
//! Run with `cargo run --release -p flowview-compiler --example bench_static`.
//! Prints wall-clock timings only; nothing here is asserted in tests.

use std::time::Instant;

use flowview_compiler::{compile_static, render_static, StaticCompileOptions};
use serde_json::{json, Value};

const TEMPLATE: &str = include_str!("../tests/fixtures/site/page.flow");

fn page(n: usize) -> Value {
    json!({
        "site": { "title": "Project docs" },
        "page": {
            "title": format!("Page {n}"),
            "route": format!("/page-{n}/"),
            "body_html": "<p>Trusted pre-rendered content.</p>".repeat(40),
        },
        "navigation": (0..12).map(|i| json!({
            "title": format!("Section {i}"),
            "route": format!("/section-{i}/"),
            "current": i == n % 12,
            "aria_current": if i == n % 12 { json!("page") } else { Value::Null },
        })).collect::<Vec<_>>(),
        "headings": (0..6).map(|i| json!({ "href": format!("#h{i}"), "text": format!("Heading {i}") })).collect::<Vec<_>>(),
        "backlinks": (0..4).map(|i| json!({ "title": format!("Link {i}"), "route": format!("/l{i}/") })).collect::<Vec<_>>(),
    })
}

fn main() {
    let start = Instant::now();
    let template = compile_static(TEMPLATE, StaticCompileOptions::default()).unwrap();
    println!("compile once: {:?}", start.elapsed());

    for pages in [10usize, 100, 1000] {
        let contexts: Vec<Value> = (0..pages).map(page).collect();

        let start = Instant::now();
        let mut bytes = 0;
        for c in &contexts {
            bytes += template.render(c).unwrap().len();
        }
        let compiled = start.elapsed();

        let start = Instant::now();
        for c in &contexts {
            bytes += render_static(TEMPLATE, c, Default::default())
                .unwrap()
                .html
                .len();
        }
        let one_shot = start.elapsed();

        println!(
            "{pages:>5} pages: compile-once+render {compiled:>10.2?} ({:.1?}/page) | render_static x N {one_shot:>10.2?} ({:.1?}/page) | {} KiB",
            compiled / pages as u32,
            one_shot / pages as u32,
            bytes / 2 / 1024
        );
    }
}
