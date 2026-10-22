import type { ClientSession, Collection, Db } from "mongodb";
import { revisionFilter, type MutationContext } from "./mutation-context";
import { appDatabase } from "../lib/mongodb";
import { UserFacingError } from "../lib/errors";
import { canManageAccess, canManageProject } from "../app/lib/permissions";
import { governanceDefaults, migrateScrumGovernance } from "./migrations/005-scrum-governance";
import { taskMetric, type ReportEvent } from "../app/lib/reports";
import { reportEvent } from "./report-events";
import type {
  Activity,
  ChecklistItem,
  DailyNote,
  DiscussionPage,
  TaskImpediment,
  TaskUpdate,
  AppUser,
  BootstrapData,
  Member,
  MemberRole,
  ScrumRole,
  ScrumTask,
  Sprint,
  SprintOutcome,
  TaskPriority,
  TaskStatus,
  Workspace,
  ReviewSource,
} from "../app/lib/types";

type SprintStatus = Sprint["status"];

type ProfileDocument = {
  _id: string;
  authUserId: string;
  email: string;
  name: string;
  avatarColor: string;
  createdAt: string;
};

type WorkspaceDocument = Partial<ReturnType<typeof governanceDefaults>> & {
  retroRevision?: number;
  backlogRevision?: number;
  sprintLifecycleRevision?: number;
  _id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  createdAt: string;
  inviteAcceptances?: number;
};

type MembershipDocument = {
  revision?: number;
  _id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
};

type SprintDocument = {
  reviewRevision?: number;
  dailyRevision?: number;
  discussionRevision?: number;
  outcome?: SprintOutcome;
  revision?: number;
  availability?: string;
  capacityHours?: number | null;
  startedAt?: string;
  _id: string;
  workspaceId: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string;
  endDate: string;
  createdAt: string;
};

type TaskDocument = {
  reviewSource?: ReviewSource | null;
  impediment?: TaskImpediment | null;
  discussionRevision?: number;
  revision?: number;
  _id: string;
  workspaceId: string;
  sprintId: string | null;
  code: string;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  checklist?: ChecklistItem[];
  status: TaskStatus;
  priority: TaskPriority;
  points: number | null;
  assigneeId: string | null;
  reporterId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type ActivityDocument = {
  actorName?: string;
  event?: Activity["event"];
  _id: string;
  workspaceId: string;
  userId: string;
  message: string;
  createdAt: string;
};

type CounterDocument = {
  _id: string;
  value: number;
};

type TaskUpdateDocument = Omit<TaskUpdate, "id"> & { _id: string; workspaceId: string };
type DailyNoteDocument = Omit<DailyNote, "updatedAt" | "updatedByName"> & { _id: string; workspaceId: string; sprintId: string; date: string; updatedAt: string; updatedById: string; updatedByName: string };

type Collections = {
  profiles: Collection<ProfileDocument>;
  workspaces: Collection<WorkspaceDocument>;
  memberships: Collection<MembershipDocument>;
  sprints: Collection<SprintDocument>;
  tasks: Collection<TaskDocument>;
  activities: Collection<ActivityDocument>;
  counters: Collection<CounterDocument>;
  taskUpdates: Collection<TaskUpdateDocument>;
  dailyNotes: Collection<DailyNoteDocument>;
};

let indexesPromise: Promise<void> | null = null;

function collections(db: Db): Collections {
  return {
    profiles: db.collection<ProfileDocument>("profiles"),
    workspaces: db.collection<WorkspaceDocument>("workspaces"),
    memberships: db.collection<MembershipDocument>("memberships"),
    sprints: db.collection<SprintDocument>("sprints"),
    tasks: db.collection<TaskDocument>("tasks"),
    activities: db.collection<ActivityDocument>("activities"),
    counters: db.collection<CounterDocument>("counters"),
    taskUpdates: db.collection<TaskUpdateDocument>("task_updates"),
    dailyNotes: db.collection<DailyNoteDocument>("daily_notes"),
  };
}

export async function database() {
  const db = await appDatabase();
  if (!indexesPromise) {
    const store = collections(db);
    indexesPromise = Promise.all([
      store.profiles.createIndex({ authUserId: 1 }, { unique: true }),
      store.workspaces.createIndex({ inviteCode: 1 }, { unique: true }),
      store.memberships.createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
      store.memberships.createIndex({ userId: 1, joinedAt: 1 }),
      store.sprints.createIndex({ workspaceId: 1, startDate: -1 }),
      store.tasks.createIndex({ workspaceId: 1, code: 1 }, { unique: true }),
      store.tasks.createIndex({ workspaceId: 1, sprintId: 1, status: 1, sortOrder: 1 }),
      store.tasks.createIndex({ workspaceId: 1, assigneeId: 1 }),
      store.activities.createIndex({ workspaceId: 1, createdAt: -1 }),
      store.activities.createIndex({ workspaceId: 1, "event.changes.reporting.after.sprintIds": 1, "event.changes.reporting.after.sequence": 1 }),
      store.activities.createIndex({ "event.operationId": 1 }, { unique: true, partialFilterExpression: { "event.operationId": { $type: "string" } } }),
      db.collection("mutation_receipts").createIndex({ actorId: 1, createdAt: -1 }),
      store.taskUpdates.createIndex({ workspaceId: 1, taskId: 1, createdAt: -1, _id: -1 }),
      store.dailyNotes.createIndex({ workspaceId: 1, sprintId: 1, date: 1 }, { unique: true }),
      db.collection("sprint_reviews").createIndex({ workspaceId: 1, sprintId: 1 }, { unique: true }),
      db.collection("review_revisions").createIndex({ workspaceId: 1, sprintId: 1, revision: 1 }, { unique: true }),
      db.collection("review_entries").createIndex({ workspaceId: 1, sprintId: 1, createdAt: -1, _id: -1 }),
      db.collection("retro_observations").createIndex({ workspaceId: 1, sprintId: 1, createdAt: 1, _id: 1 }),
      db.collection("retro_actions").createIndex({ workspaceId: 1, observationId: 1 }, { unique: true }),
      db.collection("retro_actions").createIndex({ workspaceId: 1, status: 1, createdAt: -1, _id: -1 }),
      db.collection("retro_actions").createIndex({ workspaceId: 1, sprintId: 1, createdAt: -1, _id: -1 }),
      db.collection("retro_updates").createIndex({ workspaceId: 1, actionId: 1, revision: -1 }, { unique: true }),
    ])
      .then(() => undefined)
      .catch((error) => {
        indexesPromise = null;
        throw error;
      });
  }
  await indexesPromise;
  return db;
}

const colors = ["#6757d9", "#ea6d4d", "#2f9c88", "#d18a22", "#3b82c4", "#a8558c"];

function avatarColor(userId: string) {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function inviteCode() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
}

function isoDay(offset = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new UserFacingError("Usa una fecha válida con formato AAAA-MM-DD.");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new UserFacingError("Usa una fecha válida con formato AAAA-MM-DD.");
  }
  return date;
}

