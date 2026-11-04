/** Convert unknown thrown values and Supabase errors into a readable message. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length) return parts.join(" · ");
    try {
      return JSON.stringify(error);
    } catch {
      return "An unknown error occurred.";
    }
  }
  return String(error);
}
