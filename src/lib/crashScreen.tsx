import { Component, type ErrorInfo, type ReactNode } from "react";

// A crash must never leave a black window: whatever went wrong is printed on screen with a reload button,
// so the cause can be read (and copied) instead of guessed.

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}\n\n${(e.stack ?? "").split("\n").slice(0, 14).join("\n")}`;
  return String(e);
}

export function CrashView({ error }: { error: unknown }) {
  const text = describe(error);
  return (
    <div
      role="alert"
      data-crash
      style={{ position: "fixed", inset: 0, zIndex: 99999, overflow: "auto", padding: 28, background: "#111110", color: "#e6e5e0", fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 600 }}>AIDE: ошибка интерфейса / interface error</h1>
      <p style={{ margin: "0 0 14px", color: "#b0afaa", fontSize: 14 }}>
        Окно не показано из-за ошибки. Нажмите «Перезагрузить»; если повторяется, скопируйте текст ниже. / The window crashed. Reload it; if it repeats, copy the text below.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => location.reload()} style={{ height: 36, padding: "0 16px", borderRadius: 12, border: 0, background: "#fbc89d", color: "#111110", fontWeight: 600, cursor: "pointer" }}>
          Перезагрузить / Reload
        </button>
        <button
          onClick={() => void navigator.clipboard.writeText(text).catch(() => {})}
          style={{ height: 36, padding: "0 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#e6e5e0", cursor: "pointer" }}
        >
          Копировать / Copy
        </button>
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.5, color: "#f2a0a0", userSelect: "text" }}>{text}</pre>
    </div>
  );
}

export class CrashBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("AIDE crash:", error, info.componentStack);
  }

  render() {
    return this.state.error ? <CrashView error={this.state.error} /> : this.props.children;
  }
}
