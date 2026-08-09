import type { Collection, Db } from "mongodb";
import { appDatabase } from "../lib/mongodb";
import { UserFacingError } from "../lib/errors";
import type {
  Activity,
  AppUser,
  BootstrapData,
  Member,
  ScrumTask,
  Sprint,
  TaskPriority,
  TaskStatus,
  Workspace,
} from "../app/lib/types";

type MemberRole = "owner" | "member";
type SprintStatus = "active" | "planned" | "completed";

type ProfileDocument = {
  _id: string;
  authUserId: string;
  email: string;
  name: string;
  avatarColor: string;
  createdAt: string;
};

type WorkspaceDocument = {
  _id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  createdAt: string;
};

type MembershipDocument = {
  _id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
};

type SprintDocument = {
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
  _id: string;
  workspaceId: string;
  sprintId: string | null;
  code: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  points: number;
  assigneeId: string | null;
  reporterId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type ActivityDocument = {
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

type Collections = {
  profiles: Collection<ProfileDocument>;
  workspaces: Collection<WorkspaceDocument>;
  memberships: Collection<MembershipDocument>;
  sprints: Collection<SprintDocument>;
  tasks: Collection<TaskDocument>;
  activities: Collection<ActivityDocument>;
  counters: Collection<CounterDocument>;
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
  };
}

async function database() {
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

function cleanSortOrder(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1_000_000, Math.trunc(numeric))) : 0;
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

export async function upsertUser(user: AppUser) {
  const store = collections(await database());
  const now = new Date().toISOString();
  await store.profiles.updateOne(
    { _id: user.id },
    {
      $set: { authUserId: user.id, email: user.email, name: user.name },
      $setOnInsert: { avatarColor: avatarColor(user.id), createdAt: now },
    },
    { upsert: true },
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
    return workspace
      ? [{ id: workspace._id, name: workspace.name, inviteCode: workspace.inviteCode, role: membership.role }]
      : [];
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
    { $setOnInsert: { name: "Proyecto de Universidad", inviteCode: inviteCode(), createdBy: user.id, createdAt: now } },
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
        status: "active",
        startDate: isoDay(-3),
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
            status,
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

export async function isMember(workspaceId: string, userId: string) {
  const store = collections(await database());
  const row = await store.memberships.findOne(
    { workspaceId, userId },
    { projection: { role: 1 } },
  );
  return row?.role ?? null;
}

export async function getBootstrap(user: AppUser, requestedWorkspace?: string | null): Promise<BootstrapData> {
  await upsertUser(user);
  let workspaces = await membershipsFor(user.id);

  if (workspaces.length === 0) {
    await createStarterWorkspace(user);
    workspaces = await membershipsFor(user.id);
  }

  const workspace = workspaces.find((item) => item.id === requestedWorkspace) ?? workspaces[0];
  const store = collections(await database());
  const [sprintRows, taskRows, membershipRows, activityRows] = await Promise.all([
    store.sprints.find({ workspaceId: workspace.id }).sort({ startDate: -1 }).toArray(),
    store.tasks.find({ workspaceId: workspace.id }).sort({ sortOrder: 1, createdAt: 1 }).toArray(),
    store.memberships.find({ workspaceId: workspace.id }).sort({ joinedAt: 1 }).toArray(),
    store.activities.find({ workspaceId: workspace.id }).sort({ createdAt: -1 }).limit(12).toArray(),
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
      id: item._id,
      workspaceId: item.workspaceId,
      sprintId: item.sprintId,
      code: item.code,
      title: item.title,
      description: item.description,
      status: item.status,
      priority: item.priority,
      points: item.points,
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
          joinedAt: item.joinedAt,
        }]
      : [];
  });
  const activities: Activity[] = activityRows.flatMap((item) => {
    const profile = profileMap.get(item.userId);
    return profile
      ? [{
          id: item._id,
          userId: item.userId,
          userName: profile.name,
          avatarColor: profile.avatarColor,
          message: item.message,
          createdAt: item.createdAt,
        }]
      : [];
  });

  return { user, workspace, workspaces, sprints, tasks, members, activities };
}

async function addActivity(workspaceId: string, userId: string, message: string) {
  const store = collections(await database());
  await store.activities.insertOne({
    _id: newId("act"),
    workspaceId,
    userId,
    message,
    createdAt: new Date().toISOString(),
  });
}

async function nextTaskCode(workspaceId: string) {
  const store = collections(await database());
  const counterId = `task-code:${workspaceId}`;
  const existingCounter = await store.counters.findOne({ _id: counterId });

  if (!existingCounter) {
    const [maximum] = await store.tasks
      .aggregate<{ maximum: number }>([
        { $match: { workspaceId, code: { $regex: /^UNI-[0-9]+$/ } } },
        { $project: { number: { $toInt: { $substrBytes: ["$code", 4, 12] } } } },
        { $group: { _id: null, maximum: { $max: "$number" } } },
      ])
      .toArray();
    await store.counters.updateOne(
      { _id: counterId },
      { $max: { value: maximum?.maximum ?? 0 } },
      { upsert: true },
    );
  }

  const counter = await store.counters.findOneAndUpdate(
    { _id: counterId },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  if (!counter) throw new Error("No pudimos asignar un código a la tarea.");
  return `UNI-${String(counter.value).padStart(2, "0")}`;
}

const validStatuses: TaskStatus[] = ["backlog", "todo", "progress", "review", "done"];
const validPriorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
const validPoints = [1, 2, 3, 5, 8, 13];

async function validateAssignee(workspaceId: string, assigneeId: string | null) {
  if (!assigneeId) return null;
  if (!(await isMember(workspaceId, assigneeId))) {
    throw new UserFacingError("El responsable debe pertenecer al equipo.");
  }
  return assigneeId;
}

export async function createTask(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id))) throw new UserFacingError("No tienes acceso a este equipo.");

  const title = cleanText(payload.title, 160);
  if (!title) throw new UserFacingError("Escribe un título para la tarea.");
  let status = validStatuses.includes(payload.status as TaskStatus) ? (payload.status as TaskStatus) : "todo";
  const priority = validPriorities.includes(payload.priority as TaskPriority)
    ? (payload.priority as TaskPriority)
    : "medium";
  const points = validPoints.includes(Number(payload.points)) ? Number(payload.points) : 3;
  const assigneeId = await validateAssignee(workspaceId, cleanText(payload.assigneeId, 100) || null);
  const store = collections(await database());
  let sprintId = cleanText(payload.sprintId, 150) || null;
  if (status === "backlog") sprintId = null;
  else if (!sprintId) status = "backlog";
  if (sprintId && !(await store.sprints.findOne({ _id: sprintId, workspaceId }))) {
    throw new UserFacingError("Ese sprint no pertenece al proyecto.");
  }

  const code = await nextTaskCode(workspaceId);
  const now = new Date().toISOString();
  await store.tasks.insertOne({
    _id: newId("task"),
    workspaceId,
    sprintId,
    code,
    title,
    description: cleanText(payload.description, 1200),
    status,
    priority,
    points,
    assigneeId,
    reporterId: user.id,
    sortOrder: cleanSortOrder(payload.sortOrder),
    createdAt: now,
    updatedAt: now,
  });
  await addActivity(workspaceId, user.id, `creó ${code}: ${title}`);
}

