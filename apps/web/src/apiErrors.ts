/** Prefer Nest `{ message }` JSON bodies over raw response text in UI copy. */
export function formatApiErrorMessage(raw: string | null | undefined, fallback = "Request failed"): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return fallback;
  let message = text;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) message = parsed.message.trim();
  } catch {
    // Plain-text Nest/network errors stay as-is.
  }
  const missing = /^Missing permission:\s*(.+)$/i.exec(message);
  if (missing) {
    return `Your role cannot perform this action (${missing[1]}). Ask a workspace administrator if you need access.`;
  }
  return message;
}
