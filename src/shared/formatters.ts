/** Shared, side-effect-free formatting and display helpers. */
export function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const today = () => localDateKey(new Date());

/** Current calendar date in the timezone used by service and deadline rules. */
export const todayInJakarta = (now = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const current = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${current.year}-${current.month}-${current.day}`;
};

/** True only while a service's Asia/Jakarta start time is still in the future. */
export function isScheduleUpcoming(serviceDate: string, startTime: string, now = new Date()): boolean {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(startTime);
  if (!dateMatch || !timeMatch) return false;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;

  const dateCheck = new Date(0);
  dateCheck.setUTCFullYear(year, month - 1, day);
  dateCheck.setUTCHours(0, 0, 0, 0);
  if (dateCheck.toISOString().slice(0, 10) !== serviceDate) return false;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const current = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const nowWallTime = Date.UTC(Number(current.year), Number(current.month) - 1,
    Number(current.day), Number(current.hour), Number(current.minute), Number(current.second));
  const serviceWallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  return serviceWallTime > nowWallTime;
}

/** Display service dates consistently as DD-MONTH-YYYY (for example, 25-December-2026). */
export const fmtDate = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (month < 1 || month > 12 || day < 1 || date.toISOString().slice(0, 10) !== value) {
    return value;
  }

  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);

  return dayText + "-" + monthName + "-" + yearText;
};

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
