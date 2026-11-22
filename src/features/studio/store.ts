import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appendItems, makeItem, stepIndex, type PreviewImage } from "@/lib/studioPreview";

export interface StudioModel {
  name: string;
  path: string;
  mime: string;
  /** base64 */
  data: string;
}

interface AssetReply {
  name: string;
  path: string;
  kind: "image" | "model";
  mime: string;
  data: string;
}

export interface AssetInfo {
  path: string;
  kind: "image" | "model";
}

interface StudioState {
  /** The UI keeps its own copy of the images: the model only remembers the last two. Memory only, never saved. */
  items: PreviewImage[];
  index: number;
  model: StudioModel | null;
  view: "image" | "model";
  open: boolean;
  error: string;
  addImages: (images: { name?: string; mime: string; data: string }[], tool: string) => void;
  select: (i: number) => void;
  step: (delta: number) => void;
  setOpen: (open: boolean) => void;
  clear: () => void;
  openFile: (path: string) => Promise<void>;
  listAssets: () => Promise<AssetInfo[]>;
}

export const useStudio = create<StudioState>((set, get) => ({
  items: [],
  index: 0,
  model: null,
  view: "image",
  open: true,
  error: "",
  addImages: (images, tool) => {
    const fresh = images.map((i) => makeItem(i, tool)).filter((i): i is PreviewImage => i !== null);
    if (fresh.length === 0) return;
    // The newest picture is shown; earlier ones stay one click away.
    const items = appendItems(get().items, fresh);
    set({ items, index: items.length - 1, view: "image", open: true, error: "" });
  },
  select: (i) => set({ index: Math.max(0, Math.min(i, get().items.length - 1)), view: "image" }),
  step: (delta) => set({ index: stepIndex(get().index, delta, get().items.length), view: "image" }),
  setOpen: (open) => set({ open }),
  clear: () => set({ items: [], index: 0, model: null, view: "image", error: "" }),
  openFile: async (path) => {
    try {
      const a = await invoke<AssetReply>("studio_read_asset", { path });
      if (a.kind === "image") {
        get().addImages([{ name: a.name, mime: a.mime, data: a.data }], "studio_show");
      } else {
        set({ model: { name: a.name, path: a.path, mime: a.mime, data: a.data }, view: "model", open: true, error: "" });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },
  listAssets: async () => {
    try {
      return await invoke<AssetInfo[]>("studio_list_assets");
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },
}));

interface PreviewPayload {
  requestId: string;
  tool: string;
  images: { name: string; mime: string; data: string }[];
}

// Registered once, at app start, so pictures are collected even while the panel is closed.
let wired = false;
export function wireStudioEvents() {
  if (wired) return;
  wired = true;
  try {
    void listen<PreviewPayload>("studio-preview", (e) => {
      const p = e.payload;
      if (p && Array.isArray(p.images)) useStudio.getState().addImages(p.images, String(p.tool ?? "tool"));
    });
    void listen<{ path: string }>("studio-show-file", (e) => {
      if (e.payload && typeof e.payload.path === "string") void useStudio.getState().openFile(e.payload.path);
    });
  } catch {
    // Not running inside Tauri (tests, plain browser).
  }
}
