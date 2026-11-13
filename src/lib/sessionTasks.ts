// Tasks the agent keeps for sessions (chats): its own to-do list and tasks it hands to another session.
// They are notes, not commands: a task never grants permission for anything the user did not ask for.

export interface SessionTask {
  id: string;
  text: string;
  done: boolean;
  /** Who created it: "self" (the session's own agent) or the id of another session that handed it over. */
  from: string;
  createdAt: number;
}

export type TaskMap = Record<string, SessionTask[]>;

export const MAX_TASKS_PER_SESSION = 30;
export const MAX_TASK_TEXT = 300;
const KEY = "aide.sessionTasks";

/** Reads saved tasks; malformed data is dropped entry by entry. */
export function parseTasks(raw: string | null): TaskMap {
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: TaskMap = {};
  for (const [chatId, list] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const tasks: SessionTask[] = [];
    for (const t of list) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.text !== "string" || !o.text.trim()) continue;
      tasks.push({
        id: o.id.slice(0, 40),
        text: o.text.slice(0, MAX_TASK_TEXT),
        done: o.done === true,
        from: typeof o.from === "string" ? o.from.slice(0, 60) : "self",
        createdAt: Number(o.createdAt) || 0,
      });
    }
    if (tasks.length > 0) out[chatId] = tasks.slice(0, MAX_TASKS_PER_SESSION);
  }
  return out;
}

export function loadTasks(): TaskMap {
  try {
    return parseTasks(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

export function saveTasks(map: TaskMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full or blocked: tasks last until restart */
  }
}

/** Adds a task to `chatId`. Returns the new map and the task, or an error text. */
export function addTask(
  map: TaskMap,
  chatId: string,
  text: string,
  from: string,
  now = Date.now(),
  id = Math.random().toString(36).slice(2, 10),
): { map: TaskMap; task: SessionTask } | { error: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { error: "Текст задания пуст" };
  const list = map[chatId] ?? [];
  if (list.filter((t) => !t.done).length >= MAX_TASKS_PER_SESSION) return { error: `В сессии уже ${MAX_TASKS_PER_SESSION} невыполненных заданий` };
  if (list.some((t) => !t.done && t.text === clean.slice(0, MAX_TASK_TEXT))) return { error: "Такое задание уже есть" };
  const task: SessionTask = { id, text: clean.slice(0, MAX_TASK_TEXT), done: false, from, createdAt: now };
  return { map: { ...map, [chatId]: [...list, task].slice(-MAX_TASKS_PER_SESSION * 2) }, task };
}

/** Finds a task by id in any session. */
export function findTask(map: TaskMap, taskId: string): { chatId: string; task: SessionTask } | null {
  for (const [chatId, list] of Object.entries(map)) {
    const task = list.find((t) => t.id === taskId);
    if (task) return { chatId, task };
  }
  return null;
}

export function setDone(map: TaskMap, taskId: string, done: boolean): TaskMap | null {
  const hit = findTask(map, taskId);
  if (!hit) return null;
  return { ...map, [hit.chatId]: map[hit.chatId].map((t) => (t.id === taskId ? { ...t, done } : t)) };
}

export function removeTask(map: TaskMap, taskId: string): TaskMap | null {
  const hit = findTask(map, taskId);
  if (!hit) return null;
  const rest = map[hit.chatId].filter((t) => t.id !== taskId);
  const next = { ...map };
  if (rest.length > 0) next[hit.chatId] = rest;
  else delete next[hit.chatId];
  return next;
}

export const openCount = (map: TaskMap, chatId: string): number => (map[chatId] ?? []).filter((t) => !t.done).length;

/** Forgets tasks of sessions that no longer exist. */
export function pruneTasks(map: TaskMap, existing: ReadonlySet<string>): TaskMap {
  return Object.fromEntries(Object.entries(map).filter(([id]) => existing.has(id)));
}
