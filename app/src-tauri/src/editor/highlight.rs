//! Syntax highlighting (feature 1).
//!
//! Uses `syntect` (pure-Rust `fancy-regex` engine, no C dependency) rather than
//! tree-sitter for this first cut: one crate, a bundled set of Sublime syntaxes
//! and themes, and reliable Windows builds. tree-sitter remains the eventual
//! target for incremental highlighting on the rope core.
//!
//! Highlighting is computed for the whole document (when it is small enough) and
//! cached as per-line spans; the viewport slices the cache. Huge files (the mmap
//! engine) are not highlighted.

use serde::Serialize;
use std::str::FromStr;
use std::sync::OnceLock;
use syntect::easy::HighlightLines;
use syntect::highlighting::{Color, ScopeSelectors, StyleModifier, Theme, ThemeItem, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

/// Only highlight documents up to this size; above it we stay plain (and huge
/// files go to the mmap engine, which never highlights).
pub const HIGHLIGHT_MAX_BYTES: usize = 2 * 1024 * 1024;

/// A coloured run within a line, in character columns `[start, end)`.
#[derive(Serialize, Clone)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub color: String,
}

struct Engine {
    syntaxes: SyntaxSet,
    light: Theme,
    dark: Theme,
}

fn rgb(hex: u32) -> Color {
    Color {
        r: (hex >> 16) as u8,
        g: (hex >> 8) as u8,
        b: hex as u8,
        a: 0xff,
    }
}

fn engine() -> &'static Engine {
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        // `two-face` bundles a broad syntax set (Rust, TOML, PowerShell, etc.),
        // unlike syntect's small default set.
        let syntaxes = two_face::syntax::extra_newlines();

        // Custom themes matched to the app skin (Prism dark / Daylight light), so the
        // code colours and the window chrome share one palette. Built from a base theme
        // shell rather than loaded, so there are no theme files to bundle.
        let base = ThemeSet::load_defaults()
            .themes
            .values()
            .next()
            .expect("syntect ships default themes")
            .clone();
        let make = |name: &str, fg: u32, bg: u32, items: &[(&str, u32)]| -> Theme {
            let mut t = base.clone();
            t.name = Some(name.to_string());
            t.settings.foreground = Some(rgb(fg));
            t.settings.background = Some(rgb(bg));
            t.scopes = items
                .iter()
                .filter_map(|(sel, c)| {
                    ScopeSelectors::from_str(sel).ok().map(|scope| ThemeItem {
                        scope,
                        style: StyleModifier {
                            foreground: Some(rgb(*c)),
                            background: None,
                            font_style: None,
                        },
                    })
                })
                .collect();
            t
        };

        // Prism (dark): coral keywords, gold types, violet functions, green strings.
        let dark = make(
            "Prism",
            0xece6ef,
            0x141017,
            &[
                ("comment", 0x6b5f72),
                ("string", 0x8ad98a),
                ("constant.character", 0x8ad98a),
                ("constant.numeric", 0xff9e64),
                ("constant.language", 0xff9e64),
                ("keyword", 0xff5a36),
                ("storage", 0xff5a36),
                ("variable.language", 0xff5a36),
                ("entity.name.function", 0xc99bff),
                ("support.function", 0xc99bff),
                ("entity.name.type", 0xffc56e),
                ("entity.name.class", 0xffc56e),
                ("support.type", 0xffc56e),
                ("support.class", 0xffc56e),
                ("markup.heading", 0xff5a36),
                ("markup.bold", 0xffc56e),
                ("markup.italic", 0xc99bff),
                ("markup.raw", 0x8ad98a),
                ("markup.inline.raw", 0x8ad98a),
                ("markup.underline.link", 0x7aa2f7),
            ],
        );
        // Daylight (light): GitHub-light family.
        let light = make(
            "Daylight",
            0x1f2328,
            0xffffff,
            &[
                ("comment", 0xa0a1a7),
                ("string", 0x0a7d33),
                ("constant.character", 0x0a7d33),
                ("constant.numeric", 0x953800),
                ("constant.language", 0x953800),
                ("keyword", 0xcf222e),
                ("storage", 0xcf222e),
                ("variable.language", 0xcf222e),
                ("entity.name.function", 0x8250df),
                ("support.function", 0x8250df),
                ("entity.name.type", 0x0550ae),
                ("entity.name.class", 0x0550ae),
                ("support.type", 0x0550ae),
                ("support.class", 0x0550ae),
                ("markup.heading", 0xcf222e),
                ("markup.bold", 0x953800),
                ("markup.italic", 0x8250df),
                ("markup.raw", 0x0a7d33),
                ("markup.inline.raw", 0x0a7d33),
                ("markup.underline.link", 0x0550ae),
            ],
        );

        Engine {
            syntaxes,
            light,
            dark,
        }
    })
}

/// Compute per-line highlight spans for `text`, choosing a syntax from the file
/// extension (falling back to the first line) and a theme for the colour scheme.
/// Returns `None` when no syntax matches, so the caller leaves the document plain.
pub fn highlight_doc(text: &str, ext: &str, dark: bool) -> Option<Vec<Vec<Span>>> {
    let eng = engine();
    let syntax = eng.syntaxes.find_syntax_by_extension(ext).or_else(|| {
        eng.syntaxes
            .find_syntax_by_first_line(text.lines().next().unwrap_or(""))
    })?;

    let theme = if dark { &eng.dark } else { &eng.light };
    let mut hl = HighlightLines::new(syntax, theme);
    let mut out = Vec::new();
    for line in LinesWithEndings::from(text) {
        let mut spans = Vec::new();
        let mut col = 0usize;
        match hl.highlight_line(line, &eng.syntaxes) {
            Ok(ranges) => {
                for (style, piece) in ranges {
                    let len = piece.chars().count();
                    if len > 0 {
                        let fg = style.foreground;
                        spans.push(Span {
                            start: col,
                            end: col + len,
                            color: format!("#{:02x}{:02x}{:02x}", fg.r, fg.g, fg.b),
                        });
                        col += len;
                    }
                }
            }
            Err(_) => return Some(out), // bail to plain on a parser error
        }
        out.push(spans);
    }
    Some(out)
}
