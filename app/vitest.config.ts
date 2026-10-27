import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Front-end UI tests: Vitest + Testing Library in jsdom. They mount the real React UI with the
// Rust backend mocked (src/test/tauri-mock.ts), so they run fast and headless on every OS in CI —
// the per-phase automated check that the editor's behaviour still holds. The Rust side is covered
// separately by `cargo test`. Kept out of the production bundle (vite build never imports *.test).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
