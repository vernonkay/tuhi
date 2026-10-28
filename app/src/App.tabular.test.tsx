import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { openFileScenario, resetScenario, setScenario } from "./test/tauri-mock";

// UI tests for the tabular view (feature #1): a delimited file opens as a grid, its header row
// renders, a non-tabular file stays as text, and the command toggles back to text. The Rust
// backend is mocked (table_sniff / table_window), so these assert the front-end wiring in App.tsx
// and TableGrid. Row cells are virtualized (no layout in jsdom), so assertions anchor on the
// always-rendered header and the grid container, not on data cells.

const CSV = "C:/data/sales.csv";

beforeEach(() => {
  resetScenario();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("tabular view", () => {
  it("auto-opens a delimited file as a grid with its header row", async () => {
    setScenario({
      tableSniff: { tabular: true, delimiter: ",", columns: 3, has_header: true, row_count: 3 },
      tableRows: [
        ["name", "age", "city"],
        ["Ann", "30", "Wellington"],
        ["Bo", "25", "Auckland"],
      ],
    });
    openFileScenario(CSV, { readonly: false, line_count: 3, char_count: 60 });
    render(<App />);
    // The grid mounts once the file's sniff resolves.
    expect(await screen.findByTestId("table-grid")).toBeInTheDocument();
    // The header labels come from the first row (as sortable header buttons; the jump-to-column
    // selector also lists them as options, so match the button role to disambiguate).
    expect(await screen.findByRole("button", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "age" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "city" })).toBeInTheDocument();
  });

  it("leaves a non-tabular file as text (no grid)", async () => {
    setScenario({
      tableSniff: { tabular: false, delimiter: "", columns: 0, has_header: false, row_count: 0 },
    });
    openFileScenario("C:/notes/readme.csv", { readonly: false, line_count: 5, char_count: 100 });
    render(<App />);
    await screen.findByText("C:/notes/readme.csv"); // the app has loaded the file
    expect(screen.queryByTestId("table-grid")).not.toBeInTheDocument();
  });

  it("marks a column with a direction arrow when its header is clicked to sort", async () => {
    setScenario({
      tableSniff: { tabular: true, delimiter: ",", columns: 3, has_header: true, row_count: 3 },
      tableRows: [
        ["name", "age", "city"],
        ["Ann", "30", "Wellington"],
        ["Bo", "25", "Auckland"],
      ],
      tableOrder: [1, 0], // Bo (25) before Ann (30) when sorted by age ascending
    });
    const user = userEvent.setup();
    openFileScenario(CSV, { readonly: false, line_count: 3, char_count: 60 });
    render(<App />);
    await screen.findByTestId("table-grid");
    // Clicking the "age" header sorts by it; an ascending arrow marks the sorted column.
    await user.click(await screen.findByRole("button", { name: /age/ }));
    expect(await screen.findByText("▲")).toBeInTheDocument();
  });

  it("offers a jump-to-column selector listing every column", async () => {
    setScenario({
      tableSniff: { tabular: true, delimiter: ",", columns: 3, has_header: true, row_count: 3 },
      tableRows: [
        ["name", "age", "city"],
        ["Ann", "30", "Wellington"],
      ],
    });
    openFileScenario(CSV, { readonly: false, line_count: 3, char_count: 60 });
    render(<App />);
    await screen.findByTestId("table-grid");
    // The header labels populate the column selector's options.
    expect(await screen.findByRole("option", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "age" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "city" })).toBeInTheDocument();
  });

  it("toggles back to the text view with the View as text command", async () => {
    setScenario({
      tableSniff: { tabular: true, delimiter: ",", columns: 2, has_header: true, row_count: 2 },
      tableRows: [
        ["a", "b"],
        ["1", "2"],
      ],
    });
    const user = userEvent.setup();
    openFileScenario(CSV, { readonly: false, line_count: 2, char_count: 20 });
    render(<App />);
    expect(await screen.findByTestId("table-grid")).toBeInTheDocument();
    // Ctrl+P opens the command bar; running "View as text" drops back to the editor.
    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true });
    await user.click(await screen.findByText("View as text"));
    expect(screen.queryByTestId("table-grid")).not.toBeInTheDocument();
  });
});
