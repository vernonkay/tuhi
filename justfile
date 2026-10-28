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

# End-to-end tests: build the app (debug) then drive the REAL binary via WebDriver.
# Requires `tauri-driver` on PATH (cargo install tauri-driver --locked) and, on Linux, a
# display (wrap in `xvfb-run` when headless). CI runs this on Linux and Windows.
e2e:
    cd app && npm run build
    cd app/src-tauri && cargo build
    cd app && npm run e2e

# Run ALL checks (the real gate; CI runs this exact target)
check:
    bash scripts/check/run-checks.sh

# End-of-phase gate: checks + Rust tests + front-end UI tests + release build
verify:
    bash scripts/verify.sh

# Fix formatting locally (CI only checks, never fixes)
fmt:
    cd app/src-tauri && cargo fmt
    cd app && npx prettier --write .