function membershipId(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}`;
}

export async function upsertUser(user: AppUser, session?: ClientSession) {
  const store = collections(await database());
  const now = new Date().toISOString();
  await store.profiles.updateOne(
    { _id: user.id },
    {
      $set: { authUserId: user.id, email: user.email, name: user.name },
      $setOnInsert: { avatarColor: avatarColor(user.id), createdAt: now },
    },
    { upsert: true, session },
  );
}

async function membershipsFor(userId: string): Promise<Workspace[]> {
  const store = collections(await database());
  const membershipRows = await store.memberships.find({ userId }).sort({ joinedAt: 1 }).toArray();
  if (membershipRows.length === 0) return [];

  const workspaceRows = await store.workspaces
    .find({ _id: { $in: membershipRows.map((item) => item.workspaceId) } })
    .toArray();
  const workspaceMap = new Map(workspaceRows.map((item) => [item._id, item]));

  return membershipRows.flatMap((membership) => {
    const workspace = workspaceMap.get(membership.workspaceId);
    if (!workspace) return [];
    const settings = { ...governanceDefaults(), ...workspace };
    return [{
      id: workspace._id, name: workspace.name, role: membership.role,
      backlogRevision: workspace.backlogRevision ?? 0,
      retroRevision: workspace.retroRevision ?? 0,
      inviteCode: canManageProject(membership.role) && settings.inviteEnabled ? workspace.inviteCode : null,
      inviteEnabled: settings.inviteEnabled, invitationRevision: settings.invitationRevision,
      productGoal: settings.productGoal, definitionOfDone: settings.definitionOfDone,
      productOwnerId: settings.productOwnerId, scrumMasterId: settings.scrumMasterId,
      developerIds: settings.developerIds, governanceRevision: settings.governanceRevision,
    }];
  });
}

async function createStarterWorkspace(user: AppUser) {
  const store = collections(await database());
  const workspaceId = `ws_starter_${user.id}`;
  const sprintId = `sp_starter_${user.id}`;
  const now = new Date().toISOString();
  const taskSeeds: Array<[string, string, TaskStatus, TaskPriority, number]> = [
    ["Definir alcance del proyecto", "Acordar entregables y criterios de éxito con el equipo.", "done", "high", 3],
    ["Preparar historias de usuario", "Convertir los requisitos principales en historias claras.", "done", "medium", 5],
    ["Diseñar prototipo de interfaz", "Crear el flujo principal y validarlo con dos compañeros.", "review", "high", 5],
    ["Configurar repositorio del equipo", "Definir ramas, convenciones y revisión de cambios.", "progress", "medium", 3],
    ["Implementar inicio de sesión", "Permitir acceso seguro a los integrantes del proyecto.", "progress", "urgent", 8],
    ["Crear presentación del avance", "Resumir problema, solución y progreso del sprint.", "todo", "medium", 3],
    ["Revisar bibliografía", "Organizar fuentes y referencias del informe final.", "todo", "low", 2],
    ["Planear pruebas con usuarios", "Definir tareas, preguntas y métricas de la prueba.", "backlog", "medium", 5],
  ];

  await store.workspaces.updateOne(
    { _id: workspaceId },
    { $setOnInsert: { ...governanceDefaults(), name: "Proyecto de Universidad", inviteCode: inviteCode(), createdBy: user.id, createdAt: now } },
    { upsert: true },
  );
  await store.memberships.updateOne(
    { _id: membershipId(workspaceId, user.id) },
    { $setOnInsert: { workspaceId, userId: user.id, role: "owner", joinedAt: now } },
    { upsert: true },
  );
  await store.sprints.updateOne(
    { _id: sprintId },
    {
      $setOnInsert: {
        workspaceId,
        name: "Sprint 1",
        goal: "Validar la idea y entregar una primera versión funcional",
        status: "planned",
        startDate: isoDay(),
        endDate: isoDay(10),
        createdAt: now,
      },
    },
    { upsert: true },
  );

  await store.tasks.bulkWrite(
    taskSeeds.map(([title, description, status, priority, points], index) => ({
      updateOne: {
        filter: { _id: `task_starter_${user.id}_${index + 1}` },
        update: {
          $setOnInsert: {
            workspaceId,
            sprintId: status === "backlog" ? null : sprintId,
            code: `UNI-${String(index + 1).padStart(2, "0")}`,
            title,
            description,
            status: status === "backlog" ? "backlog" : "todo",
            priority,
            points,
            assigneeId: status === "backlog" ? null : user.id,
            reporterId: user.id,
            sortOrder: index,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    })),
  );
  await store.counters.updateOne(
    { _id: `task-code:${workspaceId}` },
    { $max: { value: taskSeeds.length } },
    { upsert: true },
  );
  await store.activities.updateOne(
    { _id: `act_starter_${user.id}` },
    { $setOnInsert: { workspaceId, userId: user.id, message: "creó el espacio de trabajo", createdAt: now } },
    { upsert: true },
  );

  return workspaceId;
}

export async function isMember(workspaceId: string, userId: string, session?: ClientSession) {
  const store = collections(await database());
  const row = await store.memberships.findOne(
    { workspaceId, userId },
    { projection: { role: 1 }, session },
  );
  return row?.role ?? null;
}

export class WorkspaceUnavailableError extends Error {}

export async function getBootstrap(user: AppUser, requestedWorkspace?: string | null): Promise<BootstrapData> {
  await upsertUser(user);
  let workspaces = await membershipsFor(user.id);

  if (requestedWorkspace !== undefined && requestedWorkspace !== null && !workspaces.some((item) => item.id === requestedWorkspace)) {
    // Absent and unauthorized projects have the same result: never disclose existence or fall back.
    throw new WorkspaceUnavailableError();
  }

  if (workspaces.length === 0) {
    await createStarterWorkspace(user);
    workspaces = await membershipsFor(user.id);
  }

  let workspace = workspaces.find((item) => item.id === requestedWorkspace) ?? workspaces[0];
  await migrateScrumGovernance(await database(), workspace.id);
  workspaces = await membershipsFor(user.id);
  const refreshedWorkspace = workspaces.find((item) => item.id === workspace.id);
  if (!refreshedWorkspace) throw new WorkspaceUnavailableError();
  workspace = refreshedWorkspace;
  const store = collections(await database());
  const [sprintRows, taskRows, membershipRows, activityRows] = await Promise.all([
    store.sprints.find({ workspaceId: workspace.id }).sort({ startDate: -1 }).toArray(),
    store.tasks.find({ workspaceId: workspace.id }).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).toArray(),
    store.memberships.find({ workspaceId: workspace.id }).sort({ joinedAt: 1 }).toArray(),
    // Start baselines belong to report reads, not the small recent-activity feed.
    store.activities.find({ workspaceId: workspace.id }, { projection: { "event.changes.reporting": 0 } }).sort({ createdAt: -1 }).limit(12).toArray(),
  ]);

  const profileIds = Array.from(
    new Set([
      ...membershipRows.map((item) => item.userId),
      ...taskRows.flatMap((item) => (item.assigneeId ? [item.assigneeId] : [])),
      ...activityRows.map((item) => item.userId),
    ]),
  );
  const profileRows = await store.profiles.find({ _id: { $in: profileIds } }).toArray();
  const profileMap = new Map(profileRows.map((item) => [item._id, item]));

  const sprints: Sprint[] = sprintRows.map((item) => ({
    reviewRevision: item.reviewRevision ?? 0,
    dailyRevision: item.dailyRevision ?? 0,
    revision: item.revision ?? 0,
    availability: item.availability ?? "",
    capacityHours: item.capacityHours ?? null,
    startedAt: item.startedAt ?? null,
    outcome: item.outcome ?? null,
    id: item._id,
    workspaceId: item.workspaceId,
    name: item.name,
    goal: item.goal,
    status: item.status,
    startDate: item.startDate,
    endDate: item.endDate,
  }));
  const tasks: ScrumTask[] = taskRows.map((item) => {
    const assignee = item.assigneeId ? profileMap.get(item.assigneeId) : undefined;
    return {
      reviewSource: item.reviewSource ?? null,
      impediment: item.impediment ?? null,
      discussionRevision: item.discussionRevision ?? 0,
      revision: item.revision ?? 0,
      id: item._id,
      workspaceId: item.workspaceId,
      sprintId: item.sprintId,
      code: item.code,
      title: item.title,
      description: item.description,
      acceptanceCriteria: item.acceptanceCriteria ?? [],
      checklist: item.checklist ?? [],
      status: item.status,
      priority: item.priority,
      points: item.points ?? null,
      assigneeId: item.assigneeId,
      assigneeName: assignee?.name ?? null,
      assigneeColor: assignee?.avatarColor ?? null,
      reporterId: item.reporterId,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
  const members: Member[] = membershipRows.flatMap((item) => {
    const profile = profileMap.get(item.userId);
    return profile
      ? [{
          id: profile._id,
          email: profile.email,
          name: profile.name,
          avatarColor: profile.avatarColor,
          role: item.role,
          accessRevision: item.revision ?? 0,
          scrumRoles: ([
            ...(workspace.productOwnerId === item.userId ? ["productOwner"] : []),
            ...(workspace.scrumMasterId === item.userId ? ["scrumMaster"] : []),
            ...(workspace.developerIds.includes(item.userId) ? ["developer"] : []),
          ] as ScrumRole[]),
          joinedAt: item.joinedAt,
        }]
      : [];
  });
  const activities: Activity[] = activityRows.flatMap((item) => {
    const profile = profileMap.get(item.userId);
    return profile || item.actorName
      ? [{
          id: item._id,
          userId: item.userId,
          userName: item.actorName ?? profile?.name ?? "Integrante",
          avatarColor: profile?.avatarColor ?? "#596574",
          message: item.message,
          createdAt: item.createdAt,
          ...(item.event ? { event: item.event } : {}),
        }]
      : [];
  });

  return { user, workspace, workspaces, sprints, tasks, members, activities };
}

async function addActivity(context: MutationContext, user: AppUser, workspaceId: string, message: string,
  type: string, entityId: string, entityRevision: number, before: Record<string, unknown>, after: Record<string, unknown>, reporting?: ReportEvent) {
  const store = collections(await database());
  const changes: NonNullable<Activity["event"]>["changes"] = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key] ?? null, after: after[key] ?? null };
  }
  if (reporting) changes.reporting = { before: null, after: reporting };
  await store.activities.insertOne({
    _id: newId("act"),
    workspaceId,
    userId: user.id,
    actorName: user.name,
    message,
    createdAt: new Date().toISOString(),
    event: { type, entityId, entityRevision, operationId: context.operationId, changes },
  }, { session: context.session });
}

async function nextTaskCode(workspaceId: string, session: ClientSession) {
  const store = collections(await database());
  const counterId = `task-code:${workspaceId}`;
  const existingCounter = await store.counters.findOne({ _id: counterId }, { session });

  if (!existingCounter) {
    const [maximum] = await store.tasks
      .aggregate<{ maximum: number }>([
        { $match: { workspaceId, code: { $regex: /^UNI-[0-9]+$/ } } },
        { $project: { number: { $toInt: { $substrBytes: ["$code", 4, 12] } } } },
        { $group: { _id: null, maximum: { $max: "$number" } } },
      ], { session })
      .toArray();
    await store.counters.updateOne(
      { _id: counterId },
      { $max: { value: maximum?.maximum ?? 0 } },
      { upsert: true, session },
    );
  }

  const counter = await store.counters.findOneAndUpdate(
    { _id: counterId },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after", session },
  );
  if (!counter) throw new Error("No pudimos asignar un código a la tarea.");
  return `UNI-${String(counter.value).padStart(2, "0")}`;
}

const validStatuses: TaskStatus[] = ["backlog", "todo", "progress", "review", "done"];
const validPriorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
const validPoints = [1, 2, 3, 5, 8, 13];

function taskPoints(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !validPoints.includes(value)) throw new UserFacingError("La estimación no es válida.");
  return value;
}

function taskCriteria(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new UserFacingError("Usa hasta 20 criterios de aceptación.");
  return value.map((item) => {
    const text = strictText(item, 240, "Criterio de aceptación");
    if (!text) throw new UserFacingError("Los criterios no pueden estar vacíos.");
    return text;
  });
}

function taskChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value) || value.length > 30) throw new UserFacingError("Usa hasta 30 pasos en el checklist.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)
      || ids.has(item.id) || typeof item.done !== "boolean") throw new UserFacingError("El checklist no es válido.");
    ids.add(item.id);
    const text = strictText(item.text, 240, "Paso del checklist");
    if (!text) throw new UserFacingError("Los pasos no pueden estar vacíos.");
    return { id: item.id, text, done: item.done };
  });
}

const inBacklog = (task: Pick<TaskDocument, "sprintId" | "status">) => !task.sprintId || task.status === "backlog";
async function touchBacklog(workspaceId: string, session: ClientSession) {
  // Serializes reorder vs. creation, removal and transfers: no phantom list entries.
  await collections(await database()).workspaces.updateOne({ _id: workspaceId }, { $inc: { backlogRevision: 1 } }, { session });
}
async function lastTaskOrder(workspaceId: string, session: ClientSession) {
  const last = await collections(await database()).tasks.findOne({ workspaceId }, { sort: { sortOrder: -1 }, session });
  return (last?.sortOrder ?? -1) + 1;
}

export async function reorderBacklog(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const expected = revision(payload.backlogRevision);
  const store = collections(await database());
  const workspace = await store.workspaces.findOne({ _id: workspaceId }, { session });
  if ((workspace?.backlogRevision ?? 0) !== expected) throw new UserFacingError("El orden del backlog cambió. Revisa la lista actual antes de reordenar.", 409);
  const rows = await store.tasks.find({ workspaceId, $or: [{ sprintId: null }, { status: "backlog" }] }, { session }).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).toArray();
  const ids = rows.map((item) => item._id);
  const id = typeof payload.id === "string" ? payload.id : "";
  const beforeId = payload.beforeId;
  if (!ids.includes(id) || (beforeId !== null && (typeof beforeId !== "string" || !ids.includes(beforeId))) || beforeId === id) {
    throw new UserFacingError("Selecciona tareas del backlog de este proyecto.");
  }
  const ordered = ids.filter((item) => item !== id);
  ordered.splice(beforeId === null ? ordered.length : ordered.indexOf(beforeId as string), 0, id);
  if (JSON.stringify(ids) === JSON.stringify(ordered)) return;
  await touchBacklog(workspaceId, session);
  // Order has its own workspace revision, independent from editable task content.
  await store.tasks.bulkWrite(ordered.map((taskId, sortOrder) => ({ updateOne: { filter: { _id: taskId, workspaceId }, update: { $set: { sortOrder } } } })), { session });
  await addActivity(context, user, workspaceId, "reordenó el backlog del producto", "backlog.reordered", workspaceId, expected + 1, { order: ids }, { order: ordered });
}

async function validateAssignee(workspaceId: string, assigneeId: string | null, session: ClientSession) {
  if (!assigneeId) return null;
  if (!(await isMember(workspaceId, assigneeId, session))) {
    throw new UserFacingError("El responsable debe pertenecer al equipo.");
  }
  return assigneeId;
}

export async function createTask(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.");

  const title = cleanText(payload.title, 160);
  if (!title) throw new UserFacingError("Escribe un título para la tarea.");
  let status = validStatuses.includes(payload.status as TaskStatus) ? (payload.status as TaskStatus) : "todo";
  const priority = validPriorities.includes(payload.priority as TaskPriority)
    ? (payload.priority as TaskPriority)
    : "medium";
  const points = taskPoints(payload.points);
  const assigneeId = await validateAssignee(workspaceId, cleanText(payload.assigneeId, 100) || null, session);
  const store = collections(await database());
  let sprintId = cleanText(payload.sprintId, 150) || null;
  if (status === "backlog") sprintId = null;
  else if (!sprintId) status = "backlog";
  if (sprintId) await assertWritableSprint(workspaceId, sprintId, session);

  const code = await nextTaskCode(workspaceId, session);
  const now = new Date().toISOString();
  const task = {
    _id: newId("task"), revision: 0,
    workspaceId,
    sprintId,
    code,
    title,
    description: payload.description === undefined ? "" : strictText(payload.description, 1200, "Descripción"),
    acceptanceCriteria: taskCriteria(payload.acceptanceCriteria ?? []),
    checklist: taskChecklist(payload.checklist ?? []),
    status,
    priority,
    points,
    assigneeId,
    reporterId: user.id,
    sortOrder: await lastTaskOrder(workspaceId, session),
    createdAt: now,
    updatedAt: now,
  };
  if (inBacklog(task)) await touchBacklog(workspaceId, session);
  if (sprintId) await touchSprintScope(workspaceId, [sprintId], session);
  await store.tasks.insertOne(task, { session });
  await addActivity(context, user, workspaceId, `creó ${code}: ${title}`, "task.created", task._id, 0, {}, taskSnapshot(task), await reportEvent(await database(), workspaceId, context, { kind: "task", sprintIds: sprintId ? [sprintId] : [], metricBefore: null, metricAfter: taskMetric(task) }));
  return task._id;
}

function taskSnapshot(task: TaskDocument) {
  return { code: task.code, title: task.title, description: task.description, status: task.status, priority: task.priority,
    acceptanceCriteria: task.acceptanceCriteria ?? [], checklist: task.checklist ?? [],
    points: task.points ?? null, assigneeId: task.assigneeId, sprintId: task.sprintId, sortOrder: task.sortOrder, impediment: task.impediment ?? null };
}

export async function updateTask(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.");
  const id = cleanText(payload.id, 150);
  const store = collections(await database());
  const current = await store.tasks.findOne({ _id: id, workspaceId }, { session });
  if (!current) throw new UserFacingError("No encontramos esa tarea.");
  if (current.sprintId) await assertWritableSprint(workspaceId, current.sprintId, session);

  const expected = revision(payload.revision);
  if ((current.revision ?? 0) !== expected) throw new UserFacingError("La tarea cambió en otra sesión. Tu borrador se conserva; revisa la versión actual antes de guardar.", 409);
  const patch: Partial<TaskDocument> = {};
  if (payload.title !== undefined) {
    patch.title = strictText(payload.title, 160, "Título");
    if (!patch.title) throw new UserFacingError("La tarea necesita un título.");
  }
  if (payload.description !== undefined) patch.description = strictText(payload.description, 1200, "Descripción");
  if (payload.acceptanceCriteria !== undefined) patch.acceptanceCriteria = taskCriteria(payload.acceptanceCriteria);
  if (payload.checklist !== undefined) patch.checklist = taskChecklist(payload.checklist);
  if (payload.status !== undefined) {
    if (!validStatuses.includes(payload.status as TaskStatus)) throw new UserFacingError("El estado no es válido.");
    patch.status = payload.status as TaskStatus;
  }
  if (payload.priority !== undefined) {
    if (!validPriorities.includes(payload.priority as TaskPriority)) throw new UserFacingError("La prioridad no es válida.");
    patch.priority = payload.priority as TaskPriority;
  }
  if (payload.points !== undefined) {
    patch.points = taskPoints(payload.points);
  }
  if (payload.assigneeId !== undefined) patch.assigneeId = await validateAssignee(workspaceId, cleanText(payload.assigneeId, 100) || null, session);
  if (payload.sprintId !== undefined) patch.sprintId = cleanText(payload.sprintId, 150) || null;
  // Status and sprint form one invariant. Unrelated fields are never written back.
  if (payload.status !== undefined || payload.sprintId !== undefined) {
    const status = patch.status ?? current.status;
    const sprintId = patch.sprintId === undefined ? current.sprintId : patch.sprintId;
    if (status === "backlog") patch.sprintId = null;
    else if (!sprintId) patch.status = "backlog";
  }
  if (patch.sprintId) await assertWritableSprint(workspaceId, patch.sprintId, session);
  if ((patch.status ?? current.status) === "done" && current.impediment) throw new UserFacingError("Resuelve el impedimento antes de marcar la tarea como terminada.", 409);
  const changesBacklog = inBacklog(current) !== inBacklog({ ...current, ...patch });
  if (changesBacklog && inBacklog({ ...current, ...patch })) patch.sortOrder = await lastTaskOrder(workspaceId, session);
  const changed = Object.entries(patch).filter(([key, value]) => JSON.stringify(taskSnapshot(current)[key as keyof ReturnType<typeof taskSnapshot>]) !== JSON.stringify(value));
  if (!changed.length) return;
  if (changesBacklog) await touchBacklog(workspaceId, session);
  // Every content/status edit contends with closure on the sprint document.
  // A closing confirmation must never freeze an unseen task edit.
  await touchSprintScope(workspaceId, [current.sprintId, patch.sprintId ?? null], session);
  const result = await store.tasks.updateOne(
    { _id: id, workspaceId, ...revisionFilter(expected) },
    { $set: { ...Object.fromEntries(changed), updatedAt: new Date().toISOString() }, $inc: { revision: 1 } },
    { session },
  );
  if (!result.matchedCount) throw new UserFacingError("La tarea cambió. Revisa la versión actual antes de guardar.", 409);
  let message = `actualizó ${current.code}: ${patch.title ?? current.title}`;
  if (patch.status && patch.status !== current.status) {
    const statusNames: Record<TaskStatus, string> = {
      backlog: "Backlog",
      todo: "Por hacer",
      progress: "En curso",
      review: "En revisión",
      done: "Terminado",
    };
    message = `movió ${current.code} a ${statusNames[patch.status]}`;
  }
  const metricBefore = taskMetric(current), metricAfter = taskMetric({ ...current, ...patch });
  const reporting = JSON.stringify(metricBefore) !== JSON.stringify(metricAfter) ? await reportEvent(await database(), workspaceId, context, { kind: "task", sprintIds: [...new Set([current.sprintId, metricAfter.sprintId].filter((s): s is string => !!s))], metricBefore, metricAfter }) : undefined;
  await addActivity(context, user, workspaceId, message, "task.updated", id, expected + 1, taskSnapshot(current), taskSnapshot({ ...current, ...patch }), reporting);
}

export async function deleteTask(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.");
  const id = cleanText(payload.id, 150);
  const store = collections(await database());
  const task = await store.tasks.findOne({ _id: id, workspaceId }, { session });
  if (!task) throw new UserFacingError("No encontramos esa tarea.");
  if (task.sprintId) await assertWritableSprint(workspaceId, task.sprintId, session);
  const expected = revision(payload.revision);
  if ((task.revision ?? 0) !== expected) throw new UserFacingError("La tarea cambió. Revisa la versión actual antes de eliminarla.", 409);
  if (inBacklog(task)) await touchBacklog(workspaceId, session);
  if (task.sprintId) await touchSprintScope(workspaceId, [task.sprintId], session);
  const result = await store.tasks.deleteOne({ _id: id, workspaceId, ...revisionFilter(expected) }, { session });
  if (!result.deletedCount) throw new UserFacingError("La tarea cambió. Revisa la versión actual.", 409);
  await store.taskUpdates.deleteMany({ workspaceId, taskId: id }, { session });
  await addActivity(context, user, workspaceId, `eliminó ${task.code}: ${task.title}`, "task.deleted", id, expected + 1, taskSnapshot(task), {}, await reportEvent(await database(), workspaceId, context, { kind: "task", sprintIds: task.sprintId ? [task.sprintId] : [], metricBefore: taskMetric(task), metricAfter: null }));
}

async function assertWritableSprint(workspaceId: string, id: string, session: ClientSession) {
  const sprint = await collections(await database()).sprints.findOne({ _id: id, workspaceId }, { session });
  if (!sprint) throw new UserFacingError("Ese sprint no pertenece al proyecto.");
  if (sprint.status !== "planned" && sprint.status !== "active") throw new UserFacingError("Este sprint está finalizado. Consulta su historial; el trabajo devuelto se puede editar en el backlog.", 409);
}

// Task edits and lifecycle transitions write the same sprint document.
async function touchSprintScope(workspaceId: string, ids: (string | null)[], session: ClientSession) {
  const store = collections(await database());
  for (const id of [...new Set(ids.filter((id): id is string => !!id))].sort()) {
    const result = await store.sprints.updateOne({ _id: id, workspaceId, status: { $in: ["planned", "active"] } }, { $inc: { revision: 1 } }, { session });
    if (!result.matchedCount) throw new UserFacingError("El sprint ya no admite cambios. Revisa su historial.", 409);
  }
}

async function collaborationTask(user: AppUser, payload: Record<string, unknown>, session: ClientSession) {
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const store = collections(await database());
  const task = await store.tasks.findOne({ _id: cleanText(payload.id, 150), workspaceId }, { session });
  if (!task) throw new UserFacingError("No encontramos esa tarea.");
  if (task.sprintId) await assertWritableSprint(workspaceId, task.sprintId, session);
  return { store, task, workspaceId };
}

async function addTaskUpdate(context: MutationContext, user: AppUser, workspaceId: string, task: TaskDocument, kind: TaskUpdate["kind"], text: string, before: TaskImpediment | null, after: TaskImpediment | null) {
  const store = collections(await database());
  const id = newId("comment");
  await store.taskUpdates.insertOne({ _id: id, workspaceId, taskId: task._id, kind, text, actorId: user.id, actorName: user.name, createdAt: new Date().toISOString(), before, after }, { session: context.session });
  return id;
}

export async function changeImpediment(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const { store, task, workspaceId } = await collaborationTask(user, payload, session);
  const expected = revision(payload.revision);
  if ((task.revision ?? 0) !== expected) throw new UserFacingError("La tarea o su impedimento cambió. Conservamos tu texto; revisa la versión actual.", 409);
  const operation = payload.operation;
  if (!["report", "update", "resolve"].includes(String(operation))) throw new UserFacingError("Elige una acción válida para el impedimento.");
  const before = task.impediment ?? null;
  if (operation === "report" && before) throw new UserFacingError("La tarea ya tiene un impedimento abierto. Revisa su seguimiento.", 409);
  if (operation !== "report" && (!before || payload.impedimentId !== before.id)) throw new UserFacingError("Ese impedimento ya no está abierto. Revisa la tarea.", 409);
  if (operation !== "resolve" && task.status === "done") throw new UserFacingError("La tarea está terminada. Cambia su estado de trabajo antes de registrar un impedimento.", 409);
  const text = strictText(operation === "resolve" ? payload.resolution : payload.reason, 1000, operation === "resolve" ? "Resolución" : "Motivo");
  if (!text) throw new UserFacingError(operation === "resolve" ? "Explica cómo se resolvió el impedimento." : "Explica qué impide avanzar.");
  const now = new Date().toISOString();
  let after: TaskImpediment | null = null;
  if (operation !== "resolve") {
    const ownerId = typeof payload.ownerId === "string" ? payload.ownerId : "";
    if (!ownerId || !(await isMember(workspaceId, ownerId, session))) throw new UserFacingError("El seguimiento debe asignarse a una persona de este equipo.");
    const owner = await store.profiles.findOne({ _id: ownerId }, { session });
    if (!owner) throw new UserFacingError("No encontramos a la persona de seguimiento.");
    if (before && before.reason === text && before.ownerId === ownerId) return;
    after = { id: before?.id ?? newId("impediment"), reason: text, ownerId, ownerName: owner.name,
      createdAt: before?.createdAt ?? now, createdById: before?.createdById ?? user.id, createdByName: before?.createdByName ?? user.name, updatedAt: now };
  }
  await touchSprintScope(workspaceId, [task.sprintId], session);
  const changed = await store.tasks.updateOne({ _id: task._id, workspaceId, ...revisionFilter(expected) }, { $set: { impediment: after, updatedAt: now }, $inc: { revision: 1, discussionRevision: 1 } }, { session });
  if (!changed.matchedCount) throw new UserFacingError("La tarea cambió. Revisa el impedimento.", 409);
  const kind = operation === "report" ? "impediment.reported" : operation === "update" ? "impediment.updated" : "impediment.resolved";
  await addTaskUpdate(context, user, workspaceId, task, kind, text, before, after);
  await addActivity(context, user, workspaceId, `${operation === "resolve" ? "resolvió el impedimento de" : operation === "report" ? "registró un impedimento en" : "actualizó el seguimiento de"} ${task.code}`, kind, task._id, expected + 1, { impediment: before }, { impediment: after, ...(operation === "resolve" ? { resolution: text } : {}) });
}

export async function addTaskComment(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const { store, task, workspaceId } = await collaborationTask(user, payload, session);
  const text = strictText(payload.text, 2000, "Comentario");
  if (!text) throw new UserFacingError("Escribe un comentario para compartirlo.");
  // A separate counter serializes appends with delete/close without invalidating
  // an unrelated task form. Concurrent comments can both commit after retry.
  if (task.sprintId) {
    const locked = await store.sprints.updateOne({ _id: task.sprintId, workspaceId, status: { $in: ["planned", "active"] } }, { $inc: { discussionRevision: 1 } }, { session });
    if (!locked.matchedCount) throw new UserFacingError("El sprint finalizó. La conversación es de solo lectura.", 409);
  }
  await store.tasks.updateOne({ _id: task._id, workspaceId }, { $inc: { discussionRevision: 1 } }, { session });
  const id = await addTaskUpdate(context, user, workspaceId, task, "comment", text, null, null);
  await addActivity(context, user, workspaceId, `comentó en ${task.code}`, "task.commented", id, 0, {}, { taskId: task._id, text });
}

export async function getTaskDiscussion(user: AppUser, workspaceId: string, taskId: string, before?: string | null): Promise<DiscussionPage> {
  const store = collections(await database());
  if (!(await isMember(workspaceId, user.id)) || !(await store.tasks.findOne({ _id: taskId, workspaceId }))) throw new WorkspaceUnavailableError();
  const cursor = before ? await store.taskUpdates.findOne({ _id: before, workspaceId, taskId }) : null;
  if (before && !cursor) throw new UserFacingError("La página de conversación no es válida. Vuelve a cargar los mensajes.");
  const rows = await store.taskUpdates.find({ workspaceId, taskId, ...(cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }] } : {}) }).sort({ createdAt: -1, _id: -1 }).limit(51).toArray();
  const page = rows.slice(0, 50);
  return { entries: page.reverse().map(({ _id, workspaceId: _workspace, ...entry }) => { void _workspace; return { ...entry, id: _id }; }), nextCursor: rows.length > 50 ? rows[49]._id : null };
}

function dailyDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new UserFacingError("Selecciona una fecha válida para las notas.");
  return cleanIsoDate(value, "");
}

export async function getDailyNote(user: AppUser, workspaceId: string, sprintId: string, dateValue: unknown): Promise<DailyNote> {
  const store = collections(await database());
  if (!(await isMember(workspaceId, user.id)) || !(await store.sprints.findOne({ _id: sprintId, workspaceId }))) throw new WorkspaceUnavailableError();
  const date = dailyDate(dateValue);
  const note = await store.dailyNotes.findOne({ workspaceId, sprintId, date });
  return { text: note?.text ?? "", revision: note?.revision ?? 0, updatedAt: note?.updatedAt ?? null, updatedByName: note?.updatedByName ?? null };
}

export async function saveDailyNote(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const store = collections(await database());
  const sprintId = cleanText(payload.sprintId, 150);
  const sprint = await store.sprints.findOne({ _id: sprintId, workspaceId }, { session });
  if (!sprint || sprint.status !== "active") throw new UserFacingError("Las notas se editan mientras el sprint está activo. Las anteriores se conservan para consulta.", 409);
  const date = dailyDate(payload.date);
  const text = strictText(payload.text, 2000, "Notas");
  const expected = revision(payload.revision);
  const current = await store.dailyNotes.findOne({ workspaceId, sprintId, date }, { session });
  if ((current?.revision ?? 0) !== expected) throw new UserFacingError("Las notas cambiaron en otra sesión. Tu borrador se conserva; revisa la versión actual.", 409);
  if ((current?.text ?? "") === text) return;
  const locked = await store.sprints.updateOne({ _id: sprintId, workspaceId, status: "active" }, { $inc: { dailyRevision: 1 } }, { session });
  if (!locked.matchedCount) throw new UserFacingError("El sprint finalizó. Conservamos tus notas sin guardar.", 409);
  const id = current?._id ?? newId("daily");
  const patch = { text, revision: expected + 1, updatedAt: new Date().toISOString(), updatedById: user.id, updatedByName: user.name };
  if (current) {
    const updated = await store.dailyNotes.updateOne({ _id: id, workspaceId, sprintId, date, ...revisionFilter(expected) }, { $set: patch }, { session });
    if (!updated.matchedCount) throw new UserFacingError("Las notas cambiaron. Revisa la versión actual.", 409);
  }
  else await store.dailyNotes.insertOne({ _id: id, workspaceId, sprintId, date, ...patch }, { session });
  await addActivity(context, user, workspaceId, `actualizó los acuerdos de Daily del ${date}`, "daily.updated", id, expected + 1, { text: current?.text ?? "" }, { text, sprintId, date });
}

function sprintFields(payload: Record<string, unknown>, current?: SprintDocument) {
  const name = strictText(payload.name ?? current?.name ?? "", 80, "Nombre");
  if (!name) throw new UserFacingError("Escribe un nombre para el sprint.");
  const goal = strictText(payload.goal ?? current?.goal ?? "", 300, "Objetivo");
  const availability = strictText(payload.availability ?? current?.availability ?? "", 1000, "Disponibilidad");
  const capacityHours = payload.capacityHours === undefined ? current?.capacityHours ?? null : payload.capacityHours;
  if (capacityHours !== null && (typeof capacityHours !== "number" || !Number.isFinite(capacityHours) || capacityHours < 0 || capacityHours > 10000)) {
    throw new UserFacingError("La disponibilidad total debe ser entre 0 y 10000 horas, o quedar sin definir.");
  }
  for (const field of ["startDate", "endDate"] as const) {
    if (payload[field] !== undefined && (typeof payload[field] !== "string" || !String(payload[field]).trim())) throw new UserFacingError("Define fechas válidas para el sprint.");
  }
  const startDate = cleanIsoDate(payload.startDate, current?.startDate ?? isoDay());
  const endDate = cleanIsoDate(payload.endDate, current?.endDate ?? isoDay(13));
  if (endDate < startDate) throw new UserFacingError("La fecha final debe ser igual o posterior a la inicial.");
  return { name, goal, availability, capacityHours, startDate, endDate };
}

function sprintSnapshot(sprint: SprintDocument) {
  return { ...sprintFields({}, sprint), status: sprint.status, startedAt: sprint.startedAt ?? null };
}

export async function createSprint(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.");
  const fields = sprintFields(payload);
  const store = collections(await database());
  const sprintId = newId("sp");
  const sprint: SprintDocument = {
    revision: 0,
    _id: sprintId,
    workspaceId,
    ...fields,
    status: "planned",
    createdAt: new Date().toISOString(),
  };
  await store.sprints.insertOne(sprint, { session });
  await addActivity(context, user, workspaceId, `planificó ${fields.name}`, "sprint.created", sprintId, 0, {}, sprintSnapshot(sprint));
  return sprintId;
}

export async function updateSprint(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const store = collections(await database());
  const id = cleanText(payload.id, 150);
  const current = await store.sprints.findOne({ _id: id, workspaceId }, { session });
  if (!current) throw new UserFacingError("No encontramos ese sprint.");
  const expected = revision(payload.revision);
  if ((current.revision ?? 0) !== expected) throw new UserFacingError("El sprint o su selección de trabajo cambió. Conservamos tu formulario; revisa la versión actual.", 409);
  if (current.status !== "planned") throw new UserFacingError("Solo puedes editar la planificación de un sprint planificado.", 409);
  const fields = sprintFields(payload, current);
  const changes = payload.taskChanges ?? [];
  if (!Array.isArray(changes) || changes.length > 100) throw new UserFacingError("Selecciona hasta 100 cambios de trabajo a la vez.");
  const seen = new Set<string>();
  const transfers: { task: TaskDocument; selected: boolean }[] = [];
  for (const change of changes) {
    if (!change || typeof change !== "object" || typeof change.id !== "string" || typeof change.selected !== "boolean" || seen.has(change.id)) throw new UserFacingError("La selección de tareas no es válida.");
    seen.add(change.id);
    const taskRevision = revision(change.revision);
    const task = await store.tasks.findOne({ _id: change.id, workspaceId }, { session });
    if (!task || (task.sprintId && task.sprintId !== id)) throw new UserFacingError("Solo puedes seleccionar trabajo del backlog o de este sprint.", 409);
    if ((task.revision ?? 0) !== taskRevision) throw new UserFacingError("Una tarea cambió en otra sesión. Revisa la selección antes de guardar.", 409);
    if (change.selected !== (task.sprintId === id)) transfers.push({ task, selected: change.selected });
  }
  if (!transfers.length && Object.entries(fields).every(([key, value]) => JSON.stringify(sprintSnapshot(current)[key as keyof ReturnType<typeof sprintSnapshot>]) === JSON.stringify(value))) return;
  const updated = await store.sprints.updateOne({ _id: id, workspaceId, status: "planned", ...revisionFilter(expected) }, { $set: fields, $inc: { revision: 1 } }, { session });
  if (!updated.matchedCount) throw new UserFacingError("El sprint cambió. Revisa la versión actual.", 409);
  const beforeTasks: Record<string, unknown> = {};
  const afterTasks: Record<string, unknown> = {};
  if (transfers.length) await touchBacklog(workspaceId, session);
  let order = transfers.length ? await lastTaskOrder(workspaceId, session) : 0;
  for (const { task, selected } of transfers) {
    const patch = { sprintId: selected ? id : null, status: selected ? "todo" as const : "backlog" as const, sortOrder: order++ };
    const result = await store.tasks.updateOne({ _id: task._id, workspaceId, ...revisionFilter(task.revision ?? 0) }, { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { revision: 1 } }, { session });
    if (!result.matchedCount) throw new UserFacingError("Una tarea cambió. Revisa la selección.", 409);
    beforeTasks[task._id] = { sprintId: task.sprintId, status: task.status, sortOrder: task.sortOrder, revision: task.revision ?? 0 };
    afterTasks[task._id] = { ...patch, revision: (task.revision ?? 0) + 1 };
  }
  await addActivity(context, user, workspaceId, `preparó ${fields.name}${transfers.length ? ` y ajustó ${transfers.length} tareas` : ""}`, "sprint.planned", id, expected + 1,
    { ...sprintSnapshot(current), tasks: beforeTasks }, { ...sprintSnapshot({ ...current, ...fields }), tasks: afterTasks });
}

export async function startSprint(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id, session))) throw new UserFacingError("No tienes acceso a este equipo.", 403);
  const store = collections(await database());
  // All starts contend on this project document, even when targeting DIFFERENT
  // sprints. Mongo retries the losing transaction with a fresh snapshot, so the
  // count below observes the winner. No migration rewrites legacy active sprints.
  await store.workspaces.updateOne({ _id: workspaceId }, { $inc: { sprintLifecycleRevision: 1 } }, { session });
  const id = cleanText(payload.id, 150);
  const current = await store.sprints.findOne({ _id: id, workspaceId }, { session });
  if (!current) throw new UserFacingError("No encontramos ese sprint.");
  const expected = revision(payload.revision);
  if ((current.revision ?? 0) !== expected) throw new UserFacingError("El sprint o su trabajo cambió. Revisa el plan antes de iniciar.", 409);
  if (current.status !== "planned") throw new UserFacingError("Solo se puede iniciar un sprint planificado.", 409);
  if (await store.sprints.countDocuments({ workspaceId, status: "active" }, { session })) throw new UserFacingError("Este proyecto ya tiene un sprint activo. No se inició otro sprint.", 409);
  const fields = sprintFields({}, current);
  if (!fields.goal) throw new UserFacingError("Define un objetivo antes de iniciar el sprint.");
  if (!(await store.tasks.countDocuments({ workspaceId, sprintId: id, status: { $ne: "backlog" } }, { session }))) throw new UserFacingError("Selecciona al menos una tarea antes de iniciar el sprint.");
  const startedAt = new Date().toISOString();
  const result = await store.sprints.updateOne({ _id: id, workspaceId, status: "planned", ...revisionFilter(expected) }, { $set: { status: "active", startedAt }, $inc: { revision: 1 } }, { session });
  if (!result.matchedCount) throw new UserFacingError("El sprint cambió. Revisa el plan antes de iniciar.", 409);
  const baseline = await store.tasks.find({ workspaceId, sprintId: id, status: { $ne: "backlog" } }, { session, batchSize: 2001, projection: { _id: 1, code: 1, sprintId: 1, status: 1, points: 1 } }).sort({ _id: 1 }).limit(2001).toArray();
  await addActivity(context, user, workspaceId, `inició ${current.name}`, "sprint.started", id, expected + 1, { status: "planned", startedAt: null }, { status: "active", startedAt }, await reportEvent(await database(), workspaceId, context, { kind: "start", sprintId: id, sprintIds: [id], at: startedAt, baseline: baseline.length <= 2000 ? baseline.map(taskMetric) : null }));
}

export const closeSprint = (user: AppUser, payload: Record<string, unknown>, context: MutationContext) => finishSprint(user, payload, context, "completed");
export const cancelSprint = (user: AppUser, payload: Record<string, unknown>, context: MutationContext) => finishSprint(user, payload, context, "cancelled");

async function finishSprint(user: AppUser, payload: Record<string, unknown>, context: MutationContext, kind: SprintOutcome["kind"]) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  const role = await isMember(workspaceId, user.id, session);
  if (!role || (kind === "cancelled" && !canManageProject(role))) throw new UserFacingError(kind === "cancelled" ? "Solo el propietario o un administrador puede cancelar un sprint." : "No tienes acceso a este equipo.", 403);
  const store = collections(await database());
  // Shares the start lock, so a new start observes a committed end transition.
  await store.workspaces.updateOne({ _id: workspaceId }, { $inc: { sprintLifecycleRevision: 1 } }, { session });
  const workspace = await store.workspaces.findOne({ _id: workspaceId }, { session });
  const id = cleanText(payload.id, 150);
  const current = await store.sprints.findOne({ _id: id, workspaceId }, { session });
  if (!current) throw new UserFacingError("No encontramos ese sprint.");
  const expected = revision(payload.revision);
  if ((current.revision ?? 0) !== expected) throw new UserFacingError("El sprint o sus tareas cambiaron. Tu texto se conserva; revisa el resumen actualizado antes de confirmar.", 409);
  if (current.status !== "active" && !(kind === "cancelled" && current.status === "planned")) throw new UserFacingError(kind === "completed" ? "Solo puedes cerrar un sprint activo." : "Solo puedes cancelar un sprint planificado o activo.", 409);
  if (revision(payload.governanceRevision) !== (workspace?.governanceRevision ?? 0)) throw new UserFacingError("Los acuerdos del equipo cambiaron. Revisa la Definition of Done antes de confirmar.", 409);
  const summary = strictText(payload.summary ?? "", 2000, "Resumen");
  const reason = kind === "cancelled" ? strictText(payload.reason, 1000, "Motivo") : "";
  if (kind === "completed" && !summary) throw new UserFacingError("Escribe un resumen del resultado del sprint.");
  if (kind === "cancelled" && !reason) throw new UserFacingError("Explica el motivo de la cancelación.");
  if (payload.reviewed !== true) throw new UserFacingError("Revisa el resultado y el trabajo que volverá al backlog antes de confirmar.");
  const tasks = await store.tasks.find({ workspaceId, sprintId: id }, { session }).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).toArray();
  const profiles = await store.profiles.find({ _id: { $in: [...new Set(tasks.flatMap((task) => task.assigneeId ? [task.assigneeId] : []))] } }, { session }).toArray();
  const names = new Map(profiles.map((profile) => [profile._id, profile.name]));
  const endedAt = new Date().toISOString();
  const outcome: SprintOutcome = {
    kind, endedAt, actorId: user.id, actorName: user.name, summary, reason,
    plan: { ...sprintFields({}, current), startedAt: current.startedAt ?? null },
    productGoal: workspace?.productGoal ?? "", definitionOfDone: [...(workspace?.definitionOfDone ?? [])],
    tasks: tasks.map((task) => ({ ...taskSnapshot(task), id: task._id, revision: task.revision ?? 0,
      assigneeName: task.assigneeId ? names.get(task.assigneeId) ?? null : null, returnedToBacklog: task.status !== "done" })),
  };
  const result = await store.sprints.updateOne({ _id: id, workspaceId, ...revisionFilter(expected), status: current.status }, { $set: { status: kind, outcome }, $inc: { revision: 1 } }, { session });
  if (!result.matchedCount) throw new UserFacingError("El sprint cambió. Revisa el resumen antes de confirmar.", 409);
  const unfinished = tasks.filter((task) => task.status !== "done");
  if (unfinished.length) {
    await touchBacklog(workspaceId, session);
    let order = await lastTaskOrder(workspaceId, session);
    const moved = await store.tasks.bulkWrite(unfinished.map((task) => ({ updateOne: {
      filter: { _id: task._id, workspaceId, ...revisionFilter(task.revision ?? 0) },
      update: { $set: { sprintId: null, status: "backlog" as const, sortOrder: order++, updatedAt: endedAt }, $inc: { revision: 1 } },
    } })), { session });
    if (moved.matchedCount !== unfinished.length) throw new UserFacingError("El trabajo cambió. Revisa las tareas antes de finalizar.", 409);
  }
  await addActivity(context, user, workspaceId, `${kind === "completed" ? "cerró" : "canceló"} ${current.name}; ${unfinished.length} tareas volvieron al backlog`, `sprint.${kind}`, id, expected + 1,
    { status: current.status, outcome: null }, { status: kind, outcome }, await reportEvent(await database(), workspaceId, context, { kind: "end", sprintId: id, sprintIds: [id], at: endedAt }));
}

export async function createWorkspace(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  await upsertUser(user, session);
  const name = cleanText(payload.name, 80);
  if (!name) throw new UserFacingError("Escribe un nombre para el proyecto.");
  const workspaceId = newId("ws");
  const sprintId = newId("sp");
  const now = new Date().toISOString();
  const store = collections(await database());
  await store.workspaces.insertOne({ ...governanceDefaults(), _id: workspaceId, name, inviteCode: inviteCode(), createdBy: user.id, createdAt: now }, { session });
  // Sequential operations: MongoDB sessions do not support Promise.all in transactions.
  await store.memberships.insertOne({
      _id: membershipId(workspaceId, user.id),
      workspaceId,
      userId: user.id,
      role: "owner",
      revision: 0,
      joinedAt: now,
    }, { session });
  await store.sprints.insertOne({
      revision: 0,
      _id: sprintId,
      workspaceId,
      name: "Sprint 1",
      goal: "Organizar y entregar el primer incremento",
      status: "planned",
      startDate: isoDay(),
      endDate: isoDay(13),
      createdAt: now,
    }, { session });
  await store.counters.insertOne({ _id: `task-code:${workspaceId}`, value: 0 }, { session });
  await addActivity(context, user, workspaceId, "creó el espacio de trabajo", "workspace.created", workspaceId, 0, {}, { name, ownerId: user.id, initialSprintId: sprintId });
  return workspaceId;
}

export async function joinWorkspace(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  await upsertUser(user, session);
  const code = cleanText(payload.inviteCode, 20).toUpperCase();
  if (!code) throw new UserFacingError("Escribe el código de invitación.");
  if (!/^[A-Z0-9]{8,20}$/.test(code)) {
    throw new UserFacingError("El código de invitación no tiene un formato válido.");
  }
  const store = collections(await database());
  // Admission is accepted atomically against the CURRENT invitation. Revocation and
  // rotation write this same document: no new acceptance can succeed after them.
  // Admission, membership and event now commit together, or roll back together.
  const workspace = await store.workspaces.findOneAndUpdate(
    { inviteCode: code, inviteEnabled: { $ne: false } },
    { $inc: { inviteAcceptances: 1 } },
    { returnDocument: "after", session },
  );
  if (!workspace) throw new UserFacingError("Ese código de invitación no existe o ya no está activo.");
  const result = await store.memberships.updateOne(
    { _id: membershipId(workspace._id, user.id) },
    { $setOnInsert: { workspaceId: workspace._id, userId: user.id, role: "member", revision: 0, joinedAt: new Date().toISOString() } },
    { upsert: true, session },
  );
  if (result.upsertedCount > 0) await addActivity(context, user, workspace._id, "se unió al equipo", "member.joined", user.id, 0, {}, { role: "member" });
  return workspace._id;
}

async function requireManagement(user: AppUser, workspaceId: string, session: ClientSession, access = false) {
  const role = await isMember(workspaceId, user.id, session);
  if (!(access ? canManageAccess(role) : canManageProject(role))) {
    throw new UserFacingError("No tienes permiso para administrar este proyecto.", 403);
  }
}

function revision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new UserFacingError("La versión del proyecto no es válida. Vuelve a abrir el formulario.");
  }
  return value;
}

function strictText(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || value.length > max) throw new UserFacingError(`${label}: máximo ${max} caracteres.`);
  return value.trim();
}

export async function updateScrumConfiguration(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  await requireManagement(user, workspaceId, session);
  const expected = revision(payload.governanceRevision);
  const productGoal = strictText(payload.productGoal, 1000, "Objetivo del producto");
  if (!Array.isArray(payload.definitionOfDone) || payload.definitionOfDone.length > 20) {
    throw new UserFacingError("Añade como máximo 20 criterios a la Definition of Done.");
  }
  const definitionOfDone = payload.definitionOfDone.map((item) => strictText(item, 300, "Criterio"));
  if (definitionOfDone.some((item) => !item) || new Set(definitionOfDone).size !== definitionOfDone.length) {
    throw new UserFacingError("Los criterios no pueden estar vacíos ni repetidos.");
  }
  const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const productOwnerId = payload.productOwnerId;
  const scrumMasterId = payload.scrumMasterId;
  const developerIds = payload.developerIds;
  if ((productOwnerId !== null && !validId(productOwnerId)) || (scrumMasterId !== null && !validId(scrumMasterId))
    || !Array.isArray(developerIds) || developerIds.length > 200 || !developerIds.every(validId)
    || new Set(developerIds).size !== developerIds.length) {
    throw new UserFacingError("Selecciona responsabilidades válidas para este equipo.");
  }
  const store = collections(await database());
  const selectedIds = [...new Set([productOwnerId, scrumMasterId, ...developerIds].filter((id): id is string => id !== null))];
  const count = await store.memberships.countDocuments({ workspaceId, userId: { $in: selectedIds } }, { session });
  if (count !== selectedIds.length) throw new UserFacingError("Las responsabilidades solo pueden asignarse a integrantes de este equipo.");
  await migrateScrumGovernance(await database(), workspaceId, session);
  const current = await store.workspaces.findOne({ _id: workspaceId }, { session });
  const after = { productGoal, definitionOfDone, productOwnerId, scrumMasterId, developerIds };
  const result = await store.workspaces.updateOne(
    { _id: workspaceId, governanceRevision: expected },
    { $set: { productGoal, definitionOfDone, productOwnerId, scrumMasterId, developerIds }, $inc: { governanceRevision: 1 } },
    { session },
  );
  if (!result.matchedCount) throw new UserFacingError("La configuración cambió. Conservamos tu borrador; cierra y vuelve a abrir para revisar la versión actual.", 409);
  const before = Object.fromEntries(Object.keys(after).map((key) => [key, current?.[key as keyof WorkspaceDocument]]));
  await addActivity(context, user, workspaceId, "actualizó el objetivo del producto, los acuerdos y las responsabilidades Scrum", "governance.updated", workspaceId, expected + 1, before, after);
}

export async function updateMemberAccess(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  await requireManagement(user, workspaceId, session, true);
  const userId = cleanText(payload.userId, 128);
  if ((payload.role !== "admin" && payload.role !== "member") || (payload.expectedRole !== "admin" && payload.expectedRole !== "member")) {
    throw new UserFacingError("El acceso debe ser Administrador o Miembro.");
  }
  const store = collections(await database());
  const target = await store.memberships.findOne({ workspaceId, userId }, { session });
  if (!target) throw new UserFacingError("No encontramos a ese integrante en el proyecto.");
  if (target.role === "owner") throw new UserFacingError("El acceso del propietario no se puede modificar.", 403);
  const expected = revision(payload.accessRevision);
  if ((target.revision ?? 0) !== expected || target.role !== payload.expectedRole) throw new UserFacingError("El acceso cambió. Vuelve a abrir el formulario antes de guardar.", 409);
  if (target.role === payload.role) return;
  const result = await store.memberships.updateOne(
    { workspaceId, userId, role: payload.expectedRole as MemberRole, ...revisionFilter(expected) },
    { $set: { role: payload.role as MemberRole }, $inc: { revision: 1 } },
    { session },
  );
  if (!result.matchedCount) throw new UserFacingError("El acceso cambió. Vuelve a abrir el formulario antes de guardar.", 409);
  if (result.modifiedCount) await addActivity(context, user, workspaceId, "actualizó el acceso administrativo de un integrante", "member.access_updated", userId, expected + 1, { role: target.role }, { role: payload.role });
}

export async function manageInvitation(user: AppUser, payload: Record<string, unknown>, context: MutationContext) {
  const { session } = context;
  const workspaceId = cleanText(payload.workspaceId, 150);
  await requireManagement(user, workspaceId, session);
  const expected = revision(payload.invitationRevision);
  if (payload.operation !== "rotate" && payload.operation !== "revoke") throw new UserFacingError("Elige renovar o revocar la invitación.");
  await migrateScrumGovernance(await database(), workspaceId, session);
  const store = collections(await database());
  const current = await store.workspaces.findOne({ _id: workspaceId }, { session });
  // Revoking also discards the old credential. Reactivation ALWAYS creates a new one.
  const result = await store.workspaces.updateOne(
    { _id: workspaceId, invitationRevision: expected },
    { $set: { inviteCode: inviteCode(), inviteEnabled: payload.operation === "rotate" }, $inc: { invitationRevision: 1 } },
    { session },
  );
  if (!result.matchedCount) throw new UserFacingError("La invitación cambió. Cierra y vuelve a abrir para revisar su estado actual.", 409);
  await addActivity(context, user, workspaceId, payload.operation === "revoke" ? "revocó la invitación del proyecto" : "generó una nueva invitación del proyecto",
    payload.operation === "revoke" ? "invitation.revoked" : "invitation.rotated", workspaceId, expected + 1,
    { enabled: current?.inviteEnabled, invitationRevision: expected }, { enabled: payload.operation === "rotate", invitationRevision: expected + 1 });
}
