//! Tabular view helpers (feature #1): split a delimited line into cells, and sniff a sample of
//! lines for the delimiter, column count and whether the first row is a header.
//!
//! The grid itself rides on the existing `Buffer::viewport`: `Buffer::table_rows` (in `mod.rs`)
//! asks the active engine for a window of lines and splits each here, so the mmap engine's O(1)
//! random-row access and the viewport length caps apply unchanged, and nothing new has to be
//! indexed to scroll a multi-GB CSV as a grid.
//!
//! Scope: one physical line is one record. True CSV allows newlines inside quoted fields, which
//! would break line-addressed random access (and the mmap newline index); that record-aware
//! indexing is a later step. Quoting WITHIN a line (a delimiter or quote inside `"..."`) is
//! handled, which covers the overwhelming majority of real exports and every TSV/log.

/// The delimiters we sniff for, best-first by how unambiguous they are as a data separator.
pub const CANDIDATES: [char; 4] = [',', '\t', ';', '|'];

/// Split one line into cells on `delim`, honouring double-quote quoting: a quoted field may
/// contain the delimiter, and a doubled quote (`""`) inside a quoted field is a literal quote.
/// A trailing newline (and a preceding CR) is stripped first so the last cell is clean.
pub fn split_cells(line: &str, delim: char) -> Vec<String> {
    let line = line.strip_suffix('\n').unwrap_or(line);
    let line = line.strip_suffix('\r').unwrap_or(line);
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                // A doubled quote is an escaped literal quote; a lone quote closes the field.
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == delim {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.push(c);
        }
    }
    out.push(cur);
    out
}

/// What a sample of lines looks like as a table.
pub struct Sniff {
    /// The detected delimiter, or `None` when the sample doesn't look tabular.
    pub delimiter: Option<char>,
    /// The column count (the most common cell count across the sample).
    pub columns: usize,
    /// True when the first row looks like a header (text labels over data that isn't all text).
    pub has_header: bool,
}

/// Count a line's cells under `delim` without allocating the cells (just the splits), so sniffing
/// a wide sample stays cheap. Mirrors `split_cells`' quoting rules.
fn cell_count(line: &str, delim: char) -> usize {
    let line = line.strip_suffix('\n').unwrap_or(line);
    let line = line.strip_suffix('\r').unwrap_or(line);
    let mut n = 1;
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                } else {
                    in_quotes = false;
                }
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == delim {
            n += 1;
        }
    }
    n
}

/// Does a cell read as a number (so a row of them is data, not a header label)? Permissive on
/// purpose: optional sign, digits, one decimal point, thousands commas already consumed by the
/// splitter. Blank is not a number.
fn looks_numeric(cell: &str) -> bool {
    let c = cell.trim();
    if c.is_empty() {
        return false;
    }
    let body = c.strip_prefix(['+', '-']).unwrap_or(c);
    let mut seen_digit = false;
    let mut seen_dot = false;
    for ch in body.chars() {
        match ch {
            '0'..='9' => seen_digit = true,
            '.' if !seen_dot => seen_dot = true,
            _ => return false,
        }
    }
    seen_digit
}

