// Drag-and-drop helpers shared by the explorer (drag source) and the chats (drop targets).

/** Data type of a project file dragged from the explorer: the value is its path in the workspace. */
export const AIDE_PATH_MIME = "application/x-aide-path";

/** True when the drag carries files from the system or a file from the project tree. */
export function isFileDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types ?? []);
  return types.includes("Files") || types.includes(AIDE_PATH_MIME);
}

/**
 * Stops the window from navigating to a file that was dropped outside a drop zone (an element
 * marked with `data-dropzone`): without this, dropping a file anywhere would replace the app with it.
 */
export function installDropGuard(): () => void {
  const guard = (e: DragEvent) => {
    const dt = e.dataTransfer;
    if (!dt || !Array.from(dt.types ?? []).includes("Files")) return;
    e.preventDefault();
    const target = e.target instanceof Element ? e.target : null;
    if (e.type === "dragover" && !target?.closest("[data-dropzone]")) dt.dropEffect = "none";
  };
  window.addEventListener("dragover", guard);
  window.addEventListener("drop", guard);
  return () => {
    window.removeEventListener("dragover", guard);
    window.removeEventListener("drop", guard);
  };
}
