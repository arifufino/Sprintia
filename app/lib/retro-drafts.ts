// Reuse the bounded per-tab storage and memory fallback, with an isolated key.
export { readReviewDraft as readRetroDraft, writeReviewDraft as writeRetroDraft, clearReviewDraft as clearRetroDraft } from "./review-drafts";
export const retroDraftKey = (actor: string, workspace: string, sprint: string, scope: string) => `sprintia-retro-draft-v1:${[actor, workspace, sprint, scope].map(encodeURIComponent).join(":")}`;
