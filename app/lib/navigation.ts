import type { BootstrapData, TaskPriority } from "./types";

export const views = ["board", "backlog", "daily", "review", "retro", "reports", "summary", "team", "settings"] as const;
export type AppView = typeof views[number];
export type NavigationState = {
  workspace?: string;
  view: AppView;
  sprint?: string;
  task?: string;
  day?: string;
  search: string;
  priority: "all" | TaskPriority;
  assignee: string;
};
export const defaultNavigation: NavigationState = { view: "board", search: "", priority: "all", assignee: "all" };
export type NavigationProblem = "invalid" | "workspace" | "sprint" | "task" | "session" | "network";
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Resource identifiers are strict; cosmetic filters are normalized. Never infer another project. */
export function parseNavigation(params: URLSearchParams): { route: NavigationState; problem?: NavigationProblem } {
  const route = { ...defaultNavigation };
  for (const key of ["workspace", "sprint", "task"] as const) {
    const values = params.getAll(key);
    if (values.length > 1 || (values.length === 1 && !validId(values[0]))) return { route, problem: "invalid" };
    if (values.length) route[key] = values[0];
  }
  if ((route.sprint || route.task) && !route.workspace) return { route, problem: "invalid" };
  const view = params.get("view");
  if (views.includes(view as AppView)) route.view = view as AppView;
  const day = params.get("day");
  if (params.getAll("day").length === 1 && day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day) route.day = day;
  route.search = (params.get("q") ?? "").slice(0, 200);
  const priority = params.get("priority");
  if (["low", "medium", "high", "urgent"].includes(priority ?? "")) route.priority = priority as TaskPriority;
  const assignee = params.get("assignee");
  if (assignee && validId(assignee)) route.assignee = assignee;
  return { route };
}

export function navigationUrl(route: NavigationState): string {
  const params = new URLSearchParams();
  if (route.workspace) params.set("workspace", route.workspace);
  params.set("view", route.view);
  if (route.sprint) params.set("sprint", route.sprint);
  if (route.task) params.set("task", route.task);
  if (route.day) params.set("day", route.day);
  if (route.search) params.set("q", route.search);
  if (route.priority !== "all") params.set("priority", route.priority);
  if (route.assignee !== "all") params.set("assignee", route.assignee);
  return `/?${params}`;
}

export function resolveNavigation(route: NavigationState, data: BootstrapData): { route: NavigationState; problem?: NavigationProblem } {
  if (route.workspace && route.workspace !== data.workspace.id) return { route, problem: "workspace" };
  const task = route.task ? data.tasks.find((item) => item.id === route.task && item.workspaceId === data.workspace.id) : undefined;
  if (route.task && !task) return { route, problem: "task" };
  if (route.sprint && !data.sprints.some((item) => item.id === route.sprint && item.workspaceId === data.workspace.id)) return { route, problem: "sprint" };
  const sprint = route.sprint ?? task?.sprintId ?? data.sprints.find((item) => item.status === "active")?.id ?? data.sprints[0]?.id;
  return { route: {
    ...route, workspace: data.workspace.id, sprint,
    view: task && !task.sprintId && !route.sprint && route.view === "board" ? "backlog" : route.view,
    assignee: ["all", "none"].includes(route.assignee) || data.members.some((item) => item.id === route.assignee) ? route.assignee : "all",
  } };
}

/** Only local, allowlisted context survives OAuth. No caller-controlled redirect origin/path. */
export function signInDestination(value: string): string {
  if (typeof value !== "string" || !value.startsWith("/?") || value.includes("\\") || /[\r\n]/.test(value)) return "/";
  const params = new URL(value, "https://sprintia.invalid").searchParams;
  const join = params.get("join");
  if (join && /^[A-Z0-9]{8,20}$/i.test(join)) return `/?join=${join.toUpperCase()}`;
  const parsed = parseNavigation(params);
  // Keep invalid resource links for an explicit error after login, without retaining arbitrary input.
  return parsed.problem ? "/?workspace=" : navigationUrl(parsed.route);
}
