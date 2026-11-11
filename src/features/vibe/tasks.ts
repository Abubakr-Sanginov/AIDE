import { useMemo } from "react";
import { useAi } from "@/stores/ai";
import { useChats, titleOf } from "@/stores/chats";
import type { VibeText } from "./strings";

// Vibe "tasks" are the IDE chat sessions: the live conversation (in the AI store)
// plus the archived ones. No separate storage.

export type TaskStatus = "empty" | "running" | "failed" | "done";

export interface Task {
  id: string;
  title: string;
  updatedAt: number;
  status: TaskStatus;
  snippet: string;
  live: boolean;
}

function snippetOf(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function useTasks(): { tasks: Task[]; activeId: string | null } {
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const messages = useAi((s) => s.messages);
  const streaming = useAi((s) => s.streaming);
  const error = useAi((s) => s.error);

  return useMemo(() => {
    const list: Task[] = chats
      .filter((c) => c.id !== activeId)
      .map((c) => {
        const last = [...c.messages].reverse().find((m) => m.role === "assistant");
        return {
          id: c.id,
          title: c.title || "",
          updatedAt: c.updatedAt,
          status: last?.error ? "failed" : "done",
          snippet: snippetOf(last?.errorText ?? last?.content ?? ""),
          live: false,
        } satisfies Task;
      });
    // The active task always exists (even before the first message).
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const saved = chats.find((c) => c.id === activeId);
    list.push({
      id: activeId ?? "live",
      title: titleOf(messages),
      updatedAt: saved?.updatedAt ?? Date.now(),
      status:
        messages.length === 0
          ? "empty"
          : streaming
            ? "running"
            : error || lastAssistant?.error
              ? "failed"
              : "done",
      snippet: snippetOf(error ?? lastAssistant?.errorText ?? lastAssistant?.content ?? ""),
      live: true,
    });
    list.sort((a, b) => (a.live === b.live ? b.updatedAt - a.updatedAt : a.live ? -1 : 1));
    return { tasks: list, activeId: activeId ?? "live" };
  }, [chats, activeId, messages, streaming, error]);
}

export function groupOf(ts: number, now = Date.now()): "today" | "yesterday" | "earlier" {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (ts >= startOfToday.getTime()) return "today";
  if (ts >= startOfToday.getTime() - day) return "yesterday";
  return "earlier";
}

export function ageOf(ts: number, T: VibeText, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return T.now;
  if (s < 3600) return `${Math.floor(s / 60)} ${T.min}`;
  if (s < 86_400) return `${Math.floor(s / 3600)} ${T.hour}`;
  return `${Math.floor(s / 86_400)} ${T.day}`;
}