/// Sniff a sample of lines (typically the first ~50) for the delimiter, column count and header.
/// Picks the candidate delimiter that splits the sample into the most columns *most consistently*:
/// a real table has the same number of columns on every row, so we score by (modal column count)
/// weighted by how many sample rows hit it, and require at least two columns.
pub fn sniff(sample: &[String]) -> Sniff {
    let rows: Vec<&String> = sample.iter().filter(|l| !l.trim().is_empty()).collect();
    if rows.is_empty() {
        return Sniff {
            delimiter: None,
            columns: 0,
            has_header: false,
        };
    }

    let mut best: Option<(char, usize, usize)> = None; // (delim, modal columns, rows agreeing)
    for &delim in &CANDIDATES {
        // Column count per row for this delimiter, then the modal (most common) count.
        let counts: Vec<usize> = rows.iter().map(|l| cell_count(l, delim)).collect();
        let max_cols = *counts.iter().max().unwrap_or(&1);
        if max_cols < 2 {
            continue; // not splitting anything
        }
        // Find the modal column count (>=2) and how many rows share it.
        let mut modal = 0usize;
        let mut agree = 0usize;
        for cols in 2..=max_cols {
            let n = counts.iter().filter(|&&c| c == cols).count();
            if n > agree || (n == agree && cols > modal) {
                agree = n;
                modal = cols;
            }
        }
        if modal < 2 {
            continue;
        }
        // Prefer more rows in agreement, then more columns, then candidate order (comma first).
        let better = match best {
            None => true,
            Some((_, bmodal, bagree)) => agree > bagree || (agree == bagree && modal > bmodal),
        };
        if better {
            best = Some((delim, modal, agree));
        }
    }

    match best {
        None => Sniff {
            delimiter: None,
            columns: 0,
            has_header: false,
        },
        Some((delim, columns, _)) => {
            let has_header = header_likely(&rows, delim, columns);
            Sniff {
                delimiter: Some(delim),
                columns,
                has_header,
            }
        }
    }
}

/// Heuristic: the first row is a header when its cells are all non-empty and non-numeric, and at
/// least one later row has a numeric cell (so the first row's text stands out as labels). With no
/// data rows to compare, fall back to "all first-row cells are non-numeric text".
fn header_likely(rows: &[&String], delim: char, columns: usize) -> bool {
    let first = split_cells(rows[0], delim);
    if first.len() != columns {
        return false;
    }
    let first_all_text = first
        .iter()
        .all(|c| !c.trim().is_empty() && !looks_numeric(c));
    if !first_all_text {
        return false;
    }
    let data_has_number = rows
        .iter()
        .skip(1)
        .any(|l| split_cells(l, delim).iter().any(|c| looks_numeric(c)));
    // With data rows, require one to carry a number; with none, trust the text-only first row.
    data_has_number || rows.len() == 1
}

/// Cap on rows sorted in memory. Beyond this the UI keeps the file in its original order and says
/// it is too large to sort — this bounds the key Vec and the ordering Vec (8 bytes per row). An
/// external-merge sort for truly huge files is a later step.
pub const MAX_SORT_ROWS: usize = 2_000_000;

