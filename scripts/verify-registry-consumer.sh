#!/usr/bin/env bash
# Registry-consumer smoke: build a throwaway project that depends on the exact
# published flowview-compiler version from crates.io (no path, git or workspace
# dependency) and exercise compile_static + CompiledStaticTemplate::render.
#
#   scripts/verify-registry-consumer.sh [version]   # default: workspace version
#
# Env: MAX_ATTEMPTS (default 12) and SLEEP_SECONDS (default 10) bound retries
# while the crate download CDN catches up with the index.
# FLOWVIEW_SMOKE_PATCH_DIR exists only to self-test this script before a
# release (it patches crates-io with a checkout); the release workflow never
# sets it, and the script then refuses to run against anything but the registry.
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_ATTEMPTS="${MAX_ATTEMPTS:-12}"
SLEEP_SECONDS="${SLEEP_SECONDS:-10}"

version="${1:-$(cargo metadata --no-deps --format-version 1 --locked |
  python3 -c "import json,sys; print(next(p['version'] for p in json.load(sys.stdin)['packages'] if p['name']=='flowview-compiler'))")}"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/src"

cat >"$dir/Cargo.toml" <<TOML
[package]
name = "flowview-registry-smoke"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
flowview-compiler = "=$version"
serde_json = "1"

[workspace]
TOML

if [ -n "${FLOWVIEW_SMOKE_PATCH_DIR:-}" ]; then
  printf '\n[patch.crates-io]\nflowview-compiler = { path = "%s" }\n' "$FLOWVIEW_SMOKE_PATCH_DIR" >>"$dir/Cargo.toml"
elif grep -Eq '(^|[^a-z_])(path|git)[[:space:]]*=' "$dir/Cargo.toml"; then
  echo "error: smoke manifest must depend on the registry only." >&2
  exit 1
fi

cat >"$dir/src/main.rs" <<'RS'
use flowview_compiler::{compile_static, StaticCompileOptions};
use serde_json::json;

fn main() {
    let template = compile_static(
        "<h1>{{ context.title }}</h1>{{{ context.body_html }}}",
        StaticCompileOptions::default().with_filename("smoke.flow"),
    )
    .expect("template compiles");
    let context = json!({ "title": "A & <B>", "body_html": "<p>trusted</p>" });
    let html = template.render(&context).expect("context renders");
    assert_eq!(html, "<h1>A &amp; &lt;B&gt;</h1><p>trusted</p>");
    let typed = template.render_serializable(&context).expect("serializable renders");
    assert_eq!(typed, html);
    println!("registry smoke ok: {html}");
}
RS

attempt=1
until (cd "$dir" && cargo run --quiet); do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "error: registry consumer smoke for flowview-compiler =$version failed after $attempt attempts." >&2
    exit 1
  fi
  echo "Registry consumer build failed (attempt $attempt/$MAX_ATTEMPTS); retrying in ${SLEEP_SECONDS}s..." >&2
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done
if [ -n "${FLOWVIEW_SMOKE_PATCH_DIR:-}" ]; then
  echo "self-test only: flowview-compiler =$version built from a local patch, NOT verified from the registry."
else
  echo "flowview-compiler =$version verified from the registry."
fi
