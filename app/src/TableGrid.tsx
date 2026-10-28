import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";

// The tabular view (feature #1): render a delimited file as a real grid. Rows are virtualized, so a
// multi-GB CSV scrolls as a grid the same way it scrolls as text — only the visible rows are DOM
// nodes, and each row window is fetched from the backend on demand (riding the engine viewport, so
// the mmap engine serves any row in O(1)). Columns are not virtualized: all columns render per row
// with horizontal scroll, which suits the common case (tens of columns).
//
// Sorting (click a header): the backend returns a stable, numeric-aware order of data-row indices;
// the grid maps each visible display row to its source line through that order and fetches those
// (now scattered) rows with `table_rows_at`. Files beyond the backend's in-memory cap report an
// error instead of sorting.

const ROW_H = 26; // px per data row (and the header row)
const COL_W = 160; // px per data column
const NUM_W = 68; // px for the sticky row-number column
const PAGE = 200; // rows fetched per contiguous window (file order)

type Props = {
  /** The delimiter as a one-character string, from `table_sniff`. */
  delimiter: string;
  /** Whether the first line is a header (the sticky header row, not a data row). */
  hasHeader: boolean;
  /** Column count. */
  columns: number;
  /** Total line count of the file (the header, when present, is line 0). */
  rowCount: number;
};

