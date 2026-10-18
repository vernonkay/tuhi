#!/usr/bin/env bash
# Purpose: one-command bootstrap — install the toolchain and deps (non-destructive).
# Usage:   bash scripts/dev/setup.sh   (or: just setup)
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "Checking toolchain..."
command -v cargo >/dev/null || { echo "Install Rust: https://rustup.rs"; exit 1; }
command -v node  >/dev/null || { echo "Install Node 20+: https://nodejs.org"; exit 1; }

# Tauri CLI + just (installed only if missing)
command -v just >/dev/null || cargo install just
cargo install tauri-cli --version "^2" 2>/dev/null || true

echo "Installing frontend deps..."
( cd app && npm install )

# Linux only: Tauri's webkit2gtk system deps (informational)
if [ "$(uname -s)" = "Linux" ]; then
    echo "Linux: ensure webkit2gtk + libayatana-appindicator are installed (see Tauri prerequisites)."
fi

echo "Setup complete. Run 'just dev' to start."
