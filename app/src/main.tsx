import React from "react";
import ReactDOM from "react-dom/client";
// Self-host the brand typefaces so tuhi wears its own type on every machine (otherwise
// Inter/JetBrains Mono fall back to the OS default). Bricolage Grotesque is the display
// voice, used for rendered Markdown headings. All bundled, so they work offline / in-CSP.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/bricolage-grotesque";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
