#!/usr/bin/env bash
# Reproducible native-binary footprint of the static API.
#
# Builds crates/flowview-compiler/examples/static_consumer.rs with a fixed,
# size-conscious release configuration and prints the dependency count and the
# stripped binary size. Evidence only: nothing is asserted.
set -euo pipefail
cd "$(dirname "$0")/.."

export CARGO_PROFILE_RELEASE_OPT_LEVEL="${CARGO_PROFILE_RELEASE_OPT_LEVEL:-3}"
export CARGO_PROFILE_RELEASE_LTO=true
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
export CARGO_PROFILE_RELEASE_STRIP=true
export CARGO_PROFILE_RELEASE_PANIC=abort

cargo build --release --locked -p flowview-compiler --example static_consumer
target_dir="$(cargo metadata --no-deps --format-version 1 --locked |
  python3 -c "import json,sys; print(json.load(sys.stdin)['target_directory'])")"
bin="$target_dir/release/examples/static_consumer"
[ -f "$bin" ] || bin="$bin.exe"

echo "flowview-compiler: $(cargo metadata --no-deps --format-version 1 --locked |
  python3 -c "import json,sys; print(next(p['version'] for p in json.load(sys.stdin)['packages'] if p['name']=='flowview-compiler'))")"
echo "oxc_parser:        $(cargo tree -p flowview-compiler --locked -i oxc_parser --depth 0 | head -1)"
echo "normal deps:       $(cargo tree -p flowview-compiler --locked -e normal --prefix none | sort -u | wc -l | tr -d ' ') crates (incl. itself)"
echo "binary bytes:      $(wc -c <"$bin" | tr -d ' ')"
