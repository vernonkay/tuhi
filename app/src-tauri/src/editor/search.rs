//! Find / replace support (feature 2).
//!
//! A small helper to build a `regex::Regex` for both literal and regex searches,
//! with an optional case-insensitive flag. The actual search and replace run on
//! `RopeBuffer` (see `mod.rs`), over the whole document.

use regex::{Regex, RegexBuilder};

/// Build a regex for the query. When `is_regex` is false the query is matched
/// literally (escaped). `multi_line` is on so `^`/`$` behave per line.
pub fn build_regex(query: &str, is_regex: bool, case_sensitive: bool) -> Result<Regex, String> {
    let pattern = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|e| e.to_string())
}
