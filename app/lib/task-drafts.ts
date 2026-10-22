import type { ScrumTask } from "./types";
import { clearTextDraft, textDraftKey } from "./collaboration-drafts";
import { clearReviewDraft, reviewDraftKey } from "./review-drafts";
import { clearRetroDraft, retroDraftKey } from "./retro-drafts";

export const taskFields = ["title", "description", "acceptanceCriteria", "checklist", "status", "priority", "points", "assigneeId", "sprintId"] as const;
export type TaskValues = Pick<ScrumTask, typeof taskFields[number] | "revision">;
export const taskValues = (task: TaskValues): TaskValues => Object.fromEntries(["revision", ...taskFields].map((key) => [key, task[key as keyof TaskValues]])) as TaskValues;
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export type TaskDraft = { version: 1; form: TaskValues; baseline: TaskValues };
export type PendingChange = { payload: Record<string, unknown>; mutationId: string; message: string; options?: { switchTo?: string; draftKey?: string; textDraftKey?: string; reviewDraftKey?: string; retroDraftKey?: string }; workspaceId?: string };
const prefix = "sprintia-task-draft-v1:";
export const taskDraftKey = (actor: string, workspace: string, id: string) => `${prefix}${encodeURIComponent(actor)}:${encodeURIComponent(workspace)}:${encodeURIComponent(id || "new")}`;
const pendingKey = (actor: string) => `sprintia-task-pending-v1:${encodeURIComponent(actor)}`;
// Keep the existing storage key for compatibility; sprint intentions now share
// the same single-pending-change recovery path as task intentions.
const recoverableActions = ["createTask", "updateTask", "deleteTask", "createSprint", "updateSprint", "startSprint", "closeSprint", "cancelSprint", "changeImpediment", "addTaskComment", "saveDailyNote", "saveSprintReview", "addReviewEntry", "convertReviewDecision", "addRetroObservation", "selectRetroProblem", "createRetroAction", "updateRetroAction"];
const memoryDrafts = new Map<string, TaskDraft>();
const failedKeys = new Set<string>();
export const draftStorageFailed = (key: string) => failedKeys.has(key);
const warnUnsaved = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };

// Per-tab session storage survives reloads without sharing unfinished private work
// across users or letting a second tab overwrite the first tab's draft.
export function readDraft(key: string): TaskDraft | null {
  if (memoryDrafts.has(key)) return memoryDrafts.get(key)!;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 60_000) return null;
    const draft = JSON.parse(raw) as TaskDraft;
    const valid = (v: TaskValues) => v && Number.isSafeInteger(v.revision) && v.revision >= 0
      && typeof v.title === "string" && v.title.length <= 160 && typeof v.description === "string" && v.description.length <= 1200
      && Array.isArray(v.acceptanceCriteria) && v.acceptanceCriteria.length <= 20 && v.acceptanceCriteria.every((c) => typeof c === "string" && c.length <= 240)
      && Array.isArray(v.checklist) && v.checklist.length <= 30 && v.checklist.every((c) => c && typeof c.id === "string" && c.id.length <= 80 && typeof c.text === "string" && c.text.length <= 240 && typeof c.done === "boolean")
      && ["backlog", "todo", "progress", "review", "done"].includes(v.status) && ["low", "medium", "high", "urgent"].includes(v.priority)
      && (v.points === null || [1, 2, 3, 5, 8, 13].includes(v.points))
      && [v.assigneeId, v.sprintId].every((id) => id === null || typeof id === "string" && id.length <= 150);
    return draft.version === 1 && valid(draft.form) && valid(draft.baseline) ? draft : null;
  } catch { return null; }
}
export function writeDraft(key: string, draft: TaskDraft): boolean {
  memoryDrafts.set(key, draft);
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
    failedKeys.delete(key);
    if (!failedKeys.size) window.removeEventListener("beforeunload", warnUnsaved);
    return true;
  } catch { failedKeys.add(key); window.addEventListener("beforeunload", warnUnsaved); return false; }
}
export function clearDraft(key: string) {
  memoryDrafts.delete(key); failedKeys.delete(key);
  if (!failedKeys.size) window.removeEventListener("beforeunload", warnUnsaved);
  try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}
export function readPendingTask(actor: string): PendingChange | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(actor));
    if (!raw || raw.length > 40_000) return null;
    const intent = JSON.parse(raw) as PendingChange;
    if (!intent || !intent.payload || !recoverableActions.includes(String(intent.payload.action))
      || typeof intent.mutationId !== "string" || !/^[a-f0-9-]{36}$/i.test(intent.mutationId)
      || typeof intent.workspaceId !== "string" || intent.payload.workspaceId !== intent.workspaceId || typeof intent.message !== "string") return null;
    return intent;
  } catch { return null; }
}
export function persistPendingTask(actor: string, intent: PendingChange) {
  if (!recoverableActions.includes(String(intent.payload.action))) return;
  try { sessionStorage.setItem(pendingKey(actor), JSON.stringify(intent)); } catch { /* beforeunload still protects the in-memory intent. */ }
}
export function settlePendingTask(actor: string, intent: PendingChange, saved: boolean) {
  if (!recoverableActions.includes(String(intent.payload.action))) return;
  try { sessionStorage.removeItem(pendingKey(actor)); } catch { /* Preserve in-memory state. */ }
  const expectedKey = intent.workspaceId ? taskDraftKey(actor, intent.workspaceId, String(intent.payload.id ?? "")) : null;
  // Moving a card or adding it to a sprint must NOT delete an unrelated editor draft.
  if (saved && expectedKey && intent.options?.draftKey === expectedKey) clearDraft(expectedKey);
  if (saved && intent.workspaceId) {
    const retroScope = intent.payload.action === "addRetroObservation" ? "observation" : intent.payload.action === "createRetroAction" ? `problem:${intent.payload.observationId}` : intent.payload.action === "updateRetroAction" ? `action:${intent.payload.id}` : null;
    const retroKey = retroScope ? retroDraftKey(actor, intent.workspaceId, String(intent.payload.sprintId), retroScope) : null;
    if (retroKey && intent.options?.retroDraftKey === retroKey) clearRetroDraft(retroKey);
    const reviewScope = intent.payload.action === "saveSprintReview" ? "increment" : intent.payload.action === "addReviewEntry" ? "entry" : intent.payload.action === "convertReviewDecision" ? `decision:${intent.payload.entryId}` : null;
    const reviewKey = reviewScope ? reviewDraftKey(actor, intent.workspaceId, String(intent.payload.sprintId), reviewScope) : null;
    if (reviewKey && intent.options?.reviewDraftKey === reviewKey) clearReviewDraft(reviewKey);
    const kind = intent.payload.action === "addTaskComment" ? "comment" : intent.payload.action === "saveDailyNote" ? "daily" : null;
    const scope = kind === "daily" ? `${intent.payload.sprintId}:${intent.payload.date}` : String(intent.payload.id ?? "");
    const key = kind ? textDraftKey(kind, actor, intent.workspaceId, scope) : null;
    if (key && intent.options?.textDraftKey === key) clearTextDraft(key);
  }
}
