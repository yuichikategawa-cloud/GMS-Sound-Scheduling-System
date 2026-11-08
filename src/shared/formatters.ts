/** Shared, side-effect-free formatting and display helpers. */
export function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const today = () => localDateKey(new Date());

/** True only while a service's local start time is still in the future. */
export function isScheduleUpcoming(serviceDate: string, startTime: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(startTime)) return false;
  const [year, month, day] = serviceDate.split("-").map(Number);
  const [hour, minute, second = 0] = startTime.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const startsAt = new Date(year, month - 1, day, hour, minute, second);
  if (startsAt.getFullYear() !== year || startsAt.getMonth() !== month - 1 || startsAt.getDate() !== day) return false;
  return startsAt.getTime() > now.getTime();
}

export const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const shortTime = (t: string) => t?.slice(0, 5) ?? "";

export const dayNameForTemplate = (d: number) =>
  Number(d) === 6 ? "Saturday" : "Sunday";

export const errorText = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const value = e as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length) return parts.join(" · ");
    try {
      return JSON.stringify(e);
    } catch {
      return "An unknown error occurred.";
    }
  }
  return String(e);
};

export const displayList = (v: unknown): string => {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", ");
    } catch {
      // Keep the original text when it is not JSON.
    }
    return v;
  }
  return "";
};
