import { dirOf, viewTransition } from "@/lib/motion";
import { create } from "zustand";
import { useWorkspace } from "@/stores/workspace";
import { adoptLegacy, currentRoot, keyFor, sameRoot } from "@/lib/workspaceKey";
import { PRESETS, REQUIRED, ROLE_BY_ID, type PresetId, type RoleId } from "./roles";

export type Phase = "idle" | "planning" | "working" | "verifying" | "fixing" | "done" | "blocked" | "stopped";

export interface FeedItem {
  id: string;
  role: RoleId | "ceo" | "system";
  kind: "say" | "work" | "check" | "final" | "error";
  text: string;
  ts: number;
}

export interface Check {
  text: string;
  status: "pending" | "pass" | "fail";
}

export interface KinsTask {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  phase: Phase;
  feed: FeedItem[];
  checks: Check[];
  /** Transcript of a call held before the task (context for the team). */
  brief: string;
}

export interface CallLine {
  who: RoleId | "ceo";
  text: string;
  tools?: string[];
}

interface TeamConfig {
  preset: PresetId;
  customRoles: RoleId[];
  models: Partial<Record<RoleId, string>>;
  discuss: boolean;
}

const TEAM_KEY = "aide.kins.team";
const TASKS_KEY = "aide.kins.tasks";
// Team settings are the user's own and stay global; tasks belong to the project that is open.
let kinsRoot: string | null = currentRoot();
const MAX_TASKS = 30;
const MAX_FEED = 200;
const MAX_TEXT = 20_000;

const isRole = (v: unknown): v is RoleId => typeof v === "string" && v in ROLE_BY_ID;

function readTeam(): TeamConfig {
  const fallback: TeamConfig = { preset: "feature", customRoles: [...PRESETS[2].roles], models: {}, discuss: false };
  try {
    const raw = JSON.parse(localStorage.getItem(TEAM_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return fallback;
    const models: Partial<Record<RoleId, string>> = {};
    if (raw.models && typeof raw.models === "object") {
      for (const [k, v] of Object.entries(raw.models)) if (isRole(k) && typeof v === "string") models[k] = v.slice(0, 120);
    }
    const custom = Array.isArray(raw.customRoles) ? raw.customRoles.filter(isRole) : fallback.customRoles;
    return {
      preset: PRESETS.some((p) => p.id === raw.preset) ? raw.preset : "feature",
      customRoles: custom.includes("lead") ? custom : ["lead", ...custom],
      models,
      discuss: raw.discuss === true,
    };
  } catch {
    return fallback;
  }
}

function readTasks(root: string | null): KinsTask[] {
  try {
    const raw = JSON.parse(localStorage.getItem(adoptLegacy(TASKS_KEY, root)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t) => t && typeof t.id === "string" && Array.isArray(t.feed))
      .slice(0, MAX_TASKS)
      .map((t): KinsTask => {
        const phase: Phase = ["done", "blocked", "stopped"].includes(t.phase) ? t.phase : "stopped"; // a run never survives a restart
        return {
          id: String(t.id),
          title: String(t.title ?? "").slice(0, 80),
          createdAt: Number(t.createdAt) || Date.now(),
          updatedAt: Number(t.updatedAt) || Date.now(),
          phase,
          feed: t.feed.slice(-MAX_FEED),
          checks: Array.isArray(t.checks) ? t.checks : [],
          brief: typeof t.brief === "string" ? t.brief : "",
        };
      });
  } catch {
    return [];
  }
}

let saveTimer: number | undefined;
function writeNow(tasks: KinsTask[], team: TeamConfig) {
  try {
    localStorage.setItem(keyFor(TASKS_KEY, kinsRoot), JSON.stringify(tasks.slice(0, MAX_TASKS)));
    localStorage.setItem(TEAM_KEY, JSON.stringify(team));
  } catch {
    /* storage full: keep working in memory */
  }
}
function persist(tasks: KinsTask[], team: TeamConfig) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => writeNow(tasks, team), 400);
}

export type Mood = "idle" | "thinking" | "working" | "checking" | "wants" | "speaking";

export type KinsTab = "agent" | "kins";
/** Order of the tabs in the title bar (transitions slide in this direction). */
const KINS_TAB_ORDER: KinsTab[] = ["agent", "kins"];
export type SideTab = "preview" | "team" | "checks";

interface KinsState {
  tab: KinsTab;
  view: "feed" | "call";
  team: TeamConfig;
  tasks: KinsTask[];
  activeId: string | null;
  /** Role currently working / speaking. */
  activeRole: RoleId | null;
  /** Explicit per-role state (call): who thinks, who has a line queued, who speaks. */
  moods: Partial<Record<RoleId, Mood>>;
  running: boolean;
  sideOpen: boolean;
  sideTab: SideTab;
  previewUrl: string;
  teamDialog: PresetId | null;
  call: { lines: CallLine[]; busy: boolean; listening: boolean; muted: boolean };

  setTab: (tab: KinsTab) => void;
  setView: (v: "feed" | "call") => void;
  setPreset: (p: PresetId) => void;
  setRoleEnabled: (id: RoleId, on: boolean) => void;
  setRoleModel: (id: RoleId, model: string) => void;
  setDiscuss: (v: boolean) => void;
  openTeamDialog: (p: PresetId | null) => void;
  roles: () => RoleId[];

