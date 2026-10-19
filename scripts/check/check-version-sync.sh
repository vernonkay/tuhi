#!/usr/bin/env bash
# Assert the app version is identical across tauri.conf.json, Cargo.toml and
# package.json. tauri.conf.json is the source of truth (tauri-action releases from
# it); the other two must match, and this check fails loudly if they drift.
set -uo pipefail
cd "$(dirname "$0")/../.."

tauri=$(grep -m1 '"version"' app/src-tauri/tauri.conf.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
cargo=$(grep -m1 '^version' app/src-tauri/Cargo.toml | sed -E 's/.*"([^"]+)".*/\1/')
pkg=$(grep -m1 '"version"' app/package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

if [ -n "$tauri" ] && [ "$tauri" = "$cargo" ] && [ "$tauri" = "$pkg" ]; then
    echo "ok: version $tauri in sync (tauri.conf.json / Cargo.toml / package.json)"
    exit 0
fi
echo "x version mismatch: tauri.conf.json=$tauri Cargo.toml=$cargo package.json=$pkg"
echo "  keep all three equal (tauri.conf.json is the source of truth)."
exit 1
