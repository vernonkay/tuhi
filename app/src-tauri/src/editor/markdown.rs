//! Markdown block model for the live (hybrid) preview (feature 3, phase 1).
//!
//! Parses the document into a flat list of blocks, each carrying the SOURCE LINE
//! SPAN it came from (`[start_line, end_line)`, zero-based). The line span is the
//! key to the hybrid editor: it lets the frontend render every block rich except
//! the one the caret sits in, which it swaps back to raw Markdown for editing.
//!
//! Text-bearing blocks (headings, paragraphs, list items, quotes) carry their
//! inline runs (bold / italic / code / strikethrough / link) already resolved, so
//! the frontend renders formatting without a second parser on the UI thread. Blocks
//! whose rich rendering comes in a later phase (code fences, tables, raw HTML) carry
//! their raw source slice in `raw` instead.

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Serialize;

/// A styled run of inline text within a block.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct InlineRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub strike: bool,
    /// Link target when this run is (part of) a link, else `None`.
    pub href: Option<String>,
    /// This run is a math expression (`text` is the TeX source, rendered with KaTeX).
    pub math: bool,
    /// Display (block) math (`$$…$$`) rather than inline (`$…$`); only with `math`.
    pub display: bool,
}

/// A rendered table: per-column alignment plus header and body cells, each cell its own
/// list of inline runs. Lets the frontend draw a real `<table>` rather than raw pipes.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TableData {
    /// Per-column alignment: "left" | "center" | "right" | "none".
    pub aligns: Vec<String>,
    /// Header cells (one run list per cell).
    pub header: Vec<Vec<InlineRun>>,
    /// Body rows, each a list of cells.
    pub rows: Vec<Vec<Vec<InlineRun>>>,
}

fn align_str(a: pulldown_cmark::Alignment) -> String {
    use pulldown_cmark::Alignment::*;
    match a {
        Left => "left",
        Center => "center",
        Right => "right",
        None => "none",
    }
    .to_string()
}

/// What a block is. Serialized with an internal `kind` tag plus its fields.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BlockKind {
    Heading {
        level: u8,
    },
    Paragraph,
    ListItem {
        ordered: bool,
        number: u64,
        depth: u8,
        /// `Some(true/false)` for a task-list checkbox, else `None`.
        checked: Option<bool>,
    },
    Quote,
    /// A fenced or indented code block; `lang` is the info string (may be empty).
    Code {
        lang: String,
    },
    Table,
    Rule,
    Html,
}

/// One rendered block plus the source lines it spans.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Block {
    #[serde(flatten)]
    pub kind: BlockKind,
    /// First source line (zero-based, inclusive).
    pub start_line: usize,
    /// One past the last source line (zero-based, exclusive).
    pub end_line: usize,
    /// Inline runs for text-bearing blocks; empty for code / table / rule / html.
    pub inlines: Vec<InlineRun>,
    /// Raw source for blocks not yet rendered rich (code / table / html); else empty.
    pub raw: String,
    /// The block's exact source lines, verbatim and newline-terminated as in the
    /// document. The edit-in-place hybrid seeds a block's textarea with this, edits
    /// it, and writes it back by the line span. Unlike `raw` (a rendering input, e.g.
    /// a code body without its fences) this is always the literal source slice, and
    /// is filled uniformly for every block in a post-pass from the line spans.
    pub source: String,
    /// Structured table (header, rows, alignments) when `kind` is Table, else `None`.
    pub table: Option<TableData>,
}

/// The text block currently being assembled (heading / paragraph / list item / quote).
struct Pending {
    kind: BlockKind,
    start_byte: usize,
    end_byte: usize,
    inlines: Vec<InlineRun>,
}

/// The table currently being assembled from pulldown-cmark's table events. Header cells
/// and each body row are collected into `cur_row`, then moved into `header` / `rows`.
struct TableBuild {
    start_byte: usize,
    aligns: Vec<String>,
    header: Vec<Vec<InlineRun>>,
    rows: Vec<Vec<Vec<InlineRun>>>,
    cur_row: Vec<Vec<InlineRun>>,
    cur_cell: Vec<InlineRun>,
}

