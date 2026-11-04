/** Format array-like profile values stored as either JSON text or string arrays. */
export function displayList(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", ");
    } catch {
      // Plain text is a supported legacy value; preserve it unchanged.
    }
    return value;
  }
  return "";
}
