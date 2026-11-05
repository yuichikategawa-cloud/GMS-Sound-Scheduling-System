/** Shared, side-effect-free formatting and display helpers. */
export const today = () => new Date().toLocaleDateString("en-CA");

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
