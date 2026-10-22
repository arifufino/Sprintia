export type AppUser = {
  id: string;
  email: string;
  name: string;
};

export type MemberRole = "owner" | "admin" | "member";
export type ScrumRole = "productOwner" | "scrumMaster" | "developer";

export type ScrumConfiguration = {
  productGoal: string;
  definitionOfDone: string[];
  productOwnerId: string | null;
  scrumMasterId: string | null;
  developerIds: string[];
  governanceRevision: number;
};

export type Workspace = ScrumConfiguration & {
  retroRevision: number;
  backlogRevision: number;
  id: string;
  name: string;
  // Never disclose invitation credentials to ordinary members or after revocation.
  inviteCode: string | null;
  inviteEnabled: boolean;
  invitationRevision: number;
  role: MemberRole;
};

export type Sprint = {
  reviewRevision: number;
  dailyRevision: number;
  revision: number;
  availability: string;
  capacityHours: number | null;
  startedAt: string | null;
  id: string;
  workspaceId: string;
  name: string;
  goal: string;
  status: "active" | "planned" | "completed" | "cancelled";
  startDate: string;
  endDate: string;
  outcome: SprintOutcome | null;
};

export type SprintOutcomeTask = Pick<ScrumTask, "id" | "revision" | "code" | "title" | "description" | "acceptanceCriteria" | "checklist" | "status" | "priority" | "points" | "assigneeId" | "assigneeName" | "sortOrder"> & { returnedToBacklog: boolean; impediment?: TaskImpediment | null };
export type SprintOutcome = {
  kind: "completed" | "cancelled";
  endedAt: string;
  actorId: string;
  actorName: string;
  summary: string;
  reason: string;
  plan: Pick<Sprint, "name" | "goal" | "startDate" | "endDate" | "startedAt" | "availability" | "capacityHours">;
  productGoal: string;
  definitionOfDone: string[];
  tasks: SprintOutcomeTask[];
};

export type TaskStatus = "backlog" | "todo" | "progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ChecklistItem = { id: string; text: string; done: boolean };
export type TaskImpediment = { id: string; reason: string; ownerId: string; ownerName: string; createdAt: string; createdById: string; createdByName: string; updatedAt: string };
export type TaskUpdate = { id: string; taskId: string; kind: "comment" | "impediment.reported" | "impediment.updated" | "impediment.resolved"; text: string; actorId: string; actorName: string; createdAt: string; before: TaskImpediment | null; after: TaskImpediment | null };
export type DiscussionPage = { entries: TaskUpdate[]; nextCursor: string | null };
export type DailyNote = { text: string; revision: number; updatedAt: string | null; updatedByName: string | null };

export type ReviewEvidence = { label: string; url: string };
export type ReviewTask = Pick<ScrumTask, "id" | "revision" | "code" | "title" | "description" | "acceptanceCriteria" | "checklist" | "points">;
export type ReviewIncrement = { summary: string; evidence: ReviewEvidence[]; tasks: ReviewTask[]; definitionOfDone: string[]; productGoal: string; sprintGoal: string; recordedAt: string; actorId: string; actorName: string; sourceStatus: "active" | "completed" };
export type ReviewEntry = { id: string; kind: "feedback" | "decision"; text: string; actorId: string; actorName: string; createdAt: string; backlogTask: { id: string; code: string; title: string } | null };
export type SprintReview = { revision: number; increment: ReviewIncrement | null; entries: ReviewEntry[]; nextCursor: string | null };
export type ReviewSource = { sprintId: string; sprintName: string; entryId: string };

export type RetroObservation = { id: string; revision: number; kind: "keep" | "problem" | "idea"; text: string; selected: boolean; actionId: string | null; actorId: string; actorName: string; createdAt: string };
export type RetroActionState = { title: string; measure: string; ownerId: string; ownerName: string; targetSprintId: string | null; targetSprintName: string | null; status: "open" | "progress" | "done" | "dropped" };
export type RetroAction = RetroActionState & { id: string; revision: number; sprintId: string; sprintName: string; observationId: string; observation: string; createdAt: string; createdById: string; createdByName: string; updatedAt: string; updatedByName: string; note: string };
export type RetroUpdate = { id: string; revision: number; actorId: string; actorName: string; createdAt: string; note: string; state: RetroActionState };
export type SprintRetro = { observations: RetroObservation[]; actions: RetroAction[]; nextCursor: string | null; counts: Record<RetroActionState["status"], number> };
export type RetroActionDetail = { action: RetroAction; updates: RetroUpdate[]; nextCursor: string | null };

export type ScrumTask = {
  reviewSource?: ReviewSource | null;
  impediment: TaskImpediment | null;
  discussionRevision: number;
  revision: number;
  id: string;
  workspaceId: string;
  sprintId: string | null;
  code: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  checklist: ChecklistItem[];
  status: TaskStatus;
  priority: TaskPriority;
  points: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  reporterId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Member = {
  accessRevision: number;
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  role: MemberRole;
  scrumRoles: ScrumRole[];
  joinedAt: string;
};

export type Activity = {
  id: string;
  userId: string;
  userName: string;
  avatarColor: string;
  message: string;
  createdAt: string;
  event?: {
    type: string;
    entityId: string;
    entityRevision: number;
    operationId: string;
    changes: Record<string, { before: unknown; after: unknown }>;
  };
};

export type BootstrapData = {
  user: AppUser;
  workspace: Workspace;
  workspaces: Workspace[];
  sprints: Sprint[];
  tasks: ScrumTask[];
  members: Member[];
  activities: Activity[];
};
