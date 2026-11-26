/** What is still missing before the Qoder subscription can be used. */
export type QoderStep = "install" | "check";

export function qoderStep(status: { cli: string | null }): QoderStep {
  return status.cli ? "check" : "install";
}

/** Official commands from the Qoder documentation. AIDE shows them; the user runs them. */
export function qoderCommands(windows: boolean): { install: string; login: string } {
  return {
    install: windows ? "irm https://qoder.com/install.ps1 | iex" : "curl -fsSL https://qoder.com/install | bash",
    login: "qodercli login",
  };
}
