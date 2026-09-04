"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface Task {
  key: string;
  label: string;
  startedAt: number;
}

interface BackgroundTasksContextValue {
  tasks: Task[];
  isRunning: (key: string) => boolean;
  run: <T>(key: string, label: string, fn: () => Promise<T>) => Promise<T>;
}

const BackgroundTasksContext = createContext<BackgroundTasksContextValue | null>(null);

// Mounted once in the root layout, so it survives client-side navigation
// between tabs (only the page content below a layout unmounts on route
// change, not the layout itself). An upload or a Claude/OpenAI call kicked
// off from a tab keeps running to completion even if you switch away — the
// fetch isn't tied to that page component's lifecycle — but the page's own
// `uploading`/`searching` state resets on remount, so there was previously
// no way to tell a task was still in flight, or to stop firing it twice.
// Routing the async work through `run()` here instead keeps a durable,
// cross-tab record of what's still going, shown by <BackgroundTasksBar />.
export function BackgroundTasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  const isRunning = useCallback((key: string) => tasks.some((t) => t.key === key), [tasks]);

  const run = useCallback(async <T,>(key: string, label: string, fn: () => Promise<T>): Promise<T> => {
    setTasks((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, label, startedAt: Date.now() }]));
    try {
      return await fn();
    } finally {
      setTasks((prev) => prev.filter((t) => t.key !== key));
    }
  }, []);

  const value = useMemo(() => ({ tasks, isRunning, run }), [tasks, isRunning, run]);

  return (
    <BackgroundTasksContext.Provider value={value}>
      {children}
      <BackgroundTasksBar tasks={tasks} />
    </BackgroundTasksContext.Provider>
  );
}

export function useBackgroundTasks(): BackgroundTasksContextValue {
  const ctx = useContext(BackgroundTasksContext);
  if (!ctx) throw new Error("useBackgroundTasks must be used within BackgroundTasksProvider");
  return ctx;
}

function BackgroundTasksBar({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[100] max-w-xs rounded-lg bg-blueprint-dark px-3 py-2 text-xs text-white shadow-lg">
      <div className="flex items-center gap-2 font-medium">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber" />
        {tasks.length === 1 ? "1 task running in the background" : `${tasks.length} tasks running in the background`}
      </div>
      <ul className="mt-1 space-y-0.5 text-white/70">
        {tasks.map((t) => (
          <li key={t.key} className="truncate">
            {t.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
