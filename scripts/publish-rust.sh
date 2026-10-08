#!/usr/bin/env bash
# Publish flowview-compiler, wait until the exact version resolves in the
# crates.io sparse index, then publish flowview-cli.
#
# Safe to rerun: a crate version that is already public is verified against
# the local package checksum and skipped instead of republished. A checksum
# mismatch fails the run (crates.io versions are immutable; bump the version).
#
# Needs CARGO_REGISTRY_TOKEN (read by cargo). Never echoes it.
# Env: INDEX_URL (default https://index.crates.io), MAX_ATTEMPTS (30), SLEEP_SECONDS (10).
set -euo pipefail

INDEX_URL="${INDEX_URL:-https://index.crates.io}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_SECONDS="${SLEEP_SECONDS:-10}"

crate_version() {
  cargo metadata --no-deps --format-version 1 --locked |
    python3 -c "import json,sys; n=sys.argv[1]; print(next(p['version'] for p in json.load(sys.stdin)['packages'] if p['name']==n))" "$1"
}

index_path() {
  local n="$1"
  case ${#n} in
    1) echo "1/$n" ;;
    2) echo "2/$n" ;;
    3) echo "3/${n:0:1}/$n" ;;
    *) echo "${n:0:2}/${n:2:2}/$n" ;;
  esac
}

# Prints the index checksum for name@version; empty if not (yet) public.
public_checksum() {
  local name="$1" version="$2" body
  body="$(curl -fsS --retry 2 "$INDEX_URL/$(index_path "$name")" 2>/dev/null || true)"
  [ -n "$body" ] || return 0
  printf '%s\n' "$body" | python3 -c "
import json,sys
for line in sys.stdin:
    line=line.strip()
    if line:
        e=json.loads(line)
        if e['vers']==sys.argv[1] and not e.get('yanked'):
            print(e['cksum'])
" "$version"
}

local_checksum() {
  local name="$1" version="$2" file
  cargo package -p "$name" --locked --allow-dirty --no-verify >/dev/null 2>&1
  file="target/package/$name-$version.crate"
  if command -v sha256sum >/dev/null; then sha256sum "$file" | cut -d' ' -f1; else shasum -a 256 "$file" | cut -d' ' -f1; fi
}

wait_for_public() {
  local name="$1" version="$2" attempt=1
  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    if [ -n "$(public_checksum "$name" "$version")" ]; then
      echo "$name $version is visible in the index (attempt $attempt/$MAX_ATTEMPTS)."
      return 0
    fi
    echo "Waiting for $name $version in the index (attempt $attempt/$MAX_ATTEMPTS)..."
    attempt=$((attempt + 1))
    sleep "$SLEEP_SECONDS"
  done
  echo "error: $name $version did not appear in the index after $MAX_ATTEMPTS attempts." >&2
  return 1
}

publish() {
  local name="$1" version existing
  version="$(crate_version "$name")"
  existing="$(public_checksum "$name" "$version")"
  if [ -n "$existing" ]; then
    local mine
    mine="$(local_checksum "$name" "$version")"
    if [ "$mine" != "$existing" ]; then
      echo "error: $name $version is already public with a different checksum." >&2
      echo "  public: $existing" >&2
      echo "  local:  $mine" >&2
      echo "Published versions are immutable; bump the version instead." >&2
      return 1
    fi
    echo "$name $version already published with a matching checksum; skipping."
    return 0
  fi
  echo "Publishing $name $version..."
  cargo publish -p "$name" --locked
  wait_for_public "$name" "$version"
}

publish flowview-compiler
publish flowview-cli
