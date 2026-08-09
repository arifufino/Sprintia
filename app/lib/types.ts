export type AppUser = {
  id: string;
  email: string;
  name: string;
};

export type Workspace = {
  id: string;
  name: string;
  inviteCode: string;
  role: "owner" | "member";
};

export type Sprint = {
  id: string;
  workspaceId: string;
  name: string;
  goal: string;
  status: "active" | "planned" | "completed";
  startDate: string;
  endDate: string;
};

export type TaskStatus = "backlog" | "todo" | "progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type ScrumTask = {
  id: string;
  workspaceId: string;
  sprintId: string | null;
  code: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  points: number;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  reporterId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Member = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  role: "owner" | "member";
  joinedAt: string;
};

export type Activity = {
  id: string;
  userId: string;
  userName: string;
  avatarColor: string;
  message: string;
  createdAt: string;
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
