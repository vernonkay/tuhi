import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import "./App.css";

/** Mirror of the Rust `DocumentMeta` (editor/mod.rs). */
interface DocumentMeta {
  path: string | null;
  line_count: number;
  char_count: number;
  dirty: boolean;
  readonly: boolean;
}

/** Mirror of the Rust `TabSummary`. */
interface TabSummary {
  id: number;
  name: string;
  dirty: boolean;
  readonly: boolean;
  active: boolean;
}

/** Mirror of the Rust `TabsState`: the tab strip plus the active doc's meta. */
interface TabsState {
  tabs: TabSummary[];
  active: number | null;
  meta: DocumentMeta | null;
}

/** Mirror of the Rust `CaretPos`. */
interface CaretPos {
  line: number;
  col: number;
}

/** A coloured run within a line, in character columns [start, end). */
interface Span {
  start: number;
  end: number;
  color: string;
}

/** Mirror of the Rust `DirEntry` (one file-tree row). */
interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** Mirror of the Rust `OutlineItem` (one outline entry). */
interface OutlineItem {
  level: number;
  title: string;
  line: number;
}

/** A command-palette entry: a label, an optional hint, and what it does. */
type PaletteItem = { label: string; hint?: string; run: () => void };

/** The directory part of a path (handles both `/` and `\`). */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

/** True when `child` is strictly inside directory `root`. */
function within(child: string, root: string): boolean {
  return child.startsWith(root + "/") || child.startsWith(root + "\\");
}

/** Ancestor directories of `filePath`, from just below `root` down to its parent. */
function ancestorsWithin(filePath: string, root: string): string[] {
  const out: string[] = [];
  let d = dirOf(filePath);
  while (d.length > root.length && within(d, root)) {
    out.push(d);
    const parent = dirOf(d);
    if (parent === d) break;
    d = parent;
  }
  return out.reverse();
}

/** Mirror of the Rust `ViewportLine`: display text is capped, `chars` is true. */
interface ViewportLine {
  text: string;
  chars: number;
  truncated: boolean;
  spans: Span[];
}

/** Render a line's display text as syntax-coloured segments. */
function renderLine(text: string, spans: Span[]): React.ReactNode {
  if (text.length === 0) return " ";
  if (spans.length === 0) return text;
  const chars = [...text]; // code points, so astral chars stay intact
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const sp of spans) {
    const s = Math.max(sp.start, pos);
    const e = Math.min(sp.end, chars.length);
    if (e <= s) continue;
    if (s > pos) out.push(<span key={`g${pos}`}>{chars.slice(pos, s).join("")}</span>);
    out.push(
      <span key={`c${s}`} style={{ color: sp.color }}>
        {chars.slice(s, e).join("")}
      </span>,
    );
    pos = e;
    if (pos >= chars.length) break;
  }
  if (pos < chars.length) out.push(<span key={`t${pos}`}>{chars.slice(pos).join("")}</span>);
  return out;
}

/** The caret (selection head): a global character index plus its (line, col). */
interface Caret extends CaretPos {
  idx: number;
}

const LINE_HEIGHT = 20; // must match `.line` height in App.css
const OVERSCAN = 12;
const GUTTER = 76; // `.gutter` width (64) + padding-right (12)

