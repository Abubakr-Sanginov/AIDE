// "Computer" mode: the agent looks at the screen and uses the mouse and keyboard. Before the first use the person has to
// read what that means and agree. This flag is a convenience (do not ask every time), not a security boundary: the real
// limits (permission mode, no mouse/keyboard control of AIDE, the corner failsafe, the action limit) are enforced by the backend.
// Full mode intentionally allows arbitrary terminal commands with AIDE's permissions.

const KEY = "aide.computerConsent";

export function hasComputerConsent(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function grantComputerConsent(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable: the question is asked again next time */
  }
}

export function revokeComputerConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to remove */
  }
}
