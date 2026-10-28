// A controllable mock of the Tauri `invoke` bridge for the front-end UI tests. Each test sets a
// scenario (the active tab + its document meta, and the rows a filter should return); every Rust
// command resolves to a benign default so the full App mounts without a backend. Wired up in
// setup.ts via `vi.mock("@tauri-apps/api/core", …)`.

export interface MockMeta {
  path: string | null;
  line_count: number;
  char_count: number;
  dirty: boolean;
  readonly: boolean;
}

export interface MockFilterRow {
  line: number;
  text: string;
  truncated: boolean;
}

export interface MockTableSniff {
  tabular: boolean;
  delimiter: string;
  columns: number;
  has_header: boolean;
  row_count: number;
}

interface Scenario {
  tabs: Array<{ id: number; name: string; path: string | null; dirty: boolean; readonly: boolean; active: boolean }>;
  active: number | null;
  meta: MockMeta | null;
  filterRows: MockFilterRow[];
  fileLen: number;
  tableSniff: MockTableSniff | null;
  tableRows: string[][];
}

const EMPTY: Scenario = {
  tabs: [],
  active: null,
  meta: null,
  filterRows: [],
  fileLen: 0,
  tableSniff: null,
  tableRows: [],
};
let scenario: Scenario = { ...EMPTY };

/** Replace (partially) the current scenario. Call before rendering <App />. */
export function setScenario(patch: Partial<Scenario>): void {
  scenario = { ...scenario, ...patch };
}

/** Reset to an empty workspace (no file open). Call in beforeEach. */
export function resetScenario(): void {
  scenario = { ...EMPTY };
}

/** Open a single file as the active tab. Readonly defaults true (the large-file engine). */
export function openFileScenario(path: string, meta: Partial<MockMeta> = {}): void {
  const full: MockMeta = {
    path,
    line_count: 1_000_000,
    char_count: 50_000_000,
    dirty: false,
    readonly: true,
    ...meta,
  };
  const name = path.split(/[\\/]/).pop() ?? path;
  setScenario({
    tabs: [{ id: 1, name, path, dirty: full.dirty, readonly: full.readonly, active: true }],
    active: 1,
    meta: full,
  });
}

function tabsState() {
  return { tabs: scenario.tabs, active: scenario.active, meta: scenario.meta };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeMock(cmd: string, args?: unknown): Promise<any> {
  switch (cmd) {
    case "table_sniff":
      return (
        scenario.tableSniff ?? {
          tabular: false,
          delimiter: "",
          columns: 0,
          has_header: false,
          row_count: 0,
        }
      );
    case "table_window": {
      const a = args as { start?: number; count?: number } | undefined;
      const start = a?.start ?? 0;
      const count = a?.count ?? scenario.tableRows.length;
      return scenario.tableRows.slice(start, start + count);
    }
    case "list_tabs":
    case "switch_tab":
    case "open_document":
    case "close_tab":
    case "new_document":
    case "restore_recovery":
      return tabsState();
    case "list_recovery":
      return [];
    case "get_viewport":
    case "get_outline":
    case "markdown_blocks":
    case "list_dir":
    case "request_highlight":
    case "search":
      return [];
    case "filter_lines":
      return scenario.filterRows;
    case "search_positions":
      return { hits: [], truncated: false };
    case "replace_all":
      return { meta: scenario.meta, count: 0 };
    case "set_theme":
      return scenario.meta;
    case "refresh_highlights":
    case "pretty_print":
    case "save_document":
    case "delete_range":
    case "append_block":
    case "replace_block":
    case "reload":
      return scenario.meta;
    case "insert_text":
      return { meta: scenario.meta, caret: { line: 0, col: 0 } };
    case "pos_to_char":
    case "word_boundary":
      return 0;
    case "char_to_pos":
      return { line: 0, col: 0 };
    case "file_len":
      return scenario.fileLen;
    case "read_range":
    case "ensure_welcome":
      return "";
    case "sniff_file":
      return { binary: false, reason: "" };
    default:
      return null;
  }
}
