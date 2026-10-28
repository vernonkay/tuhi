import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock the Tauri bridge + plugins so the full App mounts with no backend. The invoke mock is
// scenario-driven (see tauri-mock.ts); the plugins are inert stubs.
vi.mock("@tauri-apps/api/core", async () => {
  const mock = await import("./tauri-mock");
  return { invoke: (cmd: string, args?: unknown) => mock.invokeMock(cmd, args) };
});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize() {},
    toggleMaximize() {},
    close() {},
    label: "main",
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: async () => true,
  open: async () => null,
  save: async () => null,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: async () => "",
  writeText: async () => {},
}));
// Mermaid pulls in heavy browser-only machinery at init; the editor only needs it for diagrams,
// which these tests never render.
vi.mock("mermaid", () => ({ default: { initialize() {}, render: async () => ({ svg: "" }) } }));

afterEach(() => cleanup());

// jsdom is missing a few browser APIs the editor chrome touches. Stub them so mounting succeeds;
// the editor already guards on zero sizes, so the defaults are harmless.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
if (!("ResizeObserver" in globalThis)) {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
