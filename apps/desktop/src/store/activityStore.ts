import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";

/**
 * What ForgeSF has done, kept across restarts.
 *
 * Toasts say what just happened and then disappear; the Dashboard's activity
 * card used to read the workspace terminal, so it only ever showed this
 * session's file operations and nothing about deploys, test runs or orgs. This
 * is the log both of those should have been reading.
 */

const STORE_FILE = "forgesf.json";
const KEY = "activity";

/** Enough to answer "what did I do yesterday", not enough to grow unbounded. */
const KEEP = 200;

export type ActivityKind = "success" | "error" | "info" | "warning";

export type ActivitySource =
  "deploy" | "retrieve" | "tests" | "org" | "workspace" | "logs";

export interface ActivityEvent {
  id: string;
  /** Milliseconds since the epoch. */
  at: number;
  kind: ActivityKind;
  source: ActivitySource;
  /** One line, as it appears in the list. */
  title: string;
  /** Anything worth keeping that does not fit on the line. */
  detail?: string;
  /** The org it happened against, when it was about one. */
  org?: string;
}

const KINDS: ActivityKind[] = ["success", "error", "info", "warning"];
const SOURCES: ActivitySource[] = [
  "deploy",
  "retrieve",
  "tests",
  "org",
  "workspace",
  "logs",
];

/** Keeps the events that still make sense, in case the file was hand-edited. */
export function normaliseActivity(raw: unknown): ActivityEvent[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((event): event is ActivityEvent => {
      if (typeof event !== "object" || event === null) return false;
      const candidate = event as Partial<ActivityEvent>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.at === "number" &&
        typeof candidate.title === "string" &&
        KINDS.includes(candidate.kind as ActivityKind) &&
        SOURCES.includes(candidate.source as ActivitySource)
      );
    })
    .slice(-KEEP);
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function persist(events: ActivityEvent[]) {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    void (async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set(KEY, events);
        await store.save();
      } catch {
        // The log is a convenience; failing to write it must not surface as
        // an error over whatever the user was actually doing.
      }
    })();
  }, 400);
}

interface ActivityState {
  events: ActivityEvent[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Newest first is how it is read, so that is how it is stored in memory. */
  record: (event: Omit<ActivityEvent, "id" | "at">) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: [],
  loaded: false,

  load: async () => {
    try {
      const store = await load(STORE_FILE);
      const raw = await store.get<unknown>(KEY);
      set({ events: normaliseActivity(raw).reverse(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  record: (event) => {
    const entry: ActivityEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
    };
    const events = [entry, ...get().events].slice(0, KEEP);
    set({ events });
    // Stored oldest-first, which is how a log reads in a file.
    persist([...events].reverse());
  },

  clear: () => {
    set({ events: [] });
    persist([]);
  },
}));

/** Records an event from anywhere, without a hook. */
export function recordActivity(event: Omit<ActivityEvent, "id" | "at">) {
  useActivityStore.getState().record(event);
}

/** "just now", "12 min ago", "3 days ago" — how long ago something happened. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(at).toLocaleDateString();
}