  newTask: () => void;
  openTask: (id: string) => void;
  deleteTask: (id: string) => void;
  createTask: (title: string, brief: string) => string;
  patchTask: (id: string, patch: Partial<Pick<KinsTask, "phase" | "checks" | "brief" | "title">>) => void;
  addFeed: (id: string, item: Omit<FeedItem, "id" | "ts">) => string;
  setFeedText: (taskId: string, feedId: string, text: string) => void;
  setActiveRole: (r: RoleId | null) => void;
  setMoods: (m: Partial<Record<RoleId, Mood>>) => void;
  setRunning: (v: boolean) => void;
  setSide: (open: boolean, tab?: SideTab) => void;
  setPreviewUrl: (u: string) => void;
  setCall: (patch: Partial<KinsState["call"]>) => void;
  pushCallLine: (line: CallLine) => void;
  resetCall: () => void;
}

const emptyCall = { lines: [] as CallLine[], busy: false, listening: false, muted: false };

export const useKins = create<KinsState>((set, get) => {
  const commit = (patch: Partial<KinsState>) => {
    set(patch);
    const s = get();
    persist(s.tasks, s.team);
  };
  const mapTask = (id: string, fn: (t: KinsTask) => KinsTask) =>
    get().tasks.map((t) => (t.id === id ? { ...fn(t), updatedAt: Date.now() } : t));

  return {
    tab: "agent",
    view: "feed",
    team: readTeam(),
    tasks: readTasks(kinsRoot),
    activeId: null,
    activeRole: null,
    moods: {},
    running: false,
    sideOpen: false,
    sideTab: "preview",
    previewUrl: "",
    teamDialog: null,
    call: { ...emptyCall },

    // Agent / Crew slide like pages; the call zooms in over the feed.
    setTab: (tab) => {
      if (get().tab !== tab) viewTransition(() => set({ tab }), "vibe", dirOf(KINS_TAB_ORDER, get().tab, tab));
    },
    setView: (view) => {
      if (get().view !== view) viewTransition(() => set({ view }), "vibe", view === "call" ? "zoom" : "unzoom");
    },
    setPreset: (preset) => commit({ team: { ...get().team, preset } }),
    setRoleEnabled: (id, on) => {
      if (REQUIRED.includes(id)) return;
      const team = get().team;
      const list = on ? [...new Set([...team.customRoles, id])] : team.customRoles.filter((r) => r !== id);
      commit({ team: { ...team, customRoles: list } });
    },
    setRoleModel: (id, model) => commit({ team: { ...get().team, models: { ...get().team.models, [id]: model } } }),
    setDiscuss: (discuss) => commit({ team: { ...get().team, discuss } }),
    openTeamDialog: (teamDialog) => set({ teamDialog }),
    roles: () => {
      const { preset, customRoles } = get().team;
      return preset === "custom" ? customRoles : (PRESETS.find((p) => p.id === preset)?.roles ?? customRoles);
    },

    newTask: () => {
      if (get().running) return;
      set({ activeId: null, view: "feed", activeRole: null });
    },
    openTask: (id) => {
      if (get().running) return;
      set({ activeId: id, view: "feed", activeRole: null });
    },
    deleteTask: (id) => {
      if (get().running) return;
      commit({ tasks: get().tasks.filter((t) => t.id !== id), activeId: get().activeId === id ? null : get().activeId });
    },
    createTask: (title, brief) => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const task: KinsTask = { id, title: title.replace(/\s+/g, " ").trim().slice(0, 60), createdAt: now, updatedAt: now, phase: "planning", feed: [], checks: [], brief };
      commit({ tasks: [task, ...get().tasks].slice(0, MAX_TASKS), activeId: id });
      return id;
    },
    patchTask: (id, patch) => commit({ tasks: mapTask(id, (t) => ({ ...t, ...patch })) }),
    addFeed: (id, item) => {
      const feedId = crypto.randomUUID();
      const entry: FeedItem = { ...item, id: feedId, ts: Date.now(), text: item.text.slice(0, MAX_TEXT) };
      commit({ tasks: mapTask(id, (t) => ({ ...t, feed: [...t.feed, entry].slice(-MAX_FEED) })) });
      return feedId;
    },
    setFeedText: (taskId, feedId, text) =>
      commit({
        tasks: mapTask(taskId, (t) => ({ ...t, feed: t.feed.map((f) => (f.id === feedId ? { ...f, text: text.slice(0, MAX_TEXT) } : f)) })),
      }),
    setActiveRole: (activeRole) => set({ activeRole }),
    setMoods: (moods) => set({ moods }),
    setRunning: (running) => set({ running }),
    setSide: (sideOpen, tab) => set({ sideOpen, sideTab: tab ?? get().sideTab }),
    setPreviewUrl: (previewUrl) => set({ previewUrl }),
    setCall: (patch) => set({ call: { ...get().call, ...patch } }),
    pushCallLine: (line) => set({ call: { ...get().call, lines: [...get().call.lines, line].slice(-60) } }),
    resetCall: () => set({ call: { ...emptyCall } }),
  };
});

/**
 * Tasks follow the project: the ones of the project being left are written under it
 * synchronously (a pending debounced save must not land in the next project), then
 * the new project's own tasks are shown.
 */
useWorkspace.subscribe((s, prev) => {
  if (s.root === prev.root || !s.root || sameRoot(s.root, kinsRoot)) return;
  const k = useKins.getState();
  window.clearTimeout(saveTimer);
  writeNow(k.tasks, k.team); // still the old kinsRoot
  kinsRoot = s.root;
  useKins.setState({ tasks: readTasks(kinsRoot), activeId: null, view: "feed", activeRole: null, moods: {}, call: { ...emptyCall } });
});
