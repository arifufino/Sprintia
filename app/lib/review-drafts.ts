// Private, bounded drafts in this tab only. Nothing here is shared with the team.
export const reviewDraftKey = (actor: string, workspace: string, sprint: string, scope: string) => `sprintia-review-draft-v1:${[actor, workspace, sprint, scope].map(encodeURIComponent).join(":")}`;
const memory = new Map<string, unknown>(), failed = new Set<string>();
const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
export function readReviewDraft<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    const value = memory.has(key) ? memory.get(key) : raw && raw.length <= 40000 ? JSON.parse(raw) : null;
    return valid(value) ? value : null;
  } catch { const value = memory.get(key); return valid(value) ? value : null; }
}
export function writeReviewDraft(key: string, value: unknown) {
  memory.set(key, value);
  try { sessionStorage.setItem(key, JSON.stringify(value)); failed.delete(key); if (!failed.size) window.removeEventListener("beforeunload", warn); return true; }
  catch { failed.add(key); window.addEventListener("beforeunload", warn); return false; }
}
export function clearReviewDraft(key: string) {
  memory.delete(key); failed.delete(key); if (!failed.size) window.removeEventListener("beforeunload", warn);
  try { sessionStorage.removeItem(key); } catch { /* The memory copy was cleared. */ }
}
