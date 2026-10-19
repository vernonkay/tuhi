# tuhi task runner.
# Rule (from dt-platform): recipes contain NO logic — they only call scripts or tools.
# One discoverable surface (`just --list`), identical locally and in CI.

set shell := ["bash", "-cu"]

# List available recipes
default:
    @just --list

# One-command bootstrap: install toolchain + deps (non-destructive)
setup:
    bash scripts/dev/setup.sh

# Run the app in dev mode (hot reload)
dev:
    cd app && npm run tauri dev

# Build a release bundle for the current OS
build:
    cd app && npm run tauri build

# Run all tests (Rust + frontend)
test:
    cd app/src-tauri && cargo test
    cd app && npm test --if-present

# Run ALL checks (the real gate; CI runs this exact target)
check:
    bash scripts/check/run-checks.sh

# Fix formatting locally (CI only checks, never fixes)
fmt:
    cd app/src-tauri && cargo fmt
    cd app && npx prettier --write .
