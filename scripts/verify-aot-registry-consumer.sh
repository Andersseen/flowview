#!/usr/bin/env bash
# Build a runtime-only AOT consumer against the exact registry crate version.
# FLOWVIEW_AOT_SMOKE_PATCH_DIR is reserved for local script self-tests and is
# never set by the release workflow.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-$(cargo metadata --no-deps --format-version 1 --locked |
  python3 -c "import json,sys; print(next(p['version'] for p in json.load(sys.stdin)['packages'] if p['name']=='flowview-static-runtime'))") }"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/src"
cp examples/aot-consumer/page.flowview.json "$dir/src/page.flowview.json"

cat >"$dir/Cargo.toml" <<TOML
[package]
name = "flowview-aot-registry-smoke"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"

TOML

if [ -n "${FLOWVIEW_AOT_SMOKE_PATCH_DIR:-}" ]; then
  printf 'flowview-static-runtime = { path = "%s" }\n' "$FLOWVIEW_AOT_SMOKE_PATCH_DIR" >>"$dir/Cargo.toml"
else
  printf 'flowview-static-runtime = "=%s"\n' "$version" >>"$dir/Cargo.toml"
fi
printf '\n[workspace]\n' >>"$dir/Cargo.toml"

cat >"$dir/src/main.rs" <<'RS'
use flowview_static_runtime::Template;
use serde::Serialize;

#[derive(Serialize)]
struct Context {
    title: String,
    description: String,
    body_html: String,
    navigation: Vec<serde_json::Value>,
}

fn main() {
    let bytes = include_bytes!("page.flowview.json");
    let template = Template::from_bytes(bytes).expect("precompiled artifact loads");
    let context = Context {
        title: "registry & smoke".into(),
        description: "".into(),
        body_html: "<b>trusted</b>".into(),
        navigation: vec![],
    };
    let html = template.render_serializable(&context).expect("context renders");
    assert!(html.contains("registry &amp; smoke"));
    assert!(html.contains("<b>trusted</b>"));
}
RS

if (cd "$dir" && cargo run --quiet); then
  if [ -n "${FLOWVIEW_AOT_SMOKE_PATCH_DIR:-}" ]; then
    echo "self-test only: flowview-static-runtime =$version built from a local patch, NOT verified from the registry."
  else
    echo "flowview-static-runtime =$version AOT consumer verified from the registry."
  fi
else
  echo "error: runtime-only AOT consumer failed for flowview-static-runtime =$version." >&2
  exit 1
fi