/** The caret-over-a-line brand mark (docs/brand.md). Coral caret, ink line. */
function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 40 L32 18 L50 40" stroke="var(--coral)" strokeWidth={7} />
      <path d="M14 52 H50" stroke="currentColor" strokeWidth={6} />
    </svg>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function IconOpen() {
  return (
    <svg {...iconProps}>
      <path d="M3 7h5l2 2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg {...iconProps}>
      <path d="M4 6h8M16 6h4M4 12h4M10 12h10M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}
function IconTree() {
  return (
    <svg {...iconProps}>
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function IconList() {
  return (
    <svg {...iconProps}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}
function IconCommand() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}
function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ width: 14, height: 14 }}>
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function IconFile() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden style={{ width: 13, height: 13, opacity: 0.65 }}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function App() {
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [lines, setLines] = useState<ViewportLine[]>([]);

  // Studio chrome: file tree, outline, command palette.
  const [treeOpen, setTreeOpen] = useState(false);
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [folderPinned, setFolderPinned] = useState(false);
  const [dirCache, setDirCache] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);

  const refreshOutline = useCallback(async () => {
    try {
      setOutline(await invoke<OutlineItem[]>("get_outline"));
    } catch {
      setOutline([]);
    }
  }, []);

  // A ref to the dir cache so async reveal logic reads the latest without being a dep.
  const dirCacheRef = useRef(dirCache);
  useEffect(() => {
    dirCacheRef.current = dirCache;
  }, [dirCache]);

  // Expand the folders from the root down to a file (the effect below scrolls it in).
  const revealPath = useCallback(async (filePath: string, root: string) => {
    const anc = ancestorsWithin(filePath, root);
    if (!anc.length) return;
    const cache = dirCacheRef.current;
    const fetched: Record<string, DirEntry[]> = {};
    for (const d of anc) {
      if (!(d in cache) && !(d in fetched)) {
        try {
          fetched[d] = await invoke<DirEntry[]>("list_dir", { path: d });
        } catch {
          /* skip a directory we can't read */
        }
      }
    }
    if (Object.keys(fetched).length) setDirCache((prev) => ({ ...prev, ...fetched }));
    setExpanded((prev) => {
      const next = new Set(prev);
      anc.forEach((d) => next.add(d));
      return next;
    });
  }, []);

  // After a file opens: if the user pinned a folder, reveal the file inside it;
  // otherwise root the tree at the file's own directory.
  const revealInTree = useCallback(
    async (filePath: string) => {
      if (folderPinned && folderRoot) {
        if (within(filePath, folderRoot)) await revealPath(filePath, folderRoot);
        return;
      }
      const dir = dirOf(filePath);
      try {
        const kids = await invoke<DirEntry[]>("list_dir", { path: dir });
        setFolderRoot(dir);
        setDirCache((prev) => ({ ...prev, [dir]: kids }));
        setTreeOpen(true);
      } catch {
        /* leave the tree as-is if the directory can't be listed */
      }
    },
    [folderPinned, folderRoot, revealPath],
  );

  // Cold start: reopen the last folder the user was in (persisted across runs),
  // falling back to the home folder, so the tree shows where they left off.
  useEffect(() => {
    void (async () => {
      const list = async (p: string) => {
        try {
          return await invoke<DirEntry[]>("list_dir", { path: p });
        } catch {
          return null;
        }
      };
      let saved: string | null = null;
      let pinned = false;
      try {
        saved = localStorage.getItem("tuhi.folderRoot");
        pinned = localStorage.getItem("tuhi.folderPinned") === "1";
      } catch {
        /* no persisted location */
      }
      let root = saved;
      let kids = root ? await list(root) : null;
      if (!kids) {
        pinned = false;
        try {
          root = await invoke<string | null>("home_dir");
        } catch {
          root = null;
        }
        kids = root ? await list(root) : null;
      }
      if (!root || !kids) return;
      const r = root;
      const k = kids;
      setFolderRoot((cur) => cur ?? r);
      setFolderPinned(pinned);
      setDirCache((prev) => (r in prev ? prev : { ...prev, [r]: k }));
      setTreeOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the current folder root so the next launch reopens it.
  useEffect(() => {
    try {
      if (folderRoot) localStorage.setItem("tuhi.folderRoot", folderRoot);
      localStorage.setItem("tuhi.folderPinned", folderPinned ? "1" : "0");
    } catch {
      /* persistence is best-effort */
    }
  }, [folderRoot, folderPinned]);

  // Keep the active file scrolled into view in the tree when it or the layout changes.
  useEffect(() => {
    if (!treeOpen) return;
    document.querySelector(".ft-row.file.active")?.scrollIntoView({ block: "nearest" });
  }, [meta?.path, expanded, dirCache, treeOpen]);
  const [rangeStart, setRangeStart] = useState(0);
  const [windowBase, setWindowBase] = useState(0); // char index of rangeStart's line
  const [caret, setCaret] = useState<Caret | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null); // selection anchor char index
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Find / replace
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<Array<[number, number]>>([]);
  const [activeMatch, setActiveMatch] = useState(0);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const charWidthRef = useRef(7.8);
  const hlTimer = useRef<number | null>(null);

  const lineCount = meta?.line_count ?? 0;
  const charCount = meta?.char_count ?? 0;
  const readonly = meta?.readonly ?? false;

  useEffect(() => {
    if (measureRef.current) {
      const w = measureRef.current.getBoundingClientRect().width / 20;
      if (w > 0) charWidthRef.current = w;
    }
  }, []);

  const fetchViewport = useCallback(async (start: number, count: number) => {
    try {
      const [got, base] = await Promise.all([
        invoke<ViewportLine[]>("get_viewport", { start, count }),
        invoke<number>("pos_to_char", { line: start, col: 0 }),
      ]);
      setLines(got);
      setRangeStart(start);
      setWindowBase(base);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const recomputeViewport = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !meta) return;
    const first = Math.max(0, Math.floor(el.scrollTop / LINE_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(el.clientHeight / LINE_HEIGHT) + OVERSCAN * 2;
    void fetchViewport(first, visible);
  }, [meta, fetchViewport]);

  useEffect(() => {
    recomputeViewport();
  }, [meta, recomputeViewport]);

  // Refresh the outline when the active document changes (open/switch/close); edits
  // refresh it via the debounced rehighlight below.
  useEffect(() => {
    if (meta) void refreshOutline();
    else setOutline([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, meta?.path, refreshOutline]);

  const ensureCaretVisible = useCallback((line: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = line * LINE_HEIGHT;
    const bottom = top + LINE_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, []);

  const setCaretFromIdx = useCallback(
    async (idx: number) => {
      try {
        const pos = await invoke<CaretPos>("char_to_pos", { charIdx: idx });
        setCaret({ idx, line: pos.line, col: pos.col });
        ensureCaretVisible(pos.line);
      } catch (e) {
        setError(String(e));
      }
    },
    [ensureCaretVisible],
  );

  // Apply a fresh tab registry state (from open/switch/close/list) to the UI.
  const applyTabsState = useCallback(
    async (ts: TabsState) => {
      setTabs(ts.tabs);
      setActiveTabId(ts.active);
      setAnchor(null);
      setFindOpen(false);
      setMeta(ts.meta);
      if (ts.meta) {
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
        if (ts.meta.readonly) setCaret(null);
        else await setCaretFromIdx(0);
        scrollerRef.current?.focus();
      } else {
        setCaret(null);
        setLines([]);
      }
    },
    [setCaretFromIdx],
  );

  const switchTab = useCallback(
    async (id: number) => {
      try {
        await applyTabsState(await invoke<TabsState>("switch_tab", { id }));
      } catch (e) {
        setError(String(e));
      }
    },
    [applyTabsState],
  );

  const closeTab = useCallback(
    async (id: number) => {
      try {
        await applyTabsState(await invoke<TabsState>("close_tab", { id }));
      } catch (e) {
        setError(String(e));
      }
    },
    [applyTabsState],
  );

  const closeActiveTab = useCallback(async () => {
    if (activeTabId != null) await closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  // Highlighting is off the keystroke path: recompute ~180 ms after typing stops,
  // then refresh the viewport so the new colours show. Keeps typing instant.
  const scheduleRehighlight = useCallback(() => {
    if (hlTimer.current != null) clearTimeout(hlTimer.current);
    hlTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          setMeta(await invoke<DocumentMeta>("refresh_highlights"));
          await refreshOutline();
        } catch {
          /* ignore */
        }
      })();
    }, 180);
  }, [refreshOutline]);

  const hasSelection = () => anchor !== null && caret !== null && anchor !== caret.idx;
  const selRange = (): [number, number] | null => {
    if (!hasSelection() || !caret) return null;
    return [Math.min(anchor!, caret.idx), Math.max(anchor!, caret.idx)];
  };

  // Delete the active selection; return the char index the caret should land on.
  const deleteSelection = useCallback(async (): Promise<number> => {
    const r = selRange();
    if (!r || !caret) return caret?.idx ?? 0;
    const [a, b] = r;
    setMeta(await invoke<DocumentMeta>("delete_range", { start: a, end: b }));
    setAnchor(null);
    return a;
  }, [anchor, caret]);

  const handleOpen = useCallback(async () => {
    setError(null);
    const selected = await openDialog({ multiple: false, directory: false });
    if (typeof selected !== "string") return;
    setBusy(true);
    try {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      await applyTabsState(await invoke<TabsState>("open_document", { path: selected, dark }));
      void revealInTree(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [applyTabsState, revealInTree]);

  const handleSave = useCallback(async () => {
    if (!meta) return;
    setError(null);
    let target: string | null = meta.path;
    if (!target) {
      const chosen = await saveDialog({});
      if (typeof chosen !== "string") return;
      target = chosen;
    }
    try {
      setMeta(await invoke<DocumentMeta>("save_document", { path: target }));
    } catch (e) {
      setError(String(e));
    }
  }, [meta]);

  // Open a file by path (from the tree or the palette), reusing the tab machinery.
  const openPath = useCallback(
    async (path: string) => {
      setError(null);
      setBusy(true);
      try {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        await applyTabsState(await invoke<TabsState>("open_document", { path, dark }));
        void revealInTree(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [applyTabsState, revealInTree],
  );

  const openFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    try {
      const kids = await invoke<DirEntry[]>("list_dir", { path: selected });
      setFolderRoot(selected);
      setFolderPinned(true);
      setDirCache({ [selected]: kids });
      setExpanded(new Set());
      setTreeOpen(true);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Expand/collapse a folder, lazily listing its children the first time.
  const toggleDir = useCallback(
    async (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (!(path in dirCache)) {
        try {
          const kids = await invoke<DirEntry[]>("list_dir", { path });
          setDirCache((prev) => ({ ...prev, [path]: kids }));
        } catch (e) {
          setError(String(e));
        }
      }
    },
    [dirCache],
  );

  const jumpToLine = useCallback(
    async (line: number) => {
      try {
        const idx = await invoke<number>("pos_to_char", { line, col: 0 });
        await setCaretFromIdx(idx);
        scrollerRef.current?.focus();
      } catch (e) {
        setError(String(e));
      }
    },
    [setCaretFromIdx],
  );

  const openPalette = useCallback(() => {
    setPaletteQuery("");
    setPaletteIndex(0);
    setPaletteOpen(true);
  }, []);

  // --- Editing. Every op goes through the char-indexed Rust buffer. ---

  const insertText = useCallback(
    async (text: string) => {
      if (!caret) return;
      try {
        const at = hasSelection() ? await deleteSelection() : caret.idx;
        setMeta(await invoke<DocumentMeta>("insert_text", { charIdx: at, text }));
        await setCaretFromIdx(at + [...text].length);
        scheduleRehighlight();
      } catch (e) {
        setError(String(e));
      }
    },
    [caret, anchor, deleteSelection, setCaretFromIdx],
  );

  const backspace = useCallback(async () => {
    if (!caret) return;
    try {
      if (hasSelection()) {
        await setCaretFromIdx(await deleteSelection());
        scheduleRehighlight();
        return;
      }
      if (caret.idx > 0) {
        setMeta(await invoke<DocumentMeta>("delete_range", { start: caret.idx - 1, end: caret.idx }));
        await setCaretFromIdx(caret.idx - 1);
        scheduleRehighlight();
      }
    } catch (e) {
      setError(String(e));
    }
  }, [caret, anchor, deleteSelection, setCaretFromIdx]);

  const forwardDelete = useCallback(async () => {
    if (!caret) return;
    try {
      if (hasSelection()) {
        await setCaretFromIdx(await deleteSelection());
        scheduleRehighlight();
        return;
      }
      if (caret.idx < charCount) {
        setMeta(await invoke<DocumentMeta>("delete_range", { start: caret.idx, end: caret.idx + 1 }));
        await setCaretFromIdx(caret.idx);
        scheduleRehighlight();
      }
    } catch (e) {
      setError(String(e));
    }
  }, [caret, anchor, charCount, deleteSelection, setCaretFromIdx]);

  // --- Clipboard ---

  const copy = useCallback(async () => {
    const r = selRange();
    if (!r) return;
    try {
      const text = await invoke<string>("read_range", { start: r[0], end: r[1] });
      await writeText(text);
    } catch (e) {
      setError(String(e));
    }
  }, [anchor, caret]);

  const cut = useCallback(async () => {
    const r = selRange();
    if (!r) return;
    try {
      const text = await invoke<string>("read_range", { start: r[0], end: r[1] });
      await writeText(text);
      await setCaretFromIdx(await deleteSelection());
      scheduleRehighlight();
    } catch (e) {
      setError(String(e));
    }
  }, [anchor, caret, deleteSelection, setCaretFromIdx]);

  const paste = useCallback(async () => {
    try {
      const text = await readText();
      if (text) await insertText(text);
    } catch (e) {
      setError(String(e));
    }
  }, [insertText]);

  const selectAll = useCallback(() => {
    if (!meta) return;
    setAnchor(0);
    void setCaretFromIdx(meta.char_count);
  }, [meta, setCaretFromIdx]);

  // --- Find / replace (editable files only) ---

  const runSearch = useCallback(
    async (q: string) => {
      if (!meta || readonly || !q) {
        setMatches([]);
        return;
      }
      try {
        const ms = await invoke<Array<[number, number]>>("search", {
          query: q,
          useRegex,
          caseSensitive,
        });
        setMatches(ms);
        setActiveMatch(0);
        if (ms.length) {
          setAnchor(ms[0][0]);
          await setCaretFromIdx(ms[0][1]);
        }
      } catch (e) {
        setError(String(e));
        setMatches([]);
      }
    },
    [meta, readonly, useRegex, caseSensitive, setCaretFromIdx],
  );

  const gotoMatch = useCallback(
    async (k: number) => {
      if (!matches.length) return;
      const i = ((k % matches.length) + matches.length) % matches.length;
      setActiveMatch(i);
      setAnchor(matches[i][0]);
      await setCaretFromIdx(matches[i][1]);
    },
    [matches, setCaretFromIdx],
  );

  const doReplaceAll = useCallback(async () => {
    if (!meta || readonly || !findQuery) return;
    try {
      const res = await invoke<{ meta: DocumentMeta; count: number }>("replace_all", {
        query: findQuery,
        useRegex,
        caseSensitive,
        replacement: replaceText,
      });
      setMeta(res.meta);
      setMatches([]);
      setAnchor(null);
    } catch (e) {
      setError(String(e));
    }
  }, [meta, readonly, findQuery, replaceText, useRegex, caseSensitive]);

  const openFind = useCallback(
    (replace: boolean) => {
      if (!meta || readonly) return;
      setFindOpen(true);
      setShowReplace(replace);
      setTimeout(() => findInputRef.current?.focus(), 0);
    },
    [meta, readonly],
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setMatches([]);
    scrollerRef.current?.focus();
  }, []);

  // Re-run the search as the query or options change while the bar is open.
  useEffect(() => {
    if (findOpen) void runSearch(findQuery);
  }, [findQuery, useRegex, caseSensitive, findOpen, runSearch]);

  // Restore any open tabs on mount (a fresh app has none).
  useEffect(() => {
    void (async () => {
      try {
        const ts = await invoke<TabsState>("list_tabs");
        if (ts.tabs.length) await applyTabsState(ts);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts owned by the front end. There is no native menu bar (Studio
  // leads with the rail + command palette); WebView2 also swallows browser combos,
  // so every shortcut is handled here with preventDefault.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "o":
          e.preventDefault();
          void handleOpen();
          break;
        case "s":
          if (meta && !readonly) {
            e.preventDefault();
            void handleSave();
          }
          break;
        case "w":
          if (meta) {
            e.preventDefault();
            void closeActiveTab();
          }
          break;
        case "f":
          if (meta && !readonly) {
            e.preventDefault();
            openFind(false);
          }
          break;
        case "h":
          if (meta && !readonly) {
            e.preventDefault();
            openFind(true);
          }
          break;
        case "p":
          e.preventDefault();
          setPaletteQuery("");
          setPaletteIndex(0);
          setPaletteOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpen, handleSave, closeActiveTab, openFind, meta, readonly]);

  // --- Movement (extend = hold Shift to grow the selection) ---

  const moveCaretTo = useCallback(
    async (newIdx: number, extend: boolean) => {
      if (extend) {
        if (anchor === null && caret) setAnchor(caret.idx);
      } else {
        setAnchor(null);
      }
      await setCaretFromIdx(newIdx);
    },
    [anchor, caret, setCaretFromIdx],
  );

  const moveToLinePos = useCallback(
    async (line: number, col: number, extend: boolean) => {
      try {
        await moveCaretTo(await invoke<number>("pos_to_char", { line, col }), extend);
      } catch (e) {
        setError(String(e));
      }
    },
    [moveCaretTo],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!caret || !meta) return;

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "c": e.preventDefault(); void copy(); return;
        case "x": e.preventDefault(); void cut(); return;
        case "v": e.preventDefault(); void paste(); return;
        case "a": e.preventDefault(); selectAll(); return;
        default: return; // Ctrl+O/S/F/H are handled by the window-level listener
      }
    }
    if (e.altKey) return;

    const extend = e.shiftKey;
    switch (e.key) {
      case "Backspace": e.preventDefault(); void backspace(); return;
      case "Delete": e.preventDefault(); void forwardDelete(); return;
      case "Enter": e.preventDefault(); void insertText("\n"); return;
      case "Tab": e.preventDefault(); void insertText("\t"); return;
      case "ArrowLeft":
        e.preventDefault();
        if (caret.idx > 0) void moveCaretTo(caret.idx - 1, extend);
        return;
      case "ArrowRight":
        e.preventDefault();
        if (caret.idx < charCount) void moveCaretTo(caret.idx + 1, extend);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (caret.line > 0) void moveToLinePos(caret.line - 1, caret.col, extend);
        return;
      case "ArrowDown":
        e.preventDefault();
        if (caret.line < lineCount - 1) void moveToLinePos(caret.line + 1, caret.col, extend);
        return;
      case "Home": e.preventDefault(); void moveToLinePos(caret.line, 0, extend); return;
      case "End": e.preventDefault(); void moveToLinePos(caret.line, Number.MAX_SAFE_INTEGER, extend); return;
      default:
        if (e.key.length === 1) { e.preventDefault(); void insertText(e.key); }
    }
  };

  const clickLine = (lineIndex: number, offsetX: number, extend: boolean) => {
    const col = Math.max(0, Math.round(offsetX / charWidthRef.current));
    void moveToLinePos(lineIndex, col, extend);
    scrollerRef.current?.focus();
  };

  // --- Render geometry ---

  const topPad = rangeStart * LINE_HEIGHT;
  const totalHeight = Math.max(lineCount, 1) * LINE_HEIGHT;
  const cw = charWidthRef.current;
  const caretVisible = caret && caret.line >= rangeStart && caret.line < rangeStart + lines.length;

  // Per-line start char offsets within the window, from the strings themselves
  // ([...s].length counts code points == Rust chars, so astral text stays correct).
  const lineStarts: number[] = [];
  {
    let acc = windowBase;
    for (const ln of lines) {
      lineStarts.push(acc);
      acc += ln.chars;
    }
  }

  const sel = selRange();
  const selRects: { line: number; left: number; width: number }[] = [];
  if (sel) {
    for (let i = 0; i < lines.length; i++) {
      const s = lineStarts[i];
      const full = lines[i].chars;
      const textLen = [...lines[i].text.replace(/\r?\n$/, "")].length;
      if (sel[1] > s && sel[0] < s + full) {
        const c1 = Math.max(0, Math.min(sel[0] - s, textLen));
        const c2 = Math.min(Math.max(sel[1] - s, 0), textLen);
        const extra = sel[1] > s + textLen ? 0.6 : 0; // show a selected line break
        selRects.push({
          line: rangeStart + i,
          left: GUTTER + c1 * cw,
          width: Math.max((c2 - c1 + extra) * cw, extra * cw),
        });
      }
    }
  }

  const findRects: { line: number; left: number; width: number }[] = [];
  if (findOpen && matches.length && lines.length) {
    const windowEnd = lineStarts[lines.length - 1] + lines[lines.length - 1].chars;
    for (const [a, b] of matches) {
      if (b <= windowBase || a >= windowEnd) continue;
      for (let i = 0; i < lines.length; i++) {
        const s = lineStarts[i];
        const full = lines[i].chars;
        const textLen = [...lines[i].text.replace(/\r?\n$/, "")].length;
        if (b > s && a < s + full) {
          const c1 = Math.max(0, Math.min(a - s, textLen));
          const c2 = Math.min(Math.max(b - s, 0), textLen);
          findRects.push({
            line: rangeStart + i,
            left: GUTTER + c1 * cw,
            width: Math.max((c2 - c1) * cw, 2),
          });
        }
      }
    }
  }

  // ---- render-time helpers for the Studio panels ----
  const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

  const renderDir = (dirPath: string, depth: number): React.ReactNode => {
    const kids = dirCache[dirPath];
    if (!kids) return null;
    return kids.map((e) =>
      e.is_dir ? (
        <div key={e.path}>
          <div className="ft-row" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => void toggleDir(e.path)}>
            <span className={`ft-caret${expanded.has(e.path) ? " open" : ""}`}>▸</span>
            <IconFolder />
            <span className="ft-name">{e.name}</span>
          </div>
          {expanded.has(e.path) && renderDir(e.path, depth + 1)}
        </div>
      ) : (
        <div
          key={e.path}
          className={`ft-row file${meta?.path === e.path ? " active" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 + 16 }}
          onClick={() => void openPath(e.path)}
        >
          <IconFile />
          <span className="ft-name">{e.name}</span>
        </div>
      ),
    );
  };

  const paletteFiltered: PaletteItem[] = [];
  if (paletteOpen) {
    const items: PaletteItem[] = [
      { label: "Open File…", hint: "Ctrl+O", run: () => void handleOpen() },
      { label: "Open Folder…", run: () => void openFolder() },
      ...(meta ? [{ label: "Save", hint: "Ctrl+S", run: () => void handleSave() }] : []),
      ...(meta && !readonly ? [{ label: "Find…", hint: "Ctrl+F", run: () => openFind(false) }] : []),
      { label: "Toggle File Tree", run: () => setTreeOpen((v) => !v) },
      { label: "Toggle Outline", run: () => setOutlineOpen((v) => !v) },
      ...tabs.map((t) => ({ label: t.name, hint: "tab", run: () => void switchTab(t.id) })),
      ...Object.values(dirCache)
        .flat()
        .filter((e) => !e.is_dir)
        .map((e) => ({ label: e.name, hint: "file", run: () => void openPath(e.path) })),
    ];
    const q = paletteQuery.trim().toLowerCase();
    const matched = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
    paletteFiltered.push(...matched.slice(0, 50));
  }

  const onPaletteKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setPaletteOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setPaletteIndex((i) => Math.min(i + 1, paletteFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPaletteIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = paletteFiltered[paletteIndex];
      if (it) {
        it.run();
        setPaletteOpen(false);
      }
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brandcell">
          <Mark size={26} />
          <span className="brand-word">tuhi</span>
        </div>
        <div className="tabstrip">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab${t.active ? " active" : ""}`}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(t.id); // middle-click closes
                }
              }}
              onClick={() => {
                if (!t.active) void switchTab(t.id);
              }}
              title={t.name}
            >
              <span className="tab-name">{t.name}</span>
              {t.dirty && <span className="tab-dot" title="Unsaved changes">•</span>}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(t.id);
                }}
                title="Close (Ctrl+W)"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {busy && <span className="busy">Opening…</span>}
      </header>
      <div className="body">
      <nav className="rail">
        <button className={`rail-btn${treeOpen ? " on" : ""}`} onClick={() => setTreeOpen((v) => !v)} title="Files">
          <IconTree />
        </button>
        <button className={`rail-btn${outlineOpen ? " on" : ""}`} onClick={() => setOutlineOpen((v) => !v)} title="Outline">
          <IconList />
        </button>
        <button className="rail-btn" onClick={() => openFind(false)} disabled={!meta || readonly} title="Find (Ctrl+F)">
          <IconSearch />
        </button>
        <button className="rail-btn" onClick={openPalette} title="Command palette (Ctrl+P)">
          <IconCommand />
        </button>
        <span className="rail-spacer" />
        <button className="rail-btn" disabled title="Settings — coming soon">
          <IconSettings />
        </button>
      </nav>
      {treeOpen && (
        <aside className="filetree">
          <div className="ft-head">
            <span className="ft-title" title={folderRoot ?? ""}>{folderRoot ? baseName(folderRoot) : "Explorer"}</span>
            <span className="ft-sp" />
            <button className="ft-icn" onClick={() => void handleOpen()} title="Open file (Ctrl+O)">
              <IconOpen />
            </button>
            <button className="ft-icn" onClick={() => void openFolder()} title="Open folder…">
              <IconFolder />
            </button>
          </div>
          <div className="ft-body">
            {folderRoot ? renderDir(folderRoot, 0) : <p className="ft-empty">Open a folder to browse files.</p>}
          </div>
        </aside>
      )}
      <div className="app">

      {error && <div className="error">{error}</div>}

      {findOpen && (
        <div className="findbar">
          <div className="find-row">
            <input
              ref={findInputRef}
              className="find-input"
              placeholder="Find"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  void gotoMatch(e.shiftKey ? activeMatch - 1 : activeMatch + 1);
                }
              }}
            />
            <span className="find-count">
              {matches.length ? `${activeMatch + 1} / ${matches.length}` : "0 results"}
            </span>
            <button className="find-btn" onClick={() => void gotoMatch(activeMatch - 1)} title="Previous (Shift+Enter)">↑</button>
            <button className="find-btn" onClick={() => void gotoMatch(activeMatch + 1)} title="Next (Enter)">↓</button>
            <button className={`find-toggle${caseSensitive ? " on" : ""}`} onClick={() => setCaseSensitive((v) => !v)} title="Match case">Aa</button>
            <button className={`find-toggle${useRegex ? " on" : ""}`} onClick={() => setUseRegex((v) => !v)} title="Regular expression">.*</button>
            <button className={`find-toggle${showReplace ? " on" : ""}`} onClick={() => setShowReplace((v) => !v)} title="Toggle replace">⇄</button>
            <button className="find-btn" onClick={closeFind} title="Close (Esc)">✕</button>
          </div>
          {showReplace && (
            <div className="find-row">
              <input
                className="find-input"
                placeholder="Replace"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
              />
              <button className="find-btn wide" onClick={() => void doReplaceAll()}>Replace all</button>
            </div>
          )}
        </div>
      )}

      <div className="workarea">
      <div
        className="scroller"
        ref={scrollerRef}
        tabIndex={0}
        onScroll={recomputeViewport}
        onKeyDown={onKeyDown}
      >
        {meta ? (
          <div className="sizer" style={{ height: totalHeight }}>
            <div className="viewport" style={{ transform: `translateY(${topPad}px)` }}>
              {findRects.map((r, idx) => (
                <div
                  key={`find-${idx}`}
                  className="find-match"
                  style={{ top: (r.line - rangeStart) * LINE_HEIGHT, left: r.left, width: r.width }}
                />
              ))}
              {selRects.map((r) => (
                <div
                  key={`sel-${r.line}`}
                  className="selection"
                  style={{ top: (r.line - rangeStart) * LINE_HEIGHT, left: r.left, width: r.width }}
                />
              ))}
              {lines.map((ln, i) => {
                const lineIndex = rangeStart + i;
                return (
                  <div className="line" key={lineIndex}>
                    <span className="gutter">{lineIndex + 1}</span>
                    <span
                      className="text"
                      onMouseDown={(e) => clickLine(lineIndex, e.nativeEvent.offsetX, e.shiftKey)}
                    >
                      {renderLine(ln.text.replace(/\r?\n$/, ""), ln.spans)}
                      {ln.truncated && (
                        <span className="trunc"> ⋯ line too long ({ln.chars.toLocaleString()} chars)</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {caretVisible && (
                <div
                  className="caret-cursor"
                  style={{ top: (caret!.line - rangeStart) * LINE_HEIGHT, left: GUTTER + caret!.col * cw }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="empty">
            <Mark size={72} />
            <div className="empty-word">tuhi</div>
            <p className="empty-tag">A fast, open place to write.</p>
            <p className="hint">
              Open a file with <b>Ctrl+O</b>, or pick one from the file tree. tuhi
              fetches only the lines on screen from a Rust buffer, so large files open
              and scroll without loading into the view.
            </p>
          </div>
        )}
      </div>
      {outlineOpen && meta && (
        <aside className="outline-panel">
          <div className="op-head">Outline</div>
          <div className="op-body">
            {outline.length ? (
              outline.map((o, i) => (
                <div
                  key={`${o.line}-${i}`}
                  className={`op-row lvl${o.level}`}
                  onClick={() => void jumpToLine(o.line)}
                  title={o.title}
                >
                  {o.title}
                </div>
              ))
            ) : (
              <p className="op-empty">No headings</p>
            )}
          </div>
        </aside>
      )}
      </div>

      <footer className="statusbar">
        <span className="path">{meta?.path ?? "No file"}</span>
        {readonly && <span className="badge-ro">read-only · large file</span>}
        <span className="spacer" />
        {meta && !readonly && (
          <span className="pos" title="syntax spans in view (diagnostic)">
            hl {lines.reduce((n, l) => n + l.spans.length, 0)}
          </span>
        )}
        {caret && <span className="pos">Ln {caret.line + 1}, Col {caret.col + 1}</span>}
        {meta && (
          <span className="counts">
            {meta.line_count.toLocaleString()} lines · {meta.char_count.toLocaleString()} chars
            {meta.dirty ? " · modified" : ""}
          </span>
        )}
      </footer>

      <span ref={measureRef} className="measure" aria-hidden="true">
        00000000000000000000
      </span>
      </div>
      </div>
      {paletteOpen && (
        <div className="palette-overlay" onMouseDown={() => setPaletteOpen(false)}>
          <div className="palette-modal" onMouseDown={(e) => e.stopPropagation()}>
            <input
              className="palette-input"
              autoFocus
              placeholder="Go to file, or run a command…"
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value);
                setPaletteIndex(0);
              }}
              onKeyDown={onPaletteKey}
            />
            <div className="palette-list">
              {paletteFiltered.length ? (
                paletteFiltered.map((it, i) => (
                  <div
                    key={`${it.label}-${i}`}
                    className={`palette-item${i === paletteIndex ? " on" : ""}`}
                    onMouseEnter={() => setPaletteIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      it.run();
                      setPaletteOpen(false);
                    }}
                  >
                    <span className="pl-label">{it.label}</span>
                    {it.hint && <span className="pl-hint">{it.hint}</span>}
                  </div>
                ))
              ) : (
                <div className="palette-empty">No matches</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
