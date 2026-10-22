#!/usr/bin/env bash
# Verify a runtime-only consumer against the exact source extracted from the
# Cargo package archive. This is candidate package evidence, not registry proof.
set -euo pipefail
cd "$(dirname "$0")/.."

name=flowview-static-runtime
version="$(cargo metadata --no-deps --format-version 1 --locked |
  python3 -c "import json,sys; print(next(p['version'] for p in json.load(sys.stdin)['packages'] if p['name']=='flowview-static-runtime'))")"
archive="target/package/$name-$version.crate"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cargo package -p "$name" --locked --no-verify --offline
test -f "$archive" || { echo "error: cargo package did not produce $archive" >&2; exit 1; }

contents="$(tar -tzf "$archive")"
for required in "$name-$version/Cargo.toml" "$name-$version/README.md" "$name-$version/LICENSE" "$name-$version/src/lib.rs"; do
  grep -Fqx "$required" <<<"$contents" || { echo "error: package archive is missing $required" >&2; exit 1; }
done
if grep -E "^$name-$version/(target|node_modules|tests)/|(^|/)\.env" <<<"$contents"; then
  echo "error: package archive contains excluded or local-only files" >&2
  exit 1
fi

mkdir -p "$tmp/package" "$tmp/consumer/src"
tar -xzf "$archive" -C "$tmp/package"
if grep -E '^(\[dependencies\]|\[build-dependencies\]|\[dev-dependencies\])' "$tmp/package/$name-$version/Cargo.toml" >/dev/null &&
  grep -E '(^|[[:space:]])(path|git|workspace)[[:space:]]*=' "$tmp/package/$name-$version/Cargo.toml"; then
  echo 'error: packaged runtime manifest retains a path, git, or workspace dependency.' >&2
  exit 1
fi
cp examples/aot-consumer/page.flowview.json "$tmp/consumer/src/page.flowview.json"
cp Cargo.lock "$tmp/consumer/Cargo.lock"

cat >"$tmp/consumer/Cargo.toml" <<TOML
[package]
name = "flowview-aot-packaged-smoke"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
flowview-static-runtime = { path = "../package/$name-$version" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[workspace]
TOML

cat >"$tmp/consumer/src/main.rs" <<'RS'
use flowview_static_runtime::Template;
use serde::Serialize;

#[derive(Serialize)]
struct Context {
    title: String,
    description: String,
    body_html: String,
    navigation: Vec<Navigation>,
}

#[derive(Serialize)]
struct Navigation {
    href: String,
    active: bool,
    label: String,
}

fn main() {
    let bytes = include_bytes!("page.flowview.json");
    let template = Template::from_bytes(bytes).expect("packaged runtime loads AOT artifact");
    let context = Context {
        title: "A & <B> — 東京".into(),
        description: "Résumé & notes".into(),
        body_html: "<b>trusted ✓</b>".into(),
        navigation: vec![Navigation {
            href: "/café?a=1&b=2".into(),
            active: true,
            label: "Accueil 東京".into(),
        }],
    };
    let serialized = template.render_serializable(&context).expect("typed context renders");
    let native = template
        .render(&serde_json::to_value(&context).unwrap())
        .expect("native JSON context renders");
    assert_eq!(serialized, native, "both public context APIs are stable");
    assert_eq!(serialized, template.render_serializable(&context).unwrap());
    assert!(serialized.contains("A &amp; &lt;B&gt; — 東京"));
    assert!(serialized.contains("Résumé &amp; notes"));
    assert!(serialized.contains("href=\"/café?a=1&amp;b=2\""));
    assert!(serialized.contains("Accueil 東京"));
    assert!(serialized.contains("<b>trusted ✓</b>"));

    let mut unsupported: serde_json::Value = serde_json::from_slice(bytes).unwrap();
    unsupported["format_version"] = serde_json::json!(u16::MAX);
    let error = Template::from_bytes(&serde_json::to_vec(&unsupported).unwrap()).unwrap_err();
    assert!(error.to_string().contains("unsupported FlowView static artifact format version"));
    let error = Template::from_bytes(b"not json").unwrap_err();
    assert!(error.to_string().contains("invalid FlowView static artifact"));
}
RS

echo "Inspecting Cargo dependency tree for extracted package consumer..."
(cd "$tmp/consumer" && cargo generate-lockfile --offline)
tree="$(cd "$tmp/consumer" && cargo tree -e normal,build --locked --offline)"
printf '%s\n' "$tree"
if grep -E 'flowview-compiler|oxc_[[:alnum:]_-]+' <<<"$tree"; then
  echo 'error: packaged runtime consumer unexpectedly depends on compiler/Oxc.' >&2
  exit 1
fi

echo "Building external consumer from extracted $name $version package source..."
(cd "$tmp/consumer" && cargo run --locked --offline --quiet)
echo "$name $version packaged-consumer verification passed (local Cargo archive; not registry verification)."