export default function TableGrid({ delimiter, hasHeader, columns, rowCount }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Fetched cells by file line index; the sets guard against refetching a contiguous page (file
  // order) or an individual line (sorted). A render nudge avoids copying a big Map.
  const cells = useRef<Map<number, string[]>>(new Map());
  const fetchedPages = useRef<Set<number>>(new Set());
  const inflight = useRef<Set<number>>(new Set());
  const [, nudge] = useState(0);
  const [header, setHeader] = useState<string[]>([]);

  // Sort state: `order` maps a display row (0-based data row) to its source data-row index; null is
  // file order. `sortCol`/`sortDesc` drive the header indicator; `sortError` shows a refusal.
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [order, setOrder] = useState<number[] | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);

  const headerOffset = hasHeader ? 1 : 0;
  const dataRows = Math.max(0, rowCount - headerOffset);

  const rowVirtualizer = useVirtualizer({
    count: dataRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
    // The sticky header occupies ROW_H of the scroll content before the list starts.
    scrollMargin: ROW_H,
  });

  // The source file line for a display row, honouring any active sort.
  const lineFor = useCallback(
    (displayRow: number): number =>
      (order ? (order[displayRow] ?? displayRow) : displayRow) + headerOffset,
    [order, headerOffset],
  );

  // Drop the row caches when the file, delimiter or sort order changes (a sort re-maps every row).
  useEffect(() => {
    cells.current.clear();
    fetchedPages.current.clear();
    inflight.current.clear();
    nudge((n) => n + 1);
  }, [delimiter, hasHeader, rowCount, order]);

  // Clear the sort when the file changes (a new shape means a new document).
  useEffect(() => {
    setSortCol(null);
    setSortDesc(false);
    setOrder(null);
    setSortError(null);
  }, [delimiter, hasHeader, rowCount]);

  // The header row (file line 0) is fetched once when present.
  useEffect(() => {
    if (!hasHeader) {
      setHeader([]);
      return;
    }
    void (async () => {
      try {
        const rows = await invoke<string[][]>("table_window", { start: 0, count: 1, delimiter });
        setHeader(rows[0] ?? []);
      } catch {
        setHeader([]);
      }
    })();
  }, [hasHeader, delimiter]);

  // Fetch the contiguous PAGE window covering file line `line`, once (file order).
  const ensurePage = useCallback(
    async (line: number) => {
      const start = Math.floor(line / PAGE) * PAGE;
      if (fetchedPages.current.has(start) || inflight.current.has(start)) return;
      inflight.current.add(start);
      try {
        const rows = await invoke<string[][]>("table_window", { start, count: PAGE, delimiter });
        rows.forEach((r, i) => cells.current.set(start + i, r));
        fetchedPages.current.add(start);
        nudge((n) => n + 1);
      } catch {
        // Leave it unfetched; a later scroll retries.
      } finally {
        inflight.current.delete(start);
      }
    },
    [delimiter],
  );

  // Fetch scattered source lines (sorted order), skipping cached/in-flight ones.
  const ensureLines = useCallback(
    async (lines: number[]) => {
      const want = lines.filter((ln) => !cells.current.has(ln) && !inflight.current.has(ln));
      if (want.length === 0) return;
      want.forEach((ln) => inflight.current.add(ln));
      try {
        const rows = await invoke<string[][]>("table_rows_at", { lines: want, delimiter });
        rows.forEach((r, i) => cells.current.set(want[i], r));
        nudge((n) => n + 1);
      } catch {
        // Leave them unfetched; a later scroll retries.
      } finally {
        want.forEach((ln) => inflight.current.delete(ln));
      }
    },
    [delimiter],
  );

  // Fetch the rows backing the visible window — a contiguous page in file order, the exact
  // scattered lines when a sort is active.
  const items = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    if (order) {
      void ensureLines(items.map((it) => lineFor(it.index)));
    } else {
      for (const it of items) void ensurePage(it.index + headerOffset);
    }
  }, [items, order, headerOffset, lineFor, ensurePage, ensureLines]);

  // Clicking a header column cycles its sort: none -> ascending -> descending -> none.
  const clickSort = useCallback(
    async (col: number) => {
      setSortError(null);
      let nextCol: number | null = col;
      let nextDesc = false;
      if (sortCol === col && !sortDesc) {
        nextDesc = true;
      } else if (sortCol === col && sortDesc) {
        nextCol = null; // third click clears the sort
      }
      if (nextCol === null) {
        setSortCol(null);
        setSortDesc(false);
        setOrder(null);
        return;
      }
      try {
        const ord = await invoke<number[]>("table_sort", {
          column: nextCol,
          delimiter,
          hasHeader,
          descending: nextDesc,
        });
        setSortCol(nextCol);
        setSortDesc(nextDesc);
        setOrder(ord);
      } catch (e) {
        setSortError(String(e));
        setSortCol(null);
        setSortDesc(false);
        setOrder(null);
      }
    },
    [sortCol, sortDesc, delimiter, hasHeader],
  );

  // Scroll horizontally so column `c` sits just past the sticky row-number column.
  const jumpToColumn = useCallback((c: number) => {
    parentRef.current?.scrollTo?.({ left: c * COL_W, behavior: "smooth" });
  }, []);

  const totalWidth = NUM_W + columns * COL_W;
  const labels = hasHeader ? header : Array.from({ length: columns }, (_, i) => `${i + 1}`);

  return (
    <div className="table-view">
      <div className="tg-toolbar">
        <label className="tg-jump">
          Jump to column
          <select
            value=""
            onChange={(e) => {
              const c = Number(e.target.value);
              if (!Number.isNaN(c)) jumpToColumn(c);
            }}
          >
            <option value="">—</option>
            {labels.map((lbl, c) => (
              <option key={c} value={c}>
                {lbl || `Column ${c + 1}`}
              </option>
            ))}
          </select>
        </label>
        <span className="tg-meta">
          {dataRows.toLocaleString()} rows · {columns} cols
          {sortCol != null &&
            ` · sorted by ${labels[sortCol] ?? sortCol + 1} ${sortDesc ? "▼" : "▲"}`}
        </span>
      </div>
      <div className="table-grid" ref={parentRef} tabIndex={0} data-testid="table-grid">
      {sortError && (
        <div className="tg-error" role="status">
          {sortError}
        </div>
      )}
      <div className="tg-content" style={{ width: totalWidth }}>
        <div className="tg-head" style={{ height: ROW_H }}>
          <div className="tg-num tg-hcell" style={{ width: NUM_W }}>
            #
          </div>
          {Array.from({ length: columns }, (_, c) => (
            <button
              type="button"
              className={`tg-hcell tg-sortable${sortCol === c ? " sorted" : ""}`}
              key={c}
              style={{ width: COL_W }}
              title={`${labels[c] ?? `Column ${c + 1}`} — click to sort`}
              onClick={() => void clickSort(c)}
            >
              <span className="tg-hlabel">{labels[c] ?? `${c + 1}`}</span>
              {sortCol === c && <span className="tg-arrow">{sortDesc ? "▼" : "▲"}</span>}
            </button>
          ))}
        </div>
        <div
          className="tg-list"
          style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {items.map((it) => {
            const row = cells.current.get(lineFor(it.index));
            return (
              <div
                className="tg-row"
                key={it.key}
                style={{ height: ROW_H, transform: `translateY(${it.start - ROW_H}px)` }}
              >
                <div className="tg-num" style={{ width: NUM_W }}>
                  {it.index + 1}
                </div>
                {Array.from({ length: columns }, (_, c) => (
                  <div className="tg-cell" key={c} style={{ width: COL_W }} title={row?.[c] ?? ""}>
                    {row ? (row[c] ?? "") : ""}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
