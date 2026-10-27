import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { openFileScenario, resetScenario, setScenario } from "./test/tauri-mock";

// UI tests for data mode (feature #2): the lens (DATA bar, collapse-to-matches filter, LIVE tail
// badge, highlight stripes) and that it stays off for ordinary Markdown. The Rust backend is
// mocked, so these assert the front-end behaviour wired in App.tsx, fast and headless.

const ORDER_LINE = "2026-10-28 06:00:03.492 ERROR [exec-7] c.d.sync.LedgerPoller ORDER-FAILED settlement rejected reason=insufficient-funds";
const INFO_LINE = "2026-10-28 06:00:03.500 INFO [exec-2] c.d.api.RequestFilter GET /health 200 (3ms)";

beforeEach(() => {
  resetScenario();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("data mode", () => {
  it("engages automatically for a large read-only log", async () => {
    openFileScenario("C:/logs/app-server.log", { readonly: true });
    render(<App />);
    // The DATA bar (the lens) appears, and the rail Data dot is active.
    expect(await screen.findByText("DATA")).toBeInTheDocument();
    expect(screen.getByText("Data").closest("button")).toHaveClass("on");
    expect(screen.getByPlaceholderText(/Filter lines by regex/)).toBeInTheDocument();
  });

  it("stays off for an ordinary Markdown file", async () => {
    openFileScenario("C:/notes/todo.md", { readonly: false, char_count: 20, line_count: 3 });
    render(<App />);
    // Markdown opens in the live preview, not data mode: no DATA bar.
    await screen.findByText(/Type to start writing/);
    expect(screen.queryByText("DATA")).not.toBeInTheDocument();
  });

  it("collapses the view to matching lines when the lens filter has a query", async () => {
    openFileScenario("C:/logs/app-server.log");
    setScenario({
      filterRows: [
        { line: 41, text: ORDER_LINE, truncated: false },
        { line: 88, text: "2026-10-28 06:00:05.110 ERROR [exec-3] c.d.api.ClaimController ORDER-FAILED settlement rejected reason=limit-exceeded", truncated: false },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByPlaceholderText(/Filter lines by regex/);
    await user.type(input, "ORDER-FAILED");
    // The collapse-list renders the matching rows and the lens shows the match count.
    expect(await screen.findByText(ORDER_LINE)).toBeInTheDocument();
    expect(screen.getByText("2 matches")).toBeInTheDocument();
  });

  it("tints lines that match a highlight rule", async () => {
    localStorage.setItem("tuhi.highlighters", JSON.stringify([{ pattern: "ORDER-FAILED", color: "#ff0000" }]));
    openFileScenario("C:/logs/app-server.log");
    setScenario({
      filterRows: [
        { line: 41, text: ORDER_LINE, truncated: false },
        { line: 42, text: INFO_LINE, truncated: false },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByPlaceholderText(/Filter lines by regex/);
    await user.type(input, "ORDER|INFO");
    const tinted = (await screen.findByText(ORDER_LINE)).closest(".filter-row");
    const plain = screen.getByText(INFO_LINE).closest(".filter-row");
    expect(tinted?.getAttribute("style") ?? "").toContain("3px"); // the gutter stripe
    expect(plain?.getAttribute("style") ?? "").not.toContain("3px");
  });

  it("turns following on from the lens", async () => {
    openFileScenario("C:/logs/app-server.log");
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("DATA");
    const tailBtn = container.querySelector(".lens-btn.tail");
    expect(tailBtn).not.toBeNull();
    await user.click(tailBtn as Element);
    await waitFor(() => expect(container.querySelector(".live-badge")).toHaveClass("on"));
  });
});
