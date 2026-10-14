//! Minimal native consumer of the static API, used to measure the binary
//! footprint of `flowview-compiler` (see `scripts/measure-static-footprint.sh`).
//!
//! Run with `cargo run --release -p flowview-compiler --example static_consumer`.

use flowview_compiler::{compile_static, StaticCompileOptions};
use serde_json::json;

const TEMPLATE: &str = include_str!("site-page.flow");

fn main() {
    let template = compile_static(
        TEMPLATE,
        StaticCompileOptions::default().with_filename("page.flow"),
    )
    .expect("template compiles");
    let html = template
        .render(&json!({
            "site": { "title": "Project docs" },
            "page": { "title": "Home", "route": "/", "body_html": "<p>Hi</p>" },
            "navigation": [{ "title": "Home", "route": "/", "current": true, "aria_current": "page" }],
            "headings": [],
            "backlinks": [],
        }))
        .expect("context renders");
    println!("{}", html.len());
}
