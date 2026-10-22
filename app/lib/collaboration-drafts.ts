export type TextDraft = { text: string; revision: number };
export const textDraftKey = (kind: "comment" | "daily", actor: string, workspace: string, scope: string) => `sprintia-${kind}-draft-v1:${[actor, workspace, scope].map(encodeURIComponent).join(":")}`;
const memory = new Map<string, TextDraft>();
const failed = new Set<string>();
const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
export function readTextDraft(key: string): TextDraft | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const raw = sessionStorage.getItem(key); if (!raw || raw.length > 16000) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft.text === "string" && draft.text.length <= 2000 && Number.isSafeInteger(draft.revision) && draft.revision >= 0 ? draft : null;
  } catch { return null; }
}
export function writeTextDraft(key: string, draft: TextDraft) {
  memory.set(key, draft);
  try { sessionStorage.setItem(key, JSON.stringify(draft)); failed.delete(key); if (!failed.size) window.removeEventListener("beforeunload", warn); return true; }
  catch { failed.add(key); window.addEventListener("beforeunload", warn); return false; }
}
export function clearTextDraft(key: string) {
  memory.delete(key); failed.delete(key); if (!failed.size) window.removeEventListener("beforeunload", warn);
  try { sessionStorage.removeItem(key); } catch { /* The in-memory draft is already cleared. */ }
}