export async function updateTask(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id))) throw new UserFacingError("No tienes acceso a este equipo.");
  const id = cleanText(payload.id, 150);
  const store = collections(await database());
  const current = await store.tasks.findOne({ _id: id, workspaceId });
  if (!current) throw new UserFacingError("No encontramos esa tarea.");

  const title = payload.title === undefined ? current.title : cleanText(payload.title, 160);
  if (!title) throw new UserFacingError("La tarea necesita un título.");
  let status = validStatuses.includes(payload.status as TaskStatus)
    ? (payload.status as TaskStatus)
    : current.status;
  const priority = validPriorities.includes(payload.priority as TaskPriority)
    ? (payload.priority as TaskPriority)
    : current.priority;
  const points = validPoints.includes(Number(payload.points)) ? Number(payload.points) : current.points;
  const description = payload.description === undefined ? current.description : cleanText(payload.description, 1200);
  const assigneeId = await validateAssignee(
    workspaceId,
    payload.assigneeId === undefined ? current.assigneeId : cleanText(payload.assigneeId, 100) || null,
  );
  let sprintId = payload.sprintId === undefined ? current.sprintId : cleanText(payload.sprintId, 150) || null;
  if (status === "backlog") sprintId = null;
  else if (!sprintId) status = "backlog";
  if (sprintId && !(await store.sprints.findOne({ _id: sprintId, workspaceId }))) {
    throw new UserFacingError("Ese sprint no pertenece al proyecto.");
  }

  await store.tasks.updateOne(
    { _id: id, workspaceId },
    { $set: { title, description, status, priority, points, assigneeId, sprintId, updatedAt: new Date().toISOString() } },
  );

  if (status !== current.status) {
    const statusNames: Record<TaskStatus, string> = {
      backlog: "Backlog",
      todo: "Por hacer",
      progress: "En curso",
      review: "En revisión",
      done: "Terminado",
    };
    await addActivity(workspaceId, user.id, `movió ${current.code} a ${statusNames[status]}`);
  }
}

