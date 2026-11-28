/** Prefer Nest `{ message }` JSON bodies over raw response text in UI copy. */
export function formatApiErrorMessage(raw: string | null | undefined, fallback = "Request failed"): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // Plain-text Nest/network errors stay as-is.
  }
  return text;
}
