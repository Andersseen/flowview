use flowview_static_runtime::Template;
use serde::Serialize;
use serde_json::json;
use std::time::Instant;

const BYTES: &[u8] = include_bytes!("../../page.flowview.json");
const LOADS: usize = 500;
const RENDERS: usize = 10_000;

#[derive(Serialize)]
struct Item {
    label: String,
    href: String,
    active: bool,
}
#[derive(Serialize)]
struct Page {
    title: String,
    description: String,
    body_html: String,
    navigation: Vec<Item>,
}

fn main() {
    let start = Instant::now();
    let mut last = None;
    for _ in 0..LOADS {
        last = Some(Template::from_bytes(BYTES).unwrap());
    }
    let load = start.elapsed();
    let template = last.unwrap();
    let context = json!({
        "title": "FlowView & Rust",
        "description": "AOT measurement",
        "body_html": "<p>trusted</p>",
        "navigation": [{"label":"Home","href":"/","active":true}]
    });
    let start = Instant::now();
    for _ in 0..RENDERS {
        std::hint::black_box(template.render(&context).unwrap());
    }
    let render = start.elapsed();
    let page = Page {
        title: "FlowView & Rust".into(),
        description: "AOT measurement".into(),
        body_html: "<p>trusted</p>".into(),
        navigation: vec![Item {
            label: "Home".into(),
            href: "/".into(),
            active: true,
        }],
    };
    let start = Instant::now();
    for _ in 0..RENDERS {
        std::hint::black_box(template.render_serializable(&page).unwrap());
    }
    let serializable = start.elapsed();
    println!(
        "load/prepare: {:?} total, {:?}/template",
        load,
        load / LOADS as u32
    );
    println!(
        "render: {:?} total, {:?}/render",
        render,
        render / RENDERS as u32
    );
    println!(
        "render_serializable: {:?} total, {:?}/render",
        serializable,
        serializable / RENDERS as u32
    );
}
