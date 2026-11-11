import "@/dev/mockTauri";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { hydrateStorage } from "@/lib/persist";
import { applyMotionPref } from "@/lib/motion";
import { CrashBoundary, CrashView } from "@/lib/crashScreen";
import "@/styles/index.css";

const rootEl = document.getElementById("root") as HTMLElement;
const root = ReactDOM.createRoot(rootEl);

// Errors outside React rendering (a failed module import, an exception in an event handler that left the
// window empty) are shown too, but only when nothing is on screen: a harmless warning must not cover a working app.
function showCrash(error: unknown) {
  if (rootEl.querySelector("[role=alert][data-crash]")) return;
  if (rootEl.children.length > 0 && !(error instanceof SyntaxError) && !/dynamically imported|Failed to fetch|module/i.test(String(error))) return;
  root.render(<CrashView error={error} />);
}
window.addEventListener("error", (e) => {
  // The Tauri event bridge throws harmlessly when it is torn down during a reload.
  if (/unregisterListener/.test(String(e.message))) return;
  showCrash(e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  if (/unregisterListener/.test(String(e.reason))) return;
  showCrash(e.reason);
});

// The stores read localStorage when they are created, so the saved state must be
// restored from disk BEFORE the app (and its stores) is imported.
void hydrateStorage()
  .catch(() => {})
  .then(() => applyMotionPref())
  .then(() => import("@/app/App"))
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <CrashBoundary>
          <App />
        </CrashBoundary>
      </React.StrictMode>,
    );
  })
  .catch((e) => root.render(<CrashView error={e} />));