export async function deleteTask(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id))) throw new UserFacingError("No tienes acceso a este equipo.");
  const id = cleanText(payload.id, 150);
  const store = collections(await database());
  const task = await store.tasks.findOne({ _id: id, workspaceId });
  if (!task) throw new UserFacingError("No encontramos esa tarea.");
  await store.tasks.deleteOne({ _id: id, workspaceId });
  await addActivity(workspaceId, user.id, `eliminó ${task.code}: ${task.title}`);
}

export async function createSprint(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 150);
  if (!(await isMember(workspaceId, user.id))) throw new UserFacingError("No tienes acceso a este equipo.");
  const name = cleanText(payload.name, 80);
  if (!name) throw new UserFacingError("Escribe un nombre para el sprint.");
  const startDate = cleanIsoDate(payload.startDate, isoDay());
  const endDate = cleanIsoDate(payload.endDate, isoDay(13));
  if (endDate < startDate) throw new UserFacingError("La fecha final debe ser igual o posterior a la inicial.");
  const store = collections(await database());
  const status: SprintStatus = (await store.sprints.countDocuments({ workspaceId })) === 0 ? "active" : "planned";
  await store.sprints.insertOne({
    _id: newId("sp"),
    workspaceId,
    name,
    goal: cleanText(payload.goal, 300),
    status,
    startDate,
    endDate,
    createdAt: new Date().toISOString(),
  });
  await addActivity(workspaceId, user.id, `creó ${name}`);
}

export async function createWorkspace(user: AppUser, payload: Record<string, unknown>) {
  await upsertUser(user);
  const name = cleanText(payload.name, 80);
  if (!name) throw new UserFacingError("Escribe un nombre para el proyecto.");
  const workspaceId = newId("ws");
  const sprintId = newId("sp");
  const now = new Date().toISOString();
  const store = collections(await database());
  await store.workspaces.insertOne({ _id: workspaceId, name, inviteCode: inviteCode(), createdBy: user.id, createdAt: now });
  await Promise.all([
    store.memberships.insertOne({
      _id: membershipId(workspaceId, user.id),
      workspaceId,
      userId: user.id,
      role: "owner",
      joinedAt: now,
    }),
    store.sprints.insertOne({
      _id: sprintId,
      workspaceId,
      name: "Sprint 1",
      goal: "Organizar y entregar el primer incremento",
      status: "active",
      startDate: isoDay(),
      endDate: isoDay(13),
      createdAt: now,
    }),
    store.counters.insertOne({ _id: `task-code:${workspaceId}`, value: 0 }),
  ]);
  await addActivity(workspaceId, user.id, "creó el espacio de trabajo");
  return workspaceId;
}

export async function joinWorkspace(user: AppUser, payload: Record<string, unknown>) {
  await upsertUser(user);
  const code = cleanText(payload.inviteCode, 20).toUpperCase();
  if (!code) throw new UserFacingError("Escribe el código de invitación.");
  if (!/^[A-Z0-9]{8,20}$/.test(code)) {
    throw new UserFacingError("El código de invitación no tiene un formato válido.");
  }
  const store = collections(await database());
  const workspace = await store.workspaces.findOne({ inviteCode: code });
  if (!workspace) throw new UserFacingError("Ese código de invitación no existe.");
  const result = await store.memberships.updateOne(
    { _id: membershipId(workspace._id, user.id) },
    { $setOnInsert: { workspaceId: workspace._id, userId: user.id, role: "member", joinedAt: new Date().toISOString() } },
    { upsert: true },
  );
  if (result.upsertedCount > 0) await addActivity(workspace._id, user.id, "se unió al equipo");
  return workspace._id;
}
