// Formats a Postgres "time" column value ("HH:MM" or "HH:MM:SS") as a
// locale-aware clock time, e.g. "9:00 AM" — shared between the warranty
// request schedule UI (app/projects/[id]/warranty-request/) and the
// Calendar page's scheduled-visit entries (app/calendar/).
export function formatTime(t: string): string {
  const [hh, mm] = t.split(":").map(Number);
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatTimeWindow(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start);
}