/// Parse `text` into blocks with resolved line spans. A document with no content
/// yields an empty list.
pub fn parse_blocks(text: &str) -> Vec<Block> {
    let line_starts = line_starts(text);
    let line_of = |byte: usize| -> usize {
        line_starts
            .partition_point(|&s| s <= byte)
            .saturating_sub(1)
    };
    let to_block = |p: Pending| -> Block {
        Block {
            kind: p.kind,
            start_line: line_of(p.start_byte),
            end_line: line_of(p.end_byte.saturating_sub(1)) + 1,
            inlines: p.inlines,
            raw: String::new(),
            source: String::new(),
            table: None,
        }
    };

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_MATH);

    let mut blocks: Vec<Block> = Vec::new();
    let mut pending: Option<Pending> = None;

    // Inline style depth (nesting-safe) and the active link target.
    let mut bold = 0usize;
    let mut italic = 0usize;
    let mut strike = 0usize;
    let mut href: Option<String> = None;

    // List nesting: each entry is the next item number (ordered) or None (bullet).
    let mut list_stack: Vec<Option<u64>> = Vec::new();
    let mut quote_depth = 0usize;

    // Code block accumulation.
    let mut code_lang: Option<String> = None;
    let mut code_start = 0usize;
    let mut code_text = String::new();
    // The structured table currently being assembled (built into a `TableData`).
    let mut table: Option<TableBuild> = None;

    let push_run = |inlines: &mut Vec<InlineRun>,
                    s: &str,
                    bold,
                    italic,
                    code,
                    strike,
                    href: &Option<String>| {
        if s.is_empty() {
            return;
        }
        inlines.push(InlineRun {
            text: s.to_string(),
            bold,
            italic,
            code,
            strike,
            href: href.clone(),
            math: false,
            display: false,
        });
    };

    for (ev, range) in Parser::new_ext(text, opts).into_offset_iter() {
        match ev {
            Event::Start(Tag::Heading { level, .. }) => {
                pending = Some(Pending {
                    kind: BlockKind::Heading {
                        level: heading_level(level),
                    },
                    start_byte: range.start,
                    end_byte: range.end,
                    inlines: Vec::new(),
                });
            }
            // A paragraph inside a list item or quote is folded into that block (its
            // pending block is already open); only a bare paragraph starts its own.
            Event::Start(Tag::Paragraph) if pending.is_none() => {
                let kind = if quote_depth > 0 {
                    BlockKind::Quote
                } else {
                    BlockKind::Paragraph
                };
                pending = Some(Pending {
                    kind,
                    start_byte: range.start,
                    end_byte: range.end,
                    inlines: Vec::new(),
                });
            }
            Event::Start(Tag::List(first)) => {
                // A nested list ends its parent item's own text block first, so the
                // parent item is not overwritten by the nested item below.
                if let Some(p) = pending.take() {
                    blocks.push(to_block(p));
                }
                list_stack.push(first);
            }
            Event::Start(Tag::Item) => {
                if let Some(p) = pending.take() {
                    blocks.push(to_block(p));
                }
                let ordered = matches!(list_stack.last(), Some(Some(_)));
                let number = match list_stack.last_mut() {
                    Some(Some(n)) => {
                        let cur = *n;
                        *n += 1;
                        cur
                    }
                    _ => 0,
                };
                let depth = (list_stack.len().saturating_sub(1)).min(u8::MAX as usize) as u8;
                pending = Some(Pending {
                    kind: BlockKind::ListItem {
                        ordered,
                        number,
                        depth,
                        checked: None,
                    },
                    start_byte: range.start,
                    end_byte: range.end,
                    inlines: Vec::new(),
                });
            }
            Event::TaskListMarker(done) => {
                if let Some(Pending {
                    kind: BlockKind::ListItem { checked, .. },
                    ..
                }) = pending.as_mut()
                {
                    *checked = Some(done);
                }
            }
            Event::Start(Tag::BlockQuote(_)) => quote_depth += 1,
            Event::End(TagEnd::BlockQuote(_)) => quote_depth = quote_depth.saturating_sub(1),
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic = italic.saturating_sub(1),
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold = bold.saturating_sub(1),
            Event::Start(Tag::Strikethrough) => strike += 1,
            Event::End(TagEnd::Strikethrough) => strike = strike.saturating_sub(1),
            Event::Start(Tag::Link { dest_url, .. }) => href = Some(dest_url.to_string()),
            Event::End(TagEnd::Link) => href = None,
            Event::Start(Tag::CodeBlock(kind)) => {
                code_lang = Some(match kind {
                    CodeBlockKind::Fenced(info) => info.to_string(),
                    CodeBlockKind::Indented => String::new(),
                });
                code_start = range.start;
                code_text.clear();
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some(lang) = code_lang.take() {
                    blocks.push(Block {
                        kind: BlockKind::Code { lang },
                        start_line: line_of(code_start),
                        end_line: line_of(range.end.saturating_sub(1)) + 1,
                        inlines: Vec::new(),
                        raw: code_text.clone(),
                        source: String::new(),
                        table: None,
                    });
                }
            }
            Event::Start(Tag::Table(aligns)) => {
                table = Some(TableBuild {
                    start_byte: range.start,
                    aligns: aligns.into_iter().map(align_str).collect(),
                    header: Vec::new(),
                    rows: Vec::new(),
                    cur_row: Vec::new(),
                    cur_cell: Vec::new(),
                });
            }
            Event::Start(Tag::TableHead) | Event::Start(Tag::TableRow) => {
                if let Some(tb) = table.as_mut() {
                    tb.cur_row = Vec::new();
                }
            }
            Event::Start(Tag::TableCell) => {
                if let Some(tb) = table.as_mut() {
                    tb.cur_cell = Vec::new();
                }
            }
            Event::End(TagEnd::TableCell) => {
                if let Some(tb) = table.as_mut() {
                    let cell = std::mem::take(&mut tb.cur_cell);
                    tb.cur_row.push(cell);
                }
            }
            Event::End(TagEnd::TableHead) => {
                if let Some(tb) = table.as_mut() {
                    tb.header = std::mem::take(&mut tb.cur_row);
                }
            }
            Event::End(TagEnd::TableRow) => {
                if let Some(tb) = table.as_mut() {
                    let row = std::mem::take(&mut tb.cur_row);
                    tb.rows.push(row);
                }
            }
            Event::End(TagEnd::Table) => {
                if let Some(tb) = table.take() {
                    blocks.push(Block {
                        kind: BlockKind::Table,
                        start_line: line_of(tb.start_byte),
                        end_line: line_of(range.end.saturating_sub(1)) + 1,
                        inlines: Vec::new(),
                        raw: text[tb.start_byte..range.end].to_string(),
                        source: String::new(),
                        table: Some(TableData {
                            aligns: tb.aligns,
                            header: tb.header,
                            rows: tb.rows,
                        }),
                    });
                }
            }
            Event::Rule => {
                blocks.push(Block {
                    kind: BlockKind::Rule,
                    start_line: line_of(range.start),
                    end_line: line_of(range.end.saturating_sub(1)) + 1,
                    inlines: Vec::new(),
                    raw: String::new(),
                    source: String::new(),
                    table: None,
                });
            }
            Event::Text(t) => {
                if code_lang.is_some() {
                    code_text.push_str(&t);
                } else if let Some(p) = pending.as_mut() {
                    p.end_byte = range.end;
                    push_run(
                        &mut p.inlines,
                        &t,
                        bold > 0,
                        italic > 0,
                        false,
                        strike > 0,
                        &href,
                    );
                } else if let Some(tb) = table.as_mut() {
                    push_run(
                        &mut tb.cur_cell,
                        &t,
                        bold > 0,
                        italic > 0,
                        false,
                        strike > 0,
                        &href,
                    );
                }
            }
            Event::Code(t) => {
                if let Some(p) = pending.as_mut() {
                    p.end_byte = range.end;
                    push_run(
                        &mut p.inlines,
                        &t,
                        bold > 0,
                        italic > 0,
                        true,
                        strike > 0,
                        &href,
                    );
                } else if let Some(tb) = table.as_mut() {
                    push_run(
                        &mut tb.cur_cell,
                        &t,
                        bold > 0,
                        italic > 0,
                        true,
                        strike > 0,
                        &href,
                    );
                }
            }
            Event::InlineMath(t) => {
                let run = InlineRun {
                    text: t.to_string(),
                    math: true,
                    ..Default::default()
                };
                if let Some(p) = pending.as_mut() {
                    p.end_byte = range.end;
                    p.inlines.push(run);
                } else if let Some(tb) = table.as_mut() {
                    tb.cur_cell.push(run);
                }
            }
            Event::DisplayMath(t) => {
                let run = InlineRun {
                    text: t.to_string(),
                    math: true,
                    display: true,
                    ..Default::default()
                };
                if let Some(p) = pending.as_mut() {
                    p.end_byte = range.end;
                    p.inlines.push(run);
                } else if let Some(tb) = table.as_mut() {
                    tb.cur_cell.push(run);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(p) = pending.as_mut() {
                    p.end_byte = range.end;
                    push_run(
                        &mut p.inlines,
                        " ",
                        bold > 0,
                        italic > 0,
                        false,
                        strike > 0,
                        &href,
                    );
                } else if let Some(tb) = table.as_mut() {
                    push_run(
                        &mut tb.cur_cell,
                        " ",
                        bold > 0,
                        italic > 0,
                        false,
                        strike > 0,
                        &href,
                    );
                }
            }
            // A block-level HTML run becomes its own block; inline HTML inside a
            // paragraph is left to that paragraph (dropped for now).
            Event::Html(_) | Event::InlineHtml(_)
                if pending.is_none() && code_lang.is_none() && table.is_none() =>
            {
                blocks.push(Block {
                    kind: BlockKind::Html,
                    start_line: line_of(range.start),
                    end_line: line_of(range.end.saturating_sub(1)) + 1,
                    inlines: Vec::new(),
                    raw: text[range.start..range.end].to_string(),
                    source: String::new(),
                    table: None,
                });
            }
            Event::End(end @ (TagEnd::Heading(_) | TagEnd::Paragraph | TagEnd::Item)) => {
                // A paragraph-end inside an item or quote keeps the block open (the
                // item/quote end finalizes it); take-or-restore avoids a nested if.
                let is_para = matches!(end, TagEnd::Paragraph);
                match pending.take() {
                    Some(p)
                        if !is_para
                            || matches!(p.kind, BlockKind::Paragraph | BlockKind::Quote) =>
                    {
                        blocks.push(to_block(p));
                    }
                    other => pending = other,
                }
            }
            Event::End(TagEnd::List(_)) => {
                list_stack.pop();
            }
            _ => {}
        }
    }

    // Fill each block's verbatim source slice from its line span, uniformly. Done in
    // one pass (rather than per constructor) so every block kind carries exact source
    // for the edit-in-place hybrid, independent of how the block was assembled. The
    // slice runs from the first line's start to the line after the last (so it ends
    // with the block's own trailing newline), clamped to the document.
    let len = text.len();
    for b in &mut blocks {
        let start = line_starts
            .get(b.start_line)
            .copied()
            .unwrap_or(len)
            .min(len);
        let end = line_starts.get(b.end_line).copied().unwrap_or(len).min(len);
        if start <= end {
            b.source = text[start..end].to_string();
        }
    }

    blocks
}

