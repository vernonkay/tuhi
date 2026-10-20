import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  path: string | null;
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

/** Mirror of the Rust `EditResult`: doc meta plus the caret after an insert. */
interface EditResult {
  meta: DocumentMeta;
  caret: CaretPos;
}

/** Mirror of the Rust `EditOutcome`: doc meta after undo/redo + the caret target
 *  (`caret` is null when there was nothing to undo/redo). */
interface EditOutcome {
  meta: DocumentMeta;
  caret: number | null;
}

/** Mirror of the Rust `FilterMatch`: one matching line in the filter view. */
interface FilterMatch {
  line: number;
  text: string;
  truncated: boolean;
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

/** A nested outline entry (children are deeper-level items beneath it). */
interface OutlineNode extends OutlineItem {
  children: OutlineNode[];
}

/** Build a tree from the flat, in-document-order outline using heading/indent level:
 *  each item nests under the nearest preceding item of a smaller level. */
function buildOutlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const it of items) {
    const node: OutlineNode = { ...it, children: [] };
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** A command-palette entry: a label, an optional hint, its group, and its action. */
type PaletteItem = { label: string; hint?: string; kind: "command" | "tab" | "file"; run: () => void };

/** The directory part of a path (handles both `/` and `\`). */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

/** True when `child` is strictly inside directory `root`. */
function within(child: string, root: string): boolean {
  return child.startsWith(root + "/") || child.startsWith(root + "\\");
}

/** The directory to navigate "up" into, or null when `dir` is already a filesystem root.
 *  Normalises a bare Windows drive ("C:") to its root ("C:\\") so it lists correctly. */
function parentDir(dir: string): string | null {
  const p = dirOf(dir);
  const norm = /^[A-Za-z]:$/.test(p) ? p + "\\" : p;
  if (p === dir || norm === dir) return null;
  return norm;
}

/** A recently opened file or folder, persisted so the welcome view can offer it back. */
type RecentEntry = { path: string; kind: "folder" | "file" };

const LS_LAST_FOLDER = "tuhi.lastFolder";
const LS_RECENT = "tuhi.recent";

function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    if (raw) return JSON.parse(raw) as RecentEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

function pushRecent(path: string, kind: RecentEntry["kind"]): void {
  try {
    const list = loadRecent().filter((e) => e.path !== path);
    list.unshift({ path, kind });
    localStorage.setItem(LS_RECENT, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* ignore */
  }
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
const GUTTER = 64; // `.gutter` border-box width; its 12px padding-right sits INSIDE it
// Mirrors the Rust 2 MB WHOLE-document highlight cap (HIGHLIGHT_MAX_BYTES), in
// characters. Above it the document isn't highlighted eagerly, so the debounced
// whole-document rehighlight + outline rebuild after each edit is skipped (it would hold
// the Rust lock and stall the next keystroke); the visible window is coloured on demand
// via `request_highlight` instead, and the outline built on open is kept as-is.
const HIGHLIGHT_MAX_CHARS = 2 * 1024 * 1024;

/** Platform-appropriate shortcut label: "⌘O" on macOS, "Ctrl+O" elsewhere. */
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const combo = (key: string) => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`);

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
function IconFilter() {
  return (
    <svg {...iconProps}>
      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
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
function IconSettings() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function App() {
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [lines, setLines] = useState<ViewportLine[]>([]);

  // Snapshot the saved session once at first render, before the persist effect can
  // overwrite it, so the restore-on-mount effect reads a stable value.
  const [savedSession] = useState<{ files: string[]; active: string | null }>(() => {
    try {
      const files = JSON.parse(localStorage.getItem("tuhi.openFiles") || "[]");
      return {
        files: Array.isArray(files) ? files : [],
        active: localStorage.getItem("tuhi.activeFile"),
      };
    } catch {
      return { files: [], active: null };
    }
  });

  // Studio chrome: one left panel showing Files OR Outline (rail switches it), plus
  // the command palette. `null` = the left panel is collapsed.
  const [leftPanel, setLeftPanel] = useState<"files" | "outline" | null>("files");
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    try {
      const w = Number(localStorage.getItem("tuhi.treeWidth"));
      if (w >= 140 && w <= 600) return w;
    } catch {
      /* default below */
    }
    return 220;
  });
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [folderPinned, setFolderPinned] = useState(false);
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());
  const [dirCache, setDirCache] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [outlineExpanded, setOutlineExpanded] = useState<Set<number>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterMatches, setFilterMatches] = useState<FilterMatch[]>([]);
  const [followOn, setFollowOn] = useState(false);
  const [hlEditorOpen, setHlEditorOpen] = useState(false);
  const [hlFromSettings, setHlFromSettings] = useState(false); // did the rules editor open from Settings?
  const [highlighters, setHighlighters] = useState<{ pattern: string; color: string }[]>(() => {
    try {
      const raw = localStorage.getItem("tuhi.highlighters");
      if (raw) return JSON.parse(raw);
    } catch {
      /* fall through to defaults */
    }
    return [
      { pattern: "error|fatal|panic", color: "#ff5a36" },
      { pattern: "warn", color: "#ffb81d" },
    ];
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => {
    try {
      const t = localStorage.getItem("tuhi.theme");
      if (t === "light" || t === "dark" || t === "auto") return t;
    } catch {
      /* default below */
    }
    return "auto";
  });

  // Close the highlighter rules editor, returning to Settings if it opened from there
  // (it's a modal reached from within Settings, not a sibling of the editor).
  const closeHlEditor = useCallback(() => {
    setHlEditorOpen(false);
    if (hlFromSettings) {
      setHlFromSettings(false);
      setSettingsOpen(true);
    }
  }, [hlFromSettings]);

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
      } catch {
        /* leave the tree as-is if the directory can't be listed */
      }
    },
    [folderPinned, folderRoot, revealPath],
  );

  // Persist the file-tree width so a resize sticks across launches.
  useEffect(() => {
    try {
      localStorage.setItem("tuhi.treeWidth", String(treeWidth));
    } catch {
      /* best-effort */
    }
  }, [treeWidth]);

  // Drag the divider on the tree's right edge to resize the panel.
  const startTreeResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = treeWidth;
      const onMove = (ev: MouseEvent) =>
        setTreeWidth(Math.min(600, Math.max(140, startW + (ev.clientX - startX))));
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [treeWidth],
  );

  // Cold start: reopen the folder you last had open (pinned), or show the welcome
  // state. We deliberately do NOT dump you into your home directory — that first view
  // was noise, and the only thing it gave you was a tree you had to climb back out of.
  useEffect(() => {
    void (async () => {
      setLeftPanel("files");
      let last: { path: string } | null = null;
      try {
        const raw = localStorage.getItem(LS_LAST_FOLDER);
        if (raw) last = JSON.parse(raw);
      } catch {
        /* fall through to the welcome state */
      }
      if (!last?.path) return; // first run → welcome view renders
      try {
        const kids = await invoke<DirEntry[]>("list_dir", { path: last.path });
        setFolderRoot((cur) => cur ?? last!.path);
        setFolderPinned(true);
        setDirCache((prev) => (last!.path in prev ? prev : { ...prev, [last!.path]: kids }));
      } catch {
        // The folder is gone or unreadable: forget it and show the welcome view.
        try {
          localStorage.removeItem(LS_LAST_FOLDER);
        } catch {
          /* ignore */
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the last deliberately-opened folder (a pinned root) for next launch.
  // Transient re-roots from opening a file are not pinned, so they are not persisted.
  useEffect(() => {
    if (!folderRoot || !folderPinned) return;
    try {
      localStorage.setItem(LS_LAST_FOLDER, JSON.stringify({ path: folderRoot }));
    } catch {
      /* best-effort */
    }
  }, [folderRoot, folderPinned]);

  // Keep the active file scrolled into view in the tree when it or the layout changes.
  useEffect(() => {
    if (leftPanel !== "files") return;
    document.querySelector(".ft-row.file.active")?.scrollIntoView({ block: "nearest" });
  }, [meta?.path, expanded, dirCache, leftPanel]);
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
  const [, bumpCw] = useState(0); // forces a re-render after the glyph width is re-measured
  const caretMeasureRef = useRef<HTMLSpanElement>(null);
  const [caretLeft, setCaretLeft] = useState<number | null>(null);
  const hlTimer = useRef<number | null>(null);
  // The current effective "dark" (resolved from the theme setting), read by the
  // open/reload calls that tell Rust which syntax theme to use.
  const darkRef = useRef(false);

  // --- Synchronous edit pipeline ---
  // React state updates a frame late, so a fast burst of keystrokes would each read a
  // stale caret and insert characters at the wrong offset, out of order (the "scramble"
  // bug). We keep the caret, anchor and char count in refs that update synchronously,
  // coalesce typed characters into one buffered insert per animation frame, and run
  // every mutation through a promise chain so edits apply strictly in order and never
  // overlap in flight.
  const caretRef = useRef<Caret | null>(null);
  const anchorRef = useRef<number | null>(null);
  const charCountRef = useRef(0);
  const typeBufRef = useRef(""); // characters typed but not yet sent to Rust
  const typeAtRef = useRef(0); // char index where the buffered run begins
  const flushRaf = useRef<number | null>(null); // pending requestAnimationFrame handle
  const editChain = useRef<Promise<void>>(Promise.resolve()); // serialises all edits

  // Viewport (on-demand) highlighting for files over the whole-document cap.
  const rangeStartRef = useRef(0); // latest window start, read by the async highlight merge
  const hlReqToken = useRef(0); // supersedes stale highlight responses
  const hlReqTimer = useRef<number | null>(null); // debounce for highlight requests

  const lineCount = meta?.line_count ?? 0;
  const readonly = meta?.readonly ?? false;

  useEffect(() => {
    const measure = () => {
      if (!measureRef.current) return;
      const w = measureRef.current.getBoundingClientRect().width / 20;
      if (w > 0 && Math.abs(w - charWidthRef.current) > 0.01) {
        charWidthRef.current = w;
        bumpCw((n) => n + 1); // reposition the caret with the corrected width
      }
    };
    measure();
    // Re-measure once fonts settle: the first measure can run before the mono font is
    // applied, and a stale glyph width drifts the caret a little more each column.
    document.fonts?.ready?.then(measure).catch(() => {});
  }, []);

  // Position the caret by measuring the ACTUAL rendered prefix of its line, so it lands
  // exactly on the glyph boundary. `col * glyphWidth` drifts across a line whenever the
  // assumed width is off by a fraction; measuring the real text cannot drift.
  useLayoutEffect(() => {
    const el = caretMeasureRef.current;
    if (!el || !caret || caret.line < rangeStart || caret.line >= rangeStart + lines.length) {
      return;
    }
    const raw = lines[caret.line - rangeStart]?.text ?? "";
    const text = raw.replace(/\r?\n$/, "");
    el.textContent = [...text].slice(0, caret.col).join("");
    setCaretLeft(el.getBoundingClientRect().width);
  }, [caret, lines, rangeStart]);

  // Theme: "auto" follows the OS (and tracks it live); "light"/"dark" force it. The
  // chrome switches via a data-theme attribute (App.css); open docs re-highlight to
  // the matching syntax theme via `set_theme`, which also drives darkRef for new opens.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" ? true : theme === "light" ? false : mq.matches;
      darkRef.current = dark;
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      try {
        localStorage.setItem("tuhi.theme", theme);
      } catch {
        /* best-effort */
      }
      void invoke<DocumentMeta | null>("set_theme", { dark })
        .then((m) => {
          if (m) setMeta(m);
        })
        .catch(() => {
          /* nothing open yet */
        });
    };
    apply();
    if (theme === "auto") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  // Over-cap files aren't highlighted whole-document; ask Rust to colour just this window
  // (off its lock), then merge the spans in — but only if the window hasn't scrolled away
  // and a newer request hasn't superseded this one. Debounced so a fast scroll doesn't
  // fire a parse per frame.
  const requestViewportHighlight = useCallback((start: number, count: number) => {
    if (hlReqTimer.current != null) clearTimeout(hlReqTimer.current);
    const token = ++hlReqToken.current;
    hlReqTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const spans = await invoke<Span[][]>("request_highlight", { start, count });
          if (!spans.length || token !== hlReqToken.current) return;
          setLines((prev) => {
            if (rangeStartRef.current !== start) return prev; // scrolled away
            return prev.map((ln, k) => (spans[k] ? { ...ln, spans: spans[k] } : ln));
          });
        } catch {
          /* highlighting is best-effort; leave the window plain */
        }
      })();
    }, 60);
  }, []);

  const fetchViewport = useCallback(
    async (start: number, count: number) => {
      try {
        const [got, base] = await Promise.all([
          invoke<ViewportLine[]>("get_viewport", { start, count }),
          invoke<number>("pos_to_char", { line: start, col: 0 }),
        ]);
        setLines(got);
        setRangeStart(start);
        rangeStartRef.current = start;
        setWindowBase(base);
        // Large files carry no eager highlights; colour the visible window on demand.
        if (charCountRef.current > HIGHLIGHT_MAX_CHARS) {
          requestViewportHighlight(start, got.length);
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [requestViewportHighlight],
  );

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
        const landed = { idx, line: pos.line, col: pos.col };
        caretRef.current = landed;
        setCaret(landed);
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
        const ts = await invoke<TabsState>("switch_tab", { id });
        await applyTabsState(ts);
        // Make the tree follow the active file, so it always reflects what you're on.
        if (ts.meta?.path) void revealInTree(ts.meta.path);
      } catch (e) {
        setError(String(e));
      }
    },
    [applyTabsState, revealInTree],
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
    // Over the highlight cap there is nothing to recolour and the outline rebuild would
    // scan the whole (huge) document on every pause, stalling typing. Skip it; the
    // outline from open stays until the file is reopened.
    if (charCountRef.current > HIGHLIGHT_MAX_CHARS) return;
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

  // Keep the synchronous refs mirrored to the React state for the call sites that set
  // caret/anchor outside the edit pipeline (open, switch tab, click, find, undo).
  useEffect(() => {
    caretRef.current = caret;
  }, [caret]);
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);
  useEffect(() => {
    if (meta) charCountRef.current = meta.char_count;
  }, [meta]);

  const hasSelection = () => anchor !== null && caret !== null && anchor !== caret.idx;
  const selRange = (): [number, number] | null => {
    if (!hasSelection() || !caret) return null;
    return [Math.min(anchor!, caret.idx), Math.max(anchor!, caret.idx)];
  };

  // Selection range from the synchronous refs (used inside serialized edit ops).
  const selRangeRef = (): [number, number] | null => {
    const c = caretRef.current;
    const a = anchorRef.current;
    if (!c || a === null || a === c.idx) return null;
    return [Math.min(a, c.idx), Math.max(a, c.idx)];
  };

  // Run a mutation serialized after every edit queued before it.
  const enqueue = useCallback((fn: () => Promise<void>): Promise<void> => {
    const next = editChain.current.then(fn).catch((e) => setError(String(e)));
    editChain.current = next;
    return next;
  }, []);

  // Send the buffered typed run as a single ordered insert. The optimistic caret is
  // already correct (plain characters only advance the column), so it is not touched.
  const flushTyping = useCallback((): Promise<void> => {
    const text = typeBufRef.current;
    if (!text) return editChain.current;
    const at = typeAtRef.current;
    typeBufRef.current = "";
    return enqueue(async () => {
      const res = await invoke<EditResult>("insert_text", { charIdx: at, text });
      setMeta(res.meta);
      charCountRef.current = res.meta.char_count;
      scheduleRehighlight();
    });
  }, [enqueue, scheduleRehighlight]);

  // Flush immediately (cancel the pending frame). Non-typing ops call this first so the
  // buffered characters are queued ahead of them and ordering is preserved.
  const flushTypingNow = useCallback((): Promise<void> => {
    if (flushRaf.current != null) {
      cancelAnimationFrame(flushRaf.current);
      flushRaf.current = null;
    }
    return flushTyping();
  }, [flushTyping]);

  const scheduleFlush = useCallback(() => {
    if (flushRaf.current != null) return;
    flushRaf.current = requestAnimationFrame(() => {
      flushRaf.current = null;
      void flushTyping();
    });
  }, [flushTyping]);

  // Delete the active selection inside an already-serialized op; returns the char index
  // the caret should land on, and updates meta/anchor/count. Reads the live refs.
  const deleteSelectionInline = async (): Promise<number> => {
    const c = caretRef.current;
    const sel = selRangeRef();
    if (!sel || !c) return c?.idx ?? 0;
    const m = await invoke<DocumentMeta>("delete_range", { start: sel[0], end: sel[1] });
    setMeta(m);
    charCountRef.current = m.char_count;
    setAnchor(null);
    anchorRef.current = null;
    return sel[0];
  };

  // Record a file/folder in the recent list and refresh the welcome view.
  const remember = useCallback((path: string, kind: RecentEntry["kind"]) => {
    pushRecent(path, kind);
    setRecent(loadRecent());
  }, []);

  const handleOpen = useCallback(async () => {
    setError(null);
    const selected = await openDialog({ multiple: true, directory: false });
    const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    if (!paths.length) return;
    setBusy(true);
    try {
      const dark = darkRef.current;
      // Open each file as its own tab; the last one ends up active.
      let last: TabsState | null = null;
      for (const p of paths) {
        last = await invoke<TabsState>("open_document", { path: p, dark });
      }
      if (last) await applyTabsState(last);
      void revealInTree(paths[paths.length - 1]);
      paths.forEach((p) => remember(p, "file"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [applyTabsState, revealInTree, remember]);

  const handleSave = useCallback(async () => {
    if (!meta) return;
    setError(null);
    await flushTypingNow(); // make sure buffered keystrokes are in the buffer...
    await editChain.current; // ...and all queued edits have applied before saving.
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
  }, [meta, flushTypingNow]);

  // Open a file by path (from the tree or the palette), reusing the tab machinery.
  const openPath = useCallback(
    async (path: string) => {
      setError(null);
      setBusy(true);
      try {
        const dark = darkRef.current;
        await applyTabsState(await invoke<TabsState>("open_document", { path, dark }));
        void revealInTree(path);
        remember(path, "file");
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [applyTabsState, revealInTree, remember],
  );

  // Open a folder by path: list it, pin it as the tree root, remember it.
  const openFolderAt = useCallback(
    async (path: string) => {
      try {
        const kids = await invoke<DirEntry[]>("list_dir", { path });
        setFolderRoot(path);
        setFolderPinned(true);
        setDirCache({ [path]: kids });
        setExpanded(new Set());
        setLeftPanel("files");
        remember(path, "folder");
      } catch (e) {
        setError(String(e));
      }
    },
    [remember],
  );

  const openFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await openFolderAt(selected);
  }, [openFolderAt]);

  // Re-root the tree one level up (the ".." row). Pins the new parent so opening a
  // file from it browses in place rather than re-rooting away, and keeps the folder we
  // came from expanded so you can see where you were. No-op at a filesystem root.
  const goUp = useCallback(async () => {
    if (!folderRoot) return;
    const parent = parentDir(folderRoot);
    if (!parent) return;
    try {
      const kids = await invoke<DirEntry[]>("list_dir", { path: parent });
      const prev = folderRoot;
      setFolderRoot(parent);
      setFolderPinned(true);
      setDirCache((p) => ({ ...p, [parent]: kids }));
      setExpanded((p) => new Set(p).add(prev));
    } catch (e) {
      setError(String(e));
    }
  }, [folderRoot]);

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

  // The outline as a nested tree, and a sensible default expansion: small files open
  // fully expanded (see the whole structure); large ones collapse to the top level so
  // a 1000-heading doc shows a handful of roots you drill into, not a wall.
  const outlineTree = useMemo(() => buildOutlineTree(outline), [outline]);
  useEffect(() => {
    if (outline.length === 0) setOutlineExpanded(new Set());
    else if (outline.length <= 50) setOutlineExpanded(new Set(outline.map((o) => o.line)));
    else setOutlineExpanded(new Set());
  }, [outline]);

  const toggleOutlineNode = useCallback((line: number) => {
    setOutlineExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  // Recursive collapsible render of the outline tree.
  const renderOutlineNodes = (nodes: OutlineNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const hasKids = n.children.length > 0;
      const open = outlineExpanded.has(n.line);
      return (
        <div key={n.line}>
          <div
            className="op-row"
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => void jumpToLine(n.line)}
            title={n.title}
          >
            {hasKids ? (
              <span
                className={`op-caret${open ? " open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOutlineNode(n.line);
                }}
              >
                ▸
              </span>
            ) : (
              <span className="op-caret-sp" />
            )}
            <span className="op-label">{n.title}</span>
          </div>
          {hasKids && open && renderOutlineNodes(n.children, depth + 1)}
        </div>
      );
    });

  const openPalette = useCallback(() => {
    setPaletteQuery("");
    setPaletteIndex(0);
    setPaletteOpen(true);
  }, []);

  // Undo / redo. The Rust buffer owns the history and rehighlights itself; here we
  // just apply the new meta (which refreshes the viewport) and move the caret to
  // where the change landed. A null caret means there was nothing to do.
  const undoRedo = useCallback(
    async (which: "undo" | "redo"): Promise<void> => {
      if (!meta || readonly) return;
      flushTypingNow();
      return enqueue(async () => {
        const out = await invoke<EditOutcome>(which);
        setAnchor(null);
        anchorRef.current = null;
        setMeta(out.meta);
        charCountRef.current = out.meta.char_count;
        if (out.caret != null) await setCaretFromIdx(out.caret);
        scrollerRef.current?.focus();
      });
    },
    [meta, readonly, enqueue, flushTypingNow, setCaretFromIdx],
  );

  // Pretty-print the document's JSON (handy for minified blobs, which open without
  // hanging thanks to the viewport's line cap, but are unreadable until reflowed).
  const formatJson = useCallback(async (): Promise<void> => {
    if (!meta || readonly) return;
    flushTypingNow();
    return enqueue(async () => {
      const m = await invoke<DocumentMeta>("pretty_print");
      setMeta(m);
      charCountRef.current = m.char_count;
      setAnchor(null);
      anchorRef.current = null;
      await setCaretFromIdx(0);
      scrollerRef.current?.focus();
    });
  }, [meta, readonly, enqueue, flushTypingNow, setCaretFromIdx]);

  // Live filter-to-view: show only the lines matching a regex (non-destructive).
  // Works on any size, including the read-only mmap engine, so huge logs filter too.
  const runFilter = useCallback(
    async (q: string) => {
      if (!meta || !q) {
        setFilterMatches([]);
        return;
      }
      try {
        setFilterMatches(
          await invoke<FilterMatch[]>("filter_lines", { query: q, useRegex: true, caseSensitive: false }),
        );
      } catch {
        setFilterMatches([]); // invalid regex (mid-typing) → show nothing yet
      }
    },
    [meta],
  );

  const openFilter = useCallback(() => {
    if (!meta) return;
    setFilterQuery("");
    setFilterMatches([]);
    setFilterOpen(true);
  }, [meta]);

  const closeFilter = useCallback(() => {
    setFilterOpen(false);
    setFilterMatches([]);
    scrollerRef.current?.focus();
  }, []);

  // Highlighters: persist the rules, compile them once, expose a per-line matcher.
  useEffect(() => {
    try {
      localStorage.setItem("tuhi.highlighters", JSON.stringify(highlighters));
    } catch {
      /* best-effort */
    }
  }, [highlighters]);

  const compiledHl = useMemo(
    () =>
      highlighters
        .map((h) => {
          try {
            return { re: new RegExp(h.pattern, "i"), color: h.color };
          } catch {
            return null; // skip an invalid pattern rather than throw
          }
        })
        .filter((x): x is { re: RegExp; color: string } => x !== null),
    [highlighters],
  );

  const lineHighlight = useCallback(
    (text: string): string | undefined => {
      for (const h of compiledHl) if (h.re.test(text)) return h.color;
      return undefined;
    },
    [compiledHl],
  );

  // Follow / tail: while on, poll the file size and reload + scroll to the bottom when
  // it grows (tail -f). Works for both engines; the large-file engine re-mmaps.
  const followLenRef = useRef<number>(-1);
  useEffect(() => {
    if (!followOn || !meta?.path) return;
    const path = meta.path;
    const dark = darkRef.current;
    let cancelled = false;
    const tick = async () => {
      try {
        const len = await invoke<number>("file_len", { path });
        if (cancelled || len === followLenRef.current) return;
        followLenRef.current = len;
        const m = await invoke<DocumentMeta>("reload", { dark });
        if (cancelled) return;
        setMeta(m);
        requestAnimationFrame(() => {
          const el = scrollerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } catch {
        /* file vanished or unreadable; keep polling */
      }
    };
    void tick(); // once immediately on enable
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followOn, meta?.path]);

  const toggleFollow = useCallback(() => {
    if (!meta?.path) return;
    setFollowOn((v) => {
      if (!v) followLenRef.current = -1; // force a reload + scroll on enable
      return !v;
    });
  }, [meta?.path]);

  // --- Editing. Every op goes through the char-indexed Rust buffer. ---

  // Insert a string (newline, tab, paste, or a selection-replacing character). Flushes
  // any buffered typing first so it stays ordered, then runs serialized. Uses the caret
  // returned by `insert_text`, so no second round-trip is needed to place the caret.
  const insertText = useCallback(
    async (text: string): Promise<void> => {
      if (!caretRef.current) return;
      flushTypingNow();
      return enqueue(async () => {
        if (!caretRef.current) return;
        const at = selRangeRef() ? await deleteSelectionInline() : caretRef.current.idx;
        const res = await invoke<EditResult>("insert_text", { charIdx: at, text });
        setMeta(res.meta);
        charCountRef.current = res.meta.char_count;
        const landed = { idx: at + [...text].length, line: res.caret.line, col: res.caret.col };
        caretRef.current = landed;
        setCaret(landed);
        ensureCaretVisible(res.caret.line);
        scheduleRehighlight();
      });
    },
    [enqueue, flushTypingNow, ensureCaretVisible, scheduleRehighlight],
  );

  // Fast path for a plain typed character: advance the caret synchronously (column + 1,
  // same line) and buffer the character; the buffer is sent as one insert next frame.
  const typeChar = useCallback(
    (ch: string) => {
      const c = caretRef.current;
      if (!c) return;
      // Selection active, or a character that changes line/layout: use the full insert.
      if ((anchorRef.current !== null && anchorRef.current !== c.idx) || ch.includes("\n") || ch === "\t") {
        void insertText(ch);
        return;
      }
      if (!typeBufRef.current) typeAtRef.current = c.idx;
      typeBufRef.current += ch;
      charCountRef.current += 1;
      const next = { idx: c.idx + 1, line: c.line, col: c.col + 1 };
      caretRef.current = next;
      setCaret(next);
      scheduleFlush();
    },
    [insertText, scheduleFlush],
  );

  const backspace = useCallback(async (): Promise<void> => {
    if (!caretRef.current) return;
    flushTypingNow();
    return enqueue(async () => {
      const c = caretRef.current;
      if (!c) return;
      let landAt: number;
      if (selRangeRef()) {
        landAt = await deleteSelectionInline();
      } else if (c.idx > 0) {
        const m = await invoke<DocumentMeta>("delete_range", { start: c.idx - 1, end: c.idx });
        setMeta(m);
        charCountRef.current = m.char_count;
        landAt = c.idx - 1;
      } else {
        return;
      }
      await setCaretFromIdx(landAt);
      scheduleRehighlight();
    });
  }, [enqueue, flushTypingNow, setCaretFromIdx, scheduleRehighlight]);

  const forwardDelete = useCallback(async (): Promise<void> => {
    if (!caretRef.current) return;
    flushTypingNow();
    return enqueue(async () => {
      const c = caretRef.current;
      if (!c) return;
      let landAt: number;
      if (selRangeRef()) {
        landAt = await deleteSelectionInline();
      } else if (c.idx < charCountRef.current) {
        const m = await invoke<DocumentMeta>("delete_range", { start: c.idx, end: c.idx + 1 });
        setMeta(m);
        charCountRef.current = m.char_count;
        landAt = c.idx;
      } else {
        return;
      }
      await setCaretFromIdx(landAt);
      scheduleRehighlight();
    });
  }, [enqueue, flushTypingNow, setCaretFromIdx, scheduleRehighlight]);

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

  const cut = useCallback(async (): Promise<void> => {
    if (!selRangeRef()) return;
    flushTypingNow();
    return enqueue(async () => {
      const r = selRangeRef();
      if (!r) return;
      const text = await invoke<string>("read_range", { start: r[0], end: r[1] });
      await writeText(text);
      const landAt = await deleteSelectionInline();
      await setCaretFromIdx(landAt);
      scheduleRehighlight();
    });
  }, [enqueue, flushTypingNow, setCaretFromIdx, scheduleRehighlight]);

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
    flushTypingNow();
    setAnchor(0);
    anchorRef.current = 0;
    void enqueue(() => setCaretFromIdx(charCountRef.current));
  }, [meta, enqueue, flushTypingNow, setCaretFromIdx]);

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

  // Debounced live filter as the filter query changes.
  useEffect(() => {
    if (!filterOpen) return;
    const t = setTimeout(() => void runFilter(filterQuery), 150);
    return () => clearTimeout(t);
  }, [filterQuery, filterOpen, runFilter]);

  // Session restore on mount. If the Rust process still has tabs (a dev hot-reload),
  // adopt them. Otherwise (a real restart) reopen the files that were open last time,
  // skipping any that have since moved or been deleted, and re-select the last active.
  useEffect(() => {
    void (async () => {
      try {
        const ts = await invoke<TabsState>("list_tabs");
        if (ts.tabs.length) {
          await applyTabsState(ts);
          if (ts.meta?.path) void revealInTree(ts.meta.path);
          return;
        }
        const { files, active } = savedSession;
        if (!files.length) return;
        const dark = darkRef.current;
        for (const p of files) {
          try {
            await invoke<TabsState>("open_document", { path: p, dark });
          } catch {
            /* skip a file that has moved or been deleted */
          }
        }
        // Re-select the previously active file if it reopened, then apply, and root the
        // tree at that file's folder so the explorer shows its structure (not the welcome
        // view). revealInTree respects a pinned folder and otherwise re-roots to the dir.
        const restored = await invoke<TabsState>("list_tabs");
        if (!restored.tabs.length) return;
        const want = restored.tabs.find((t) => t.path && t.path === active);
        const applied = want ? await invoke<TabsState>("switch_tab", { id: want.id }) : restored;
        await applyTabsState(applied);
        if (applied.meta?.path) void revealInTree(applied.meta.path);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the open files + active file so the session can be restored next launch.
  useEffect(() => {
    try {
      const files = tabs.map((t) => t.path).filter((p): p is string => !!p);
      localStorage.setItem("tuhi.openFiles", JSON.stringify(files));
      const active = tabs.find((t) => t.id === activeTabId)?.path ?? "";
      localStorage.setItem("tuhi.activeFile", active);
    } catch {
      /* persistence is best-effort */
    }
  }, [tabs, activeTabId]);

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
        case "z":
          if (meta && !readonly) {
            e.preventDefault();
            void undoRedo(e.shiftKey ? "redo" : "undo"); // Ctrl+Shift+Z = redo
          }
          break;
        case "y":
          if (meta && !readonly) {
            e.preventDefault();
            void undoRedo("redo");
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
  }, [handleOpen, handleSave, closeActiveTab, openFind, undoRedo, meta, readonly]);

  // --- Movement (extend = hold Shift to grow the selection) ---

  // Apply the selection-anchor rule for a caret move, from the synchronous refs.
  const applyExtend = (extend: boolean) => {
    if (extend) {
      if (anchorRef.current === null && caretRef.current) {
        const a = caretRef.current.idx;
        setAnchor(a);
        anchorRef.current = a;
      }
    } else {
      setAnchor(null);
      anchorRef.current = null;
    }
  };

  // Moves flush pending typing and run on the chain, so the caret reflects every queued
  // edit (and the Rust position lookups see the final document).
  const moveCaretTo = useCallback(
    (newIdx: number, extend: boolean): Promise<void> => {
      flushTypingNow();
      applyExtend(extend);
      return enqueue(() => setCaretFromIdx(newIdx));
    },
    [enqueue, flushTypingNow, setCaretFromIdx],
  );

  const moveToLinePos = useCallback(
    (line: number, col: number, extend: boolean): Promise<void> => {
      flushTypingNow();
      applyExtend(extend);
      return enqueue(async () => {
        const idx = await invoke<number>("pos_to_char", { line, col });
        await setCaretFromIdx(idx);
      });
    },
    [enqueue, flushTypingNow, setCaretFromIdx],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Read the caret from the synchronous ref: within a fast key burst the React state
    // is a frame behind, and acting on it is exactly what scrambled the text before.
    const c = caretRef.current;
    if (!c || !meta) return;

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
        if (c.idx > 0) void moveCaretTo(c.idx - 1, extend);
        return;
      case "ArrowRight":
        e.preventDefault();
        if (c.idx < charCountRef.current) void moveCaretTo(c.idx + 1, extend);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (c.line > 0) void moveToLinePos(c.line - 1, c.col, extend);
        return;
      case "ArrowDown":
        e.preventDefault();
        if (c.line < lineCount - 1) void moveToLinePos(c.line + 1, c.col, extend);
        return;
      case "Home": e.preventDefault(); void moveToLinePos(c.line, 0, extend); return;
      case "End": e.preventDefault(); void moveToLinePos(c.line, Number.MAX_SAFE_INTEGER, extend); return;
      default:
        if (e.key.length === 1) { e.preventDefault(); typeChar(e.key); }
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
    const C = "command" as const;
    const items: PaletteItem[] = [
      { label: "Open File…", hint: combo("O"), kind: C, run: () => void handleOpen() },
      { label: "Open Folder…", kind: C, run: () => void openFolder() },
      ...(folderRoot && parentDir(folderRoot) ? [{ label: "Up to parent folder", kind: C, run: () => void goUp() }] : []),
      ...(meta ? [{ label: "Save", hint: combo("S"), kind: C, run: () => void handleSave() }] : []),
      ...(meta && !readonly ? [{ label: "Find in file…", hint: combo("F"), kind: C, run: () => openFind(false) }] : []),
      ...(meta && !readonly ? [{ label: "Format JSON (pretty-print)", kind: C, run: () => void formatJson() }] : []),
      ...(meta ? [{ label: "Filter lines to view…", kind: C, run: () => openFilter() }] : []),
      ...(meta?.path ? [{ label: followOn ? "Stop following file" : "Follow file (tail)", kind: C, run: () => toggleFollow() }] : []),
      { label: "Edit highlighters…", kind: C, run: () => { setHlFromSettings(false); setHlEditorOpen(true); } },
      { label: "Settings…", kind: C, run: () => setSettingsOpen(true) },
      { label: "Show files", kind: C, run: () => setLeftPanel((v) => (v === "files" ? null : "files")) },
      ...(meta ? [{ label: "Show outline", kind: C, run: () => setLeftPanel((v) => (v === "outline" ? null : "outline")) }] : []),
      ...tabs.map((t) => ({ label: t.name, kind: "tab" as const, run: () => void switchTab(t.id) })),
      ...Object.values(dirCache)
        .flat()
        .filter((e) => !e.is_dir)
        .map((e) => ({ label: e.name, kind: "file" as const, run: () => void openPath(e.path) })),
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
      <nav className="rail">
        <button
          className={`rail-btn${leftPanel === "files" ? " on" : ""}`}
          onClick={() => setLeftPanel((v) => (v === "files" ? null : "files"))}
          title="Files"
        >
          <IconTree />
        </button>
        <button
          className={`rail-btn${leftPanel === "outline" ? " on" : ""}`}
          onClick={() => setLeftPanel((v) => (v === "outline" ? null : "outline"))}
          disabled={!meta}
          title="Outline"
        >
          <IconList />
        </button>
        <button
          className={`rail-btn${findOpen ? " on" : ""}`}
          onClick={() => (findOpen ? closeFind() : openFind(false))}
          disabled={!meta || readonly}
          title="Find (Ctrl+F)"
        >
          <IconSearch />
        </button>
        <button
          className={`rail-btn${filterOpen ? " on" : ""}`}
          onClick={() => (filterOpen ? closeFilter() : openFilter())}
          disabled={!meta}
          title="Filter lines to view"
        >
          <IconFilter />
        </button>
        <button className="rail-btn" onClick={openPalette} title={`Command palette (${combo("P")})`}>
          <IconCommand />
        </button>
        <div className="rail-spacer" />
        <button className="rail-btn" onClick={() => setSettingsOpen(true)} title="Settings">
          <IconSettings />
        </button>
      </nav>
      <div className="main">
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
      {leftPanel && (
        <aside className="filetree" style={{ flex: `0 0 ${treeWidth}px`, width: treeWidth }}>
          {leftPanel === "files" ? (
            <>
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
                {folderRoot ? (
                  <>
                    {parentDir(folderRoot) && (
                      <div
                        className="ft-row ft-up"
                        onClick={() => void goUp()}
                        title={`Up to ${parentDir(folderRoot)}`}
                      >
                        <span className="ft-caret" />
                        <span className="ft-name">..</span>
                      </div>
                    )}
                    {renderDir(folderRoot, 0)}
                  </>
                ) : (
                  <div className="ft-welcome">
                    <p className="ft-welcome-title">No folder open</p>
                    <div className="ft-welcome-actions">
                      <button onClick={() => void handleOpen()}>Open File…</button>
                      <button onClick={() => void openFolder()}>Open Folder…</button>
                    </div>
                    {recent.length > 0 && (
                      <div className="ft-recent">
                        <p className="ft-recent-head">Recent</p>
                        {recent.map((e) => (
                          <div
                            key={e.path}
                            className="ft-row ft-recent-row"
                            title={e.path}
                            onClick={() =>
                              void (e.kind === "folder" ? openFolderAt(e.path) : openPath(e.path))
                            }
                          >
                            {e.kind === "folder" ? <IconFolder /> : <IconFile />}
                            <span className="ft-name">{baseName(e.path)}</span>
                            <span className="ft-recent-dir">{dirOf(e.path)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="op-head">Outline</div>
              {outline.length > 12 && (
                <input
                  className="op-filter"
                  placeholder="Filter outline…"
                  value={outlineQuery}
                  onChange={(e) => setOutlineQuery(e.target.value)}
                />
              )}
              <div className="op-body">
                {(() => {
                  if (!outline.length) {
                    return <p className="op-empty">{meta ? "No headings" : "No file open"}</p>;
                  }
                  const q = outlineQuery.trim().toLowerCase();
                  if (q) {
                    // Filtering: flat list of matches (ignore the tree/collapse).
                    const rows = outline.filter((o) => o.title.toLowerCase().includes(q));
                    return rows.length ? (
                      rows.map((o, i) => (
                        <div
                          key={`${o.line}-${i}`}
                          className="op-row"
                          onClick={() => void jumpToLine(o.line)}
                          title={o.title}
                        >
                          <span className="op-caret-sp" />
                          <span className="op-label">{o.title}</span>
                        </div>
                      ))
                    ) : (
                      <p className="op-empty">No matches</p>
                    );
                  }
                  // No filter: the collapsible tree.
                  return renderOutlineNodes(outlineTree, 0);
                })()}
              </div>
            </>
          )}
        </aside>
      )}
      {leftPanel && (
        <div
          className="ft-resizer"
          onMouseDown={startTreeResize}
          title="Drag to resize"
          role="separator"
          aria-orientation="vertical"
        />
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
                const hl = lineHighlight(ln.text);
                return (
                  <div
                    className="line"
                    key={lineIndex}
                    style={hl ? { boxShadow: `inset 3px 0 0 ${hl}`, background: `${hl}14` } : undefined}
                  >
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
                  style={{ top: (caret!.line - rangeStart) * LINE_HEIGHT, left: GUTTER + (caretLeft ?? caret!.col * cw) }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="empty">
            <p className="empty-tag">A fast, open place to write.</p>
            <p className="hint">
              Open a file with <b>Ctrl+O</b>, or pick one from the file tree. tuhi
              fetches only the lines on screen from a Rust buffer, so large files open
              and scroll without loading into the view.
            </p>
          </div>
        )}
      </div>
      {filterOpen && (
        <div className="filter-view">
          <div className="filter-bar">
            <input
              className="filter-input"
              autoFocus
              placeholder="Filter lines by regex (e.g. ERROR|WARN)…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeFilter();
                }
              }}
            />
            <span className="filter-count">
              {filterMatches.length >= 1000
                ? "1000+ (first 1000)"
                : `${filterMatches.length} line${filterMatches.length === 1 ? "" : "s"}`}
            </span>
            <button className="find-btn" onClick={closeFilter} title="Close (Esc)">
              ✕
            </button>
          </div>
          <div className="filter-list">
            {filterMatches.length ? (
              filterMatches.map((m) => {
                const hl = lineHighlight(m.text);
                return (
                  <div
                    key={m.line}
                    className="filter-row"
                    style={hl ? { boxShadow: `inset 3px 0 0 ${hl}`, background: `${hl}14` } : undefined}
                    onClick={() => {
                      closeFilter();
                      void jumpToLine(m.line);
                    }}
                    title={`Go to line ${m.line + 1}`}
                  >
                    <span className="filter-gutter">{m.line + 1}</span>
                    <span className="filter-text">
                      {renderLine(m.text.replace(/\r?\n$/, ""), [])}
                      {m.truncated && <span className="trunc"> ⋯</span>}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="filter-empty">
                {filterQuery
                  ? "No matching lines"
                  : "Type a regex to collapse the document to just the matching lines."}
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      <footer className="statusbar">
        <span className="path">{meta?.path ?? "No file"}</span>
        {readonly && <span className="badge-ro">read-only · large file</span>}
        <span className="spacer" />
        {meta?.path && (
          <button
            className={`sb-btn${followOn ? " on" : ""}`}
            onClick={toggleFollow}
            title="Follow the file as it grows (tail -f)"
          >
            {followOn ? "● Following" : "Follow"}
          </button>
        )}
        {meta && (
          <button className="sb-btn" onClick={() => { setHlFromSettings(false); setHlEditorOpen(true); }} title="Highlighter rules">
            Highlighters
          </button>
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
      <span ref={caretMeasureRef} className="measure" aria-hidden="true" />
      </div>
      </div>
      </div>
      {paletteOpen && (
        <div className="palette-overlay" onMouseDown={() => setPaletteOpen(false)}>
          <div className="palette-modal" onMouseDown={(e) => e.stopPropagation()}>
            <input
              className="palette-input"
              autoFocus
              placeholder="Search a file to open, or run a command (try 'Open Folder' or 'Save')"
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value);
                setPaletteIndex(0);
              }}
              onKeyDown={onPaletteKey}
            />
            <div className="palette-list">
              {paletteFiltered.length ? (
                paletteFiltered.map((it, i) => {
                  const prev = paletteFiltered[i - 1];
                  const header =
                    !prev || prev.kind !== it.kind
                      ? it.kind === "command"
                        ? "Commands"
                        : it.kind === "tab"
                          ? "Open tabs"
                          : "Files in this folder"
                      : null;
                  return (
                    <div key={`${it.kind}-${it.label}-${i}`}>
                      {header && <div className="palette-section">{header}</div>}
                      <div
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
                    </div>
                  );
                })
              ) : (
                <div className="palette-empty">No files or commands match</div>
              )}
            </div>
            <div className="palette-foot">↑↓ move · Enter run · Esc close</div>
          </div>
        </div>
      )}
      {hlEditorOpen && (
        <div className="palette-overlay" onMouseDown={() => closeHlEditor()}>
          <div className="palette-modal hl-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="hl-head">Highlighter rules</div>
            <div className="hl-body">
              {highlighters.length ? (
                highlighters.map((h, i) => (
                  <div className="hl-row" key={i}>
                    <input
                      className="hl-pattern"
                      value={h.pattern}
                      placeholder="regex, e.g. ERROR|fatal"
                      onChange={(e) =>
                        setHighlighters((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)),
                        )
                      }
                    />
                    <input
                      className="hl-color"
                      type="color"
                      value={h.color}
                      onChange={(e) =>
                        setHighlighters((rs) =>
                          rs.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)),
                        )
                      }
                    />
                    <button
                      className="hl-del"
                      title="Remove rule"
                      onClick={() => setHighlighters((rs) => rs.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="hl-empty">No rules yet — add one to tint matching lines.</p>
              )}
            </div>
            <div className="hl-foot">
              <button
                className="find-btn"
                onClick={() => setHighlighters((rs) => [...rs, { pattern: "", color: "#ff5a36" }])}
              >
                + Add rule
              </button>
              <span className="spacer" />
              <button className="find-btn" onClick={() => closeHlEditor()}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="palette-overlay" onMouseDown={() => setSettingsOpen(false)}>
          <div className="palette-modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="hl-head">Settings</div>
            <div className="settings-body">
              <div className="set-group">
                <div className="set-label">Theme</div>
                <div className="set-seg">
                  {(["auto", "light", "dark"] as const).map((t) => (
                    <button
                      key={t}
                      className={`set-opt${theme === t ? " on" : ""}`}
                      onClick={() => setTheme(t)}
                    >
                      {t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
                <div className="set-note">Auto follows your operating system.</div>
              </div>
              <div className="set-group">
                <div className="set-label">Highlighters</div>
                <button
                  className="find-btn"
                  onClick={() => {
                    setSettingsOpen(false);
                    setHlFromSettings(true);
                    setHlEditorOpen(true);
                  }}
                >
                  Manage highlighter rules…
                </button>
                <div className="set-note">Pattern → colour rules for logs (ERROR red, WARN amber).</div>
              </div>
              <div className="set-note set-more">
                More settings (font, tab width, wrapping) are on the way.
              </div>
            </div>
            <div className="hl-foot">
              <span className="spacer" />
              <button className="find-btn" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
