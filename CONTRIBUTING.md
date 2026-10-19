# Contributing to tuhi

Thanks for your interest. tuhi is a personal open-source project, contributions and
issues are welcome, with a few working conventions that keep the tree tidy.

## Building

Prerequisites: a recent **Rust** toolchain (via [rustup](https://rustup.rs)), **Node 20+**,
and the Tauri prerequisites for your OS (on Linux: `libwebkit2gtk-4.1-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`).

```sh
just setup     # install the git hooks + frontend deps (or: cd app && npm install)
just dev       # run the app with hot reload
just check     # the full gate — run this before pushing
just build     # a release bundle for your OS
```

`just check` is the real gate (formatting, clippy, type-check, the project checks, and
the supply-chain checks), and CI runs the exact same thing on Windows, macOS and Linux.
Run it locally before you push.

## Conventions

- **Conventional Commits** for messages (`feat:`, `fix:`, `chore:`, `docs:`, …).
- **Stay in the PR's stated scope**; put anything else in an issue.
- **Delete replaced code** — no commented-out blocks or `old`/`copy` files.
- **No `TODO`/`FIXME`/`HACK` markers** in the tree (CI fails) — open an issue instead.
- **British English**; no emojis in code or docs.
- Update docs in the **same** PR as the change they describe.

## Attribution policy

tuhi is developed with heavy use of AI assistance, which is disclosed once in the
README rather than per commit. Please **do not add `Co-Authored-By` AI trailers or
"Generated with …" lines** to commits or PRs; a commit-msg hook and a CI check enforce
this.

## Licensing of contributions

By contributing, you agree that your contributions are licensed under the project's
dual **MIT OR Apache-2.0** licence, the same terms as the rest of the project.
