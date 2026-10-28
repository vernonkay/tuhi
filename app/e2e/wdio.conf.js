// End-to-end tests: drive the REAL built tuhi binary through WebDriver, so these exercise the
// actual Rust backend, the IPC bridge and the native webview (WebView2 on Windows, WebKitGTK on
// Linux) — the layers the jsdom component tests (src/*.test.tsx) deliberately mock. The release
// binary must already exist before running: see the `e2e` job in .github/workflows/ci.yml, or
// locally run `npm run tauri -- build --debug --no-bundle` then `npm run e2e` (or just `just e2e`).
// Build via the Tauri CLI, never a bare `cargo build`: the CLI embeds the front-end, whereas a
// plain cargo build runs in dev mode and expects the Vite dev server, so the webview is blank.
//
// Driver: the external, cargo-installed `tauri-driver` (driverProvider "official"), so the tests
// drive the exact binary we ship rather than a build with an embedded test server. Covers Windows
// and Linux; macOS needs a third-party driver fork and is deferred (tracked for a later round).
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ext = process.platform === "win32" ? ".exe" : "";
// Cargo package name is `tuhi` (src-tauri/Cargo.toml), so the binary is `tuhi[.exe]`. Default to
// the release binary; CI overrides with TUHI_E2E_BINARY pointing at the debug build, which is far
// cheaper to compile (the release profile uses full LTO) and functionally identical for these
// DOM/IPC behaviour tests.
const appBinary =
  process.env.TUHI_E2E_BINARY ||
  join(here, "..", "src-tauri", "target", "release", `tuhi${ext}`);

export const config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.js"],
  // One app window at a time: the Rust backend holds global editor state (the open-tab
  // registry behind a single mutex), so parallel windows would race over it.
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinary },
    },
  ],
  services: [
    [
      "tauri",
      {
        driverProvider: "official", // external, cargo-installed tauri-driver
        appBinaryPath: appBinary,
        autoInstallTauriDriver: false, // CI installs it: `cargo install tauri-driver --locked`
        tauriDriverPort: 4444,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120000 },
  logLevel: "warn",
  outputDir: "./logs",
  waitforTimeout: 20000,
};
