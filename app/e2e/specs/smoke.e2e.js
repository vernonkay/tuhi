import { $, $$, expect } from "@wdio/globals";

// Smoke test: the app launches and renders its Studio chrome. If this passes, the real binary
// started, the webview loaded the bundled front-end, and the Rust backend answered the initial
// IPC (tab state, viewport) — none of which the mocked component tests exercise. Keep it anchored
// on the always-present left rail (the dot buttons carry stable `title` attributes in App.tsx).
describe("tuhi launches", () => {
  it("renders the left rail (Files · … · Settings)", async () => {
    const files = await $('.gut-dot-btn[title="Files"]');
    await files.waitForExist({ timeout: 30000 });
    await expect(files).toExist();

    const settings = await $('.gut-dot-btn[title="Settings"]');
    await expect(settings).toExist();

    // Files · Search · Data · Settings — at least three dots in every build.
    const dots = await $$(".gut-dot-btn");
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });
});
