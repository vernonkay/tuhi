import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { openFileScenario, resetScenario, setScenario } from "./test/tauri-mock";

// UI tests for the command bar (feature #3, issue #47): Find, Filter, Commands, Go-to-line and
// Replace are one top-centre input with a mode chip and one keyboard model, and the left rail
// collapses to Files · Search · Data · Settings. The Rust backend is mocked, so these assert the
// front-end wiring in App.tsx — the modes, the keyboard shortcuts, prefix switching and the rail.

const CODE = "C:/src/app.ts";
const ORDER_LINE = "2026-10-28 06:00:03.492 ERROR [exec-7] LedgerPoller ORDER-FAILED rejected";

// The app listens for shortcuts on `window`; a keydown on document.body bubbles up to it.
const ctrl = (key: string) => fireEvent.keyDown(document.body, { key, ctrlKey: true });

// A file opens asynchronously (invoke is mocked but still a promise), so the meta-gated shortcuts
// only work once it has loaded. The status bar shows the path once meta arrives — wait on that.
const waitLoaded = (path: string) => screen.findByText(path);

beforeEach(() => {
  resetScenario();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("command bar", () => {
  it("collapses the left rail to Files · Search · Data · Settings", () => {
    openFileScenario(CODE, { readonly: false, line_count: 200, char_count: 5000 });
    render(<App />);
    // The one Search dot replaces the old Find / Filter / Commands / Format JSON dots.
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Find")).not.toBeInTheDocument();
    expect(screen.queryByText("Filter")).not.toBeInTheDocument();
    expect(screen.queryByText("Commands")).not.toBeInTheDocument();
  });

  it("opens in Command mode on Ctrl+P, with the command dropdown", async () => {
    openFileScenario(CODE, { readonly: false, line_count: 200, char_count: 5000 });
    render(<App />);
    await waitLoaded(CODE);
    ctrl("p");
    // The mode chip reads "Run" and the dropdown lists commands.
    expect(await screen.findByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Settings…")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Open a file or run a command/)).toBeInTheDocument();
  });

  it("opens Find mode on Ctrl+F with the unified input and match controls", async () => {
    openFileScenario(CODE, { readonly: false, line_count: 200, char_count: 5000 });
    render(<App />);
    await waitLoaded(CODE);
    ctrl("f");
    expect(await screen.findByText("Find")).toBeInTheDocument(); // the mode chip
    expect(screen.getByPlaceholderText("Find in file")).toBeInTheDocument();
    expect(screen.getByText("0 results")).toBeInTheDocument();
  });

  it("opens Replace mode on Ctrl+H with a second row", async () => {
    openFileScenario(CODE, { readonly: false, line_count: 200, char_count: 5000 });
    render(<App />);
    await waitLoaded(CODE);
    ctrl("h");
    expect(await screen.findByText("Replace")).toBeInTheDocument(); // the mode chip
    expect(screen.getByPlaceholderText("Replace")).toBeInTheDocument(); // the second-row input
    expect(screen.getByText("Replace all")).toBeInTheDocument();
  });

  it("opens Go-to-line mode on Ctrl+G", async () => {
    openFileScenario(CODE, { readonly: false, line_count: 200, char_count: 5000 });
    render(<App />);
    await waitLoaded(CODE);
    ctrl("g");
    expect(await screen.findByText("Line")).toBeInTheDocument(); // the mode chip
    expect(screen.getByPlaceholderText(/Go to line/)).toBeInTheDocument();
  });

  it("switches Command mode to Find when the input starts with '/'", async () => {
    openFileScenario(CODE, { readonly: false, line_count: 200, char_count: 5000 });
    const user = userEvent.setup();
    render(<App />);
    await waitLoaded(CODE);
    ctrl("p");
    const input = await screen.findByPlaceholderText(/Open a file or run a command/);
    await user.type(input, "/");
    // The leading '/' flips the one input straight into Find mode.
    expect(await screen.findByPlaceholderText("Find in file")).toBeInTheDocument();
  });

  it("collapses the editor to matches when Filter mode has a query", async () => {
    openFileScenario("C:/data/table.txt", { readonly: false, line_count: 500, char_count: 20000 });
    setScenario({
      filterRows: [
        { line: 41, text: ORDER_LINE, truncated: false },
        { line: 88, text: "2026-10-28 06:00:05.110 ERROR ClaimController ORDER-FAILED limit", truncated: false },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await waitLoaded("C:/data/table.txt");
    // Open the bar, run the Filter command, then type the query into the same unified input.
    ctrl("p");
    await user.click(await screen.findByText("Filter lines to view…"));
    const input = await screen.findByPlaceholderText(/Filter lines by regex/);
    await user.type(input, "ORDER-FAILED");
    expect(await screen.findByText(ORDER_LINE)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2 lines")).toBeInTheDocument());
  });
});