/// A stable sort order over `keys` (one key per data row, in file order): returns the row indices
/// in display order. Numeric-aware — when every non-empty key parses as a number the column sorts
/// numerically, otherwise case-insensitively by text; blank keys sort last (ascending). Stable, so
/// ties keep their original order, and `descending` reverses the comparison rather than the vec so
/// ties stay stable there too.
pub fn sort_order(keys: &[String], descending: bool) -> Vec<usize> {
    use std::cmp::Ordering;
    let non_empty = |k: &str| !k.trim().is_empty();
    let any_value = keys.iter().any(|k| non_empty(k));
    let numeric = any_value
        && keys
            .iter()
            .filter(|k| non_empty(k))
            .all(|k| k.trim().parse::<f64>().is_ok());

    let cmp: Box<dyn Fn(usize, usize) -> Ordering> = if numeric {
        // Parse once per row, not once per comparison. Blanks (None) sort after numbers.
        let nums: Vec<Option<f64>> = keys.iter().map(|k| k.trim().parse::<f64>().ok()).collect();
        Box::new(move |a, b| match (nums[a], nums[b]) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
    } else {
        // Lower-case once per row, not once per comparison. Blanks sort after text.
        let low: Vec<String> = keys.iter().map(|k| k.trim().to_lowercase()).collect();
        Box::new(move |a, b| match (low[a].is_empty(), low[b].is_empty()) {
            (false, false) => low[a].cmp(&low[b]),
            (false, true) => Ordering::Less,
            (true, false) => Ordering::Greater,
            (true, true) => Ordering::Equal,
        })
    };

    let mut idx: Vec<usize> = (0..keys.len()).collect();
    idx.sort_by(|&a, &b| {
        let o = cmp(a, b);
        if descending { o.reverse() } else { o }
    });
    idx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(cells: &[&str]) -> Vec<String> {
        cells.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn splits_plain_comma_row() {
        assert_eq!(split_cells("a,b,c", ','), v(&["a", "b", "c"]));
    }

    #[test]
    fn strips_trailing_crlf_from_last_cell() {
        assert_eq!(split_cells("a,b\r\n", ','), v(&["a", "b"]));
        assert_eq!(split_cells("a,b\n", ','), v(&["a", "b"]));
    }

    #[test]
    fn honours_quoted_delimiters_and_doubled_quotes() {
        // A comma inside quotes is part of the field; "" is a literal quote.
        assert_eq!(
            split_cells(r#"a,"b,c","he said ""hi""",d"#, ','),
            v(&["a", "b,c", r#"he said "hi""#, "d"]),
        );
    }

    #[test]
    fn empty_fields_are_kept() {
        assert_eq!(split_cells("a,,c,", ','), v(&["a", "", "c", ""]));
    }

    #[test]
    fn splits_tabs() {
        assert_eq!(split_cells("a\tb\tc", '\t'), v(&["a", "b", "c"]));
    }

    #[test]
    fn sniff_detects_comma_and_header() {
        let sample = vec![
            "name,age,city".to_string(),
            "Ann,30,Wellington".to_string(),
            "Bo,25,Auckland".to_string(),
        ];
        let s = sniff(&sample);
        assert_eq!(s.delimiter, Some(','));
        assert_eq!(s.columns, 3);
        assert!(s.has_header);
    }

    #[test]
    fn sniff_detects_tsv() {
        let sample = vec![
            "a\tb\tc\td".to_string(),
            "1\t2\t3\t4".to_string(),
            "5\t6\t7\t8".to_string(),
        ];
        let s = sniff(&sample);
        assert_eq!(s.delimiter, Some('\t'));
        assert_eq!(s.columns, 4);
    }

    #[test]
    fn sniff_prefers_the_consistent_delimiter() {
        // Commas appear inside prose, but every row has exactly two pipe-separated columns.
        let sample = vec![
            "id|note".to_string(),
            "1|a short, comma-laden note".to_string(),
            "2|another, longer, note".to_string(),
        ];
        let s = sniff(&sample);
        assert_eq!(s.delimiter, Some('|'));
        assert_eq!(s.columns, 2);
    }

    #[test]
    fn sniff_rejects_non_tabular_text() {
        let sample = vec![
            "Just a sentence.".to_string(),
            "Another line of prose with no structure".to_string(),
        ];
        let s = sniff(&sample);
        assert_eq!(s.delimiter, None);
        assert!(!s.has_header);
    }

    #[test]
    fn sniff_no_header_when_first_row_is_numeric() {
        let sample = vec![
            "1,2,3".to_string(),
            "4,5,6".to_string(),
            "7,8,9".to_string(),
        ];
        let s = sniff(&sample);
        assert_eq!(s.delimiter, Some(','));
        assert!(!s.has_header);
    }

    fn keys(ss: &[&str]) -> Vec<String> {
        ss.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn sort_order_numeric_not_lexical() {
        // "10" must sort after "3", which lexical order would get wrong.
        assert_eq!(
            sort_order(&keys(&["3", "1", "2", "10"]), false),
            vec![1, 2, 0, 3]
        );
        assert_eq!(
            sort_order(&keys(&["3", "1", "2", "10"]), true),
            vec![3, 0, 2, 1]
        );
    }

    #[test]
    fn sort_order_text_is_case_insensitive() {
        assert_eq!(
            sort_order(&keys(&["banana", "Apple", "cherry"]), false),
            vec![1, 0, 2]
        );
    }

    #[test]
    fn sort_order_is_stable_on_ties() {
        // 'a' first, then the three 'x' rows keep their original order (0, 1, 3).
        assert_eq!(
            sort_order(&keys(&["x", "x", "a", "x"]), false),
            vec![2, 0, 1, 3]
        );
    }

    #[test]
    fn sort_order_puts_blanks_last_ascending() {
        assert_eq!(sort_order(&keys(&["b", "", "a"]), false), vec![2, 0, 1]);
    }
}
