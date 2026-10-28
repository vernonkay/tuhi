import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";

// The tabular view (feature #1): render a delimited file as a real grid. Rows are virtualized, so
// a multi-GB CSV scrolls as a grid the same way it scrolls as text — only the visible rows are
// DOM nodes, and each row window is fetched from the backend `table_window` command on demand
// (which rides on the engine viewport, so the mmap engine serves any row in O(1)). Columns are not
// virtualized: all columns render per row with horizontal scroll, which suits the common case
// (tens of columns); very wide tables are a later refinement.

const ROW_H = 26; // px per data row (and the header row)
const COL_W = 160; // px per data column
const NUM_W = 68; // px for the sticky row-number column
const PAGE = 200; // rows fetched per window

type Props = {
  /** The delimiter as a one-character string, from `table_sniff`. */
  delimiter: string;
  /** Whether the first line is a header (rendered as the sticky header row, not a data row). */
  hasHeader: boolean;
  /** Column count. */
  columns: number;
  /** Total line count of the file (the header, when present, is line 0). */
  rowCount: number;
};

export default function TableGrid({ delimiter, hasHeader, columns, rowCount }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Fetched cells by file line index, plus which PAGE-aligned windows have been fetched (or are
  // in flight), so each window is requested once. A ref + a render nudge avoids copying a big Map.
  const cells = useRef<Map<number, string[]>>(new Map());
  const fetched = useRef<Set<number>>(new Set());
  const inflight = useRef<Set<number>>(new Set());
  const [, nudge] = useState(0);
  const [header, setHeader] = useState<string[]>([]);

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

  // Fetch the PAGE-aligned window covering file line `line`, once.
  const ensure = useCallback(
    async (line: number) => {
      const start = Math.floor(line / PAGE) * PAGE;
      if (fetched.current.has(start) || inflight.current.has(start)) return;
      inflight.current.add(start);
      try {
        const rows = await invoke<string[][]>("table_window", {
          start,
          count: PAGE,
          delimiter,
        });
        rows.forEach((r, i) => cells.current.set(start + i, r));
        fetched.current.add(start);
        nudge((n) => n + 1);
      } catch {
        // Leave the window unfetched; the cells render blank and a later scroll retries.
      } finally {
        inflight.current.delete(start);
      }
    },
    [delimiter],
  );

  // A new file/delimiter: drop the caches and refetch.
  useEffect(() => {
    cells.current.clear();
    fetched.current.clear();
    inflight.current.clear();
    nudge((n) => n + 1);
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

  // Fetch the windows backing the visible rows.
  const items = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    for (const it of items) void ensure(it.index + headerOffset);
  }, [items, headerOffset, ensure]);

  const totalWidth = NUM_W + columns * COL_W;
  const labels = hasHeader
    ? header
    : Array.from({ length: columns }, (_, i) => `${i + 1}`);

  return (
    <div className="table-grid" ref={parentRef} tabIndex={0} data-testid="table-grid">
      <div className="tg-content" style={{ width: totalWidth }}>
        <div className="tg-head" style={{ height: ROW_H }}>
          <div className="tg-num tg-hcell" style={{ width: NUM_W }}>
            #
          </div>
          {Array.from({ length: columns }, (_, c) => (
            <div className="tg-hcell" key={c} style={{ width: COL_W }} title={labels[c] ?? ""}>
              {labels[c] ?? `${c + 1}`}
            </div>
          ))}
        </div>
        <div
          className="tg-list"
          style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {items.map((it) => {
            const line = it.index + headerOffset;
            const row = cells.current.get(line);
            return (
              <div
                className="tg-row"
                key={it.key}
                style={{
                  height: ROW_H,
                  transform: `translateY(${it.start - ROW_H}px)`,
                }}
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
  );
}