/// Byte offset of the start of each line (always starts with 0).
fn line_starts(text: &str) -> Vec<usize> {
    let mut v = vec![0usize];
    for (i, b) in text.bytes().enumerate() {
        if b == b'\n' {
            v.push(i + 1);
        }
    }
    v
}

fn heading_level(l: HeadingLevel) -> u8 {
    match l {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(blocks: &[Block]) -> Vec<&BlockKind> {
        blocks.iter().map(|b| &b.kind).collect()
    }

    #[test]
    fn heading_and_paragraph_with_line_spans() {
        let md = "# Title\n\nA paragraph.\n";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 2);
        assert_eq!(b[0].kind, BlockKind::Heading { level: 1 });
        assert_eq!((b[0].start_line, b[0].end_line), (0, 1));
        assert_eq!(
            b[0].inlines,
            vec![InlineRun {
                text: "Title".into(),
                ..Default::default()
            }]
        );
        assert_eq!(b[1].kind, BlockKind::Paragraph);
        assert_eq!((b[1].start_line, b[1].end_line), (2, 3));
    }

    #[test]
    fn inline_bold_italic_code_link_resolve() {
        let md = "Some **bold** and *it* and `x` and [t](http://e).";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 1);
        let runs = &b[0].inlines;
        assert!(runs.iter().any(|r| r.text == "bold" && r.bold));
        assert!(runs.iter().any(|r| r.text == "it" && r.italic));
        assert!(runs.iter().any(|r| r.text == "x" && r.code));
        assert!(
            runs.iter()
                .any(|r| r.text == "t" && r.href.as_deref() == Some("http://e"))
        );
    }

    #[test]
    fn bullet_and_ordered_list_items_carry_depth_and_number() {
        let md = "- one\n- two\n\n1. first\n2. second\n";
        let b = parse_blocks(md);
        assert_eq!(
            kinds(&b),
            vec![
                &BlockKind::ListItem {
                    ordered: false,
                    number: 0,
                    depth: 0,
                    checked: None
                },
                &BlockKind::ListItem {
                    ordered: false,
                    number: 0,
                    depth: 0,
                    checked: None
                },
                &BlockKind::ListItem {
                    ordered: true,
                    number: 1,
                    depth: 0,
                    checked: None
                },
                &BlockKind::ListItem {
                    ordered: true,
                    number: 2,
                    depth: 0,
                    checked: None
                },
            ]
        );
        assert_eq!(
            b[0].inlines,
            vec![InlineRun {
                text: "one".into(),
                ..Default::default()
            }]
        );
        // First list item is on source line 0; the ordered list starts on line 3.
        assert_eq!(b[0].start_line, 0);
        assert_eq!(b[2].start_line, 3);
    }

    #[test]
    fn nested_list_increments_depth() {
        let md = "- top\n  - child\n";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 2);
        assert!(matches!(b[0].kind, BlockKind::ListItem { depth: 0, .. }));
        assert!(matches!(b[1].kind, BlockKind::ListItem { depth: 1, .. }));
    }

    #[test]
    fn code_fence_keeps_language_and_body_raw() {
        let md = "```rust\nfn main() {}\n```\n";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 1);
        assert_eq!(
            b[0].kind,
            BlockKind::Code {
                lang: "rust".into()
            }
        );
        assert_eq!(b[0].raw, "fn main() {}\n");
        assert_eq!((b[0].start_line, b[0].end_line), (0, 3));
    }

    #[test]
    fn quote_and_rule() {
        let md = "> quoted\n\n---\n";
        let b = parse_blocks(md);
        assert_eq!(b[0].kind, BlockKind::Quote);
        assert_eq!(
            b[0].inlines,
            vec![InlineRun {
                text: "quoted".into(),
                ..Default::default()
            }]
        );
        assert_eq!(b[1].kind, BlockKind::Rule);
    }

    #[test]
    fn table_carries_raw_source() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |\n";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].kind, BlockKind::Table);
        assert!(b[0].raw.contains("| a | b |"));
        assert_eq!(b[0].start_line, 0);
    }

    #[test]
    fn table_has_structured_header_rows_and_aligns() {
        let md = "| a | b |\n|:--|--:|\n| 1 | **2** |\n";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 1);
        let t = b[0].table.as_ref().expect("structured table data");
        assert_eq!(t.aligns, vec!["left", "right"]);
        assert_eq!(t.header.len(), 2);
        assert_eq!(t.header[0][0].text, "a");
        assert_eq!(t.header[1][0].text, "b");
        assert_eq!(t.rows.len(), 1);
        assert_eq!(t.rows[0].len(), 2);
        assert_eq!(t.rows[0][0][0].text, "1");
        assert!(
            t.rows[0][1].iter().any(|r| r.text == "2" && r.bold),
            "bold cell content resolves"
        );
    }

    #[test]
    fn inline_and_display_math_resolve() {
        let md = "Euler: $e^{i\\pi}+1=0$ is neat.\n\n$$\\int_0^1 x^2\\,dx$$\n";
        let b = parse_blocks(md);
        let runs: Vec<&InlineRun> = b.iter().flat_map(|bl| &bl.inlines).collect();
        assert!(
            runs.iter()
                .any(|r| r.math && !r.display && r.text.contains("e^")),
            "inline math captured"
        );
        assert!(
            runs.iter()
                .any(|r| r.math && r.display && r.text.contains("int")),
            "display math captured"
        );
    }

    #[test]
    fn task_list_marker_sets_checked() {
        let md = "- [x] done\n- [ ] todo\n";
        let b = parse_blocks(md);
        assert!(matches!(
            b[0].kind,
            BlockKind::ListItem {
                checked: Some(true),
                ..
            }
        ));
        assert!(matches!(
            b[1].kind,
            BlockKind::ListItem {
                checked: Some(false),
                ..
            }
        ));
    }

    #[test]
    fn empty_document_yields_no_blocks() {
        assert!(parse_blocks("").is_empty());
    }

    #[test]
    fn source_is_verbatim_lines_for_every_block() {
        // Heading, paragraph, and a code fence: source is the exact source lines
        // (newline-terminated), including a code block's fences (unlike `raw`, which
        // is the fence-less body used for rendering).
        let md = "# Title\n\nHello **world**.\n\n```rust\nfn main() {}\n```\n";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 3);
        assert_eq!(b[0].source, "# Title\n");
        assert_eq!(b[1].source, "Hello **world**.\n");
        assert_eq!(b[2].source, "```rust\nfn main() {}\n```\n");
        // Re-splicing each block's source back over its line span reproduces the doc.
        let lines: Vec<&str> = md.split_inclusive('\n').collect();
        let mut rebuilt = String::new();
        let mut cur = 0usize;
        for blk in &b {
            // blank separator lines between blocks
            while cur < blk.start_line {
                rebuilt.push_str(lines[cur]);
                cur += 1;
            }
            rebuilt.push_str(&blk.source);
            cur = blk.end_line;
        }
        while cur < lines.len() {
            rebuilt.push_str(lines[cur]);
            cur += 1;
        }
        assert_eq!(rebuilt, md);
    }

    #[test]
    fn source_handles_final_line_without_newline() {
        // A document whose last block has no trailing newline: source carries none.
        let md = "# Title\n\nlast line no newline";
        let b = parse_blocks(md);
        assert_eq!(b.len(), 2);
        assert_eq!(b[1].source, "last line no newline");
    }
}
