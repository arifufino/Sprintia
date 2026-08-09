import { env } from "cloudflare:workers";
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

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#6757d9',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sprints (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    points INTEGER NOT NULL DEFAULT 3,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    reporter_id TEXT NOT NULL REFERENCES users(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS workspaces_invite_code_idx ON workspaces(invite_code)",
  "CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id)",
  "CREATE INDEX IF NOT EXISTS sprints_workspace_idx ON sprints(workspace_id)",
  "CREATE INDEX IF NOT EXISTS tasks_workspace_idx ON tasks(workspace_id)",
  "CREATE INDEX IF NOT EXISTS tasks_sprint_status_idx ON tasks(sprint_id, status)",
  "CREATE INDEX IF NOT EXISTS activities_workspace_idx ON activities(workspace_id)",
];

let schemaPromise: Promise<void> | null = null;

function database(): D1DatabaseLike {
  const binding = env.DB as unknown as D1DatabaseLike | undefined;
  if (!binding) throw new Error("La base de datos todavía no está disponible.");
  return binding;
}

async function ensureSchema() {
  if (!schemaPromise) {
    const db = database();
    schemaPromise = db
      .batch(schemaStatements.map((statement) => db.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
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
  return crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase();
}

function isoDay(offset = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export async function upsertUser(user: AppUser) {
  await ensureSchema();
  await database()
    .prepare(
      `INSERT INTO users (id, email, name, avatar_color)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
    )
    .bind(user.id, user.email, user.name, avatarColor(user.id))
    .run();
}

async function membershipsFor(userId: string): Promise<Workspace[]> {
  const result = await database()
    .prepare(
      `SELECT w.id, w.name, w.invite_code AS inviteCode, m.role
       FROM members m
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY w.created_at ASC`,
    )
    .bind(userId)
    .all<Workspace>();
  return result.results;
}

async function createStarterWorkspace(user: AppUser) {
  const db = database();
  const workspaceId = newId("ws");
  const sprintId = newId("sp");
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

  const statements: D1Statement[] = [
    db.prepare(
      "INSERT INTO workspaces (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(workspaceId, "Proyecto de Universidad", inviteCode(), user.id, now),
    db.prepare(
      "INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(workspaceId, user.id, now),
    db.prepare(
      `INSERT INTO sprints (id, workspace_id, name, goal, status, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
      sprintId,
      workspaceId,
      "Sprint 1",
      "Validar la idea y entregar una primera versión funcional",
      isoDay(-3),
      isoDay(10),
      now,
    ),
  ];

  taskSeeds.forEach(([title, description, status, priority, points], index) => {
    statements.push(
      db.prepare(
        `INSERT INTO tasks
          (id, workspace_id, sprint_id, code, title, description, status, priority, points, assignee_id, reporter_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId("task"),
        workspaceId,
        status === "backlog" ? null : sprintId,
        `UNI-${String(index + 1).padStart(2, "0")}`,
        title,
        description,
        status,
        priority,
        points,
        status === "backlog" ? null : user.id,
        user.id,
        index,
        now,
        now,
      ),
    );
  });

  statements.push(
    db.prepare(
      "INSERT INTO activities (id, workspace_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(newId("act"), workspaceId, user.id, "creó el espacio de trabajo", now),
  );

  await db.batch(statements);
  return workspaceId;
}

export async function isMember(workspaceId: string, userId: string) {
  await ensureSchema();
  const row = await database()
    .prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?")
    .bind(workspaceId, userId)
    .first<{ role: string }>();
  return row?.role ?? null;
}

export async function getBootstrap(user: AppUser, requestedWorkspace?: string | null): Promise<BootstrapData> {
  await upsertUser(user);
  let workspaces = await membershipsFor(user.id);

  if (workspaces.length === 0) {
    await createStarterWorkspace(user);
    workspaces = await membershipsFor(user.id);
  }

  const workspace =
    workspaces.find((item) => item.id === requestedWorkspace) ?? workspaces[0];
  const db = database();

  const [sprintRows, taskRows, memberRows, activityRows] = await Promise.all([
    db.prepare(
      `SELECT id, workspace_id AS workspaceId, name, goal, status,
              start_date AS startDate, end_date AS endDate
       FROM sprints WHERE workspace_id = ? ORDER BY start_date DESC`,
    )
      .bind(workspace.id)
      .all<Sprint>(),
    db.prepare(
      `SELECT t.id, t.workspace_id AS workspaceId, t.sprint_id AS sprintId, t.code,
              t.title, t.description, t.status, t.priority, t.points,
              t.assignee_id AS assigneeId, u.name AS assigneeName,
              u.avatar_color AS assigneeColor, t.reporter_id AS reporterId,
              t.sort_order AS sortOrder, t.created_at AS createdAt, t.updated_at AS updatedAt
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.workspace_id = ?
       ORDER BY t.sort_order ASC, t.created_at ASC`,
    )
      .bind(workspace.id)
      .all<ScrumTask>(),
    db.prepare(
      `SELECT u.id, u.email, u.name, u.avatar_color AS avatarColor,
              m.role, m.joined_at AS joinedAt
       FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.joined_at ASC`,
    )
      .bind(workspace.id)
      .all<Member>(),
    db.prepare(
      `SELECT a.id, a.user_id AS userId, u.name AS userName,
              u.avatar_color AS avatarColor, a.message, a.created_at AS createdAt
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 12`,
    )
      .bind(workspace.id)
      .all<Activity>(),
  ]);

  return {
    user,
    workspace,
    workspaces,
    sprints: sprintRows.results,
    tasks: taskRows.results,
    members: memberRows.results,
    activities: activityRows.results,
  };
}

async function addActivity(workspaceId: string, userId: string, message: string) {
  await database()
    .prepare(
      "INSERT INTO activities (id, workspace_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(newId("act"), workspaceId, userId, message, new Date().toISOString())
    .run();
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const validStatuses: TaskStatus[] = ["backlog", "todo", "progress", "review", "done"];
const validPriorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
const validPoints = [1, 2, 3, 5, 8, 13];

export async function createTask(
  user: AppUser,
  payload: Record<string, unknown>,
) {
  const workspaceId = cleanText(payload.workspaceId, 100);
  if (!(await isMember(workspaceId, user.id))) throw new Error("No tienes acceso a este equipo.");

  const title = cleanText(payload.title, 160);
  if (!title) throw new Error("Escribe un título para la tarea.");

  const status = validStatuses.includes(payload.status as TaskStatus)
    ? (payload.status as TaskStatus)
    : "todo";
  const priority = validPriorities.includes(payload.priority as TaskPriority)
    ? (payload.priority as TaskPriority)
    : "medium";
  const points = validPoints.includes(Number(payload.points)) ? Number(payload.points) : 3;
  const count = await database()
    .prepare("SELECT COUNT(*) AS total FROM tasks WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<{ total: number }>();
  const code = `UNI-${String(Number(count?.total ?? 0) + 1).padStart(2, "0")}`;
  const now = new Date().toISOString();

  await database()
    .prepare(
      `INSERT INTO tasks
       (id, workspace_id, sprint_id, code, title, description, status, priority, points, assignee_id, reporter_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("task"),
      workspaceId,
      cleanText(payload.sprintId, 100) || null,
      code,
      title,
      cleanText(payload.description, 1200),
      status,
      priority,
      points,
      cleanText(payload.assigneeId, 100) || null,
      user.id,
      Number(payload.sortOrder) || 0,
      now,
      now,
    )
    .run();
  await addActivity(workspaceId, user.id, `creó ${code}: ${title}`);
}

export async function updateTask(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 100);
  if (!(await isMember(workspaceId, user.id))) throw new Error("No tienes acceso a este equipo.");
  const id = cleanText(payload.id, 100);
  const current = await database()
    .prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ?")
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();
  if (!current) throw new Error("No encontramos esa tarea.");

  const title = payload.title === undefined ? String(current.title) : cleanText(payload.title, 160);
  if (!title) throw new Error("La tarea necesita un título.");
  const status = validStatuses.includes(payload.status as TaskStatus)
    ? (payload.status as TaskStatus)
    : (current.status as TaskStatus);
  const priority = validPriorities.includes(payload.priority as TaskPriority)
    ? (payload.priority as TaskPriority)
    : (current.priority as TaskPriority);
  const points = validPoints.includes(Number(payload.points))
    ? Number(payload.points)
    : Number(current.points);
  const description =
    payload.description === undefined
      ? String(current.description ?? "")
      : cleanText(payload.description, 1200);
  const assigneeId =
    payload.assigneeId === undefined
      ? (current.assignee_id as string | null)
      : cleanText(payload.assigneeId, 100) || null;
  const sprintId =
    payload.sprintId === undefined
      ? (current.sprint_id as string | null)
      : cleanText(payload.sprintId, 100) || null;

  await database()
    .prepare(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, points = ?,
       assignee_id = ?, sprint_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
    .bind(
      title,
      description,
      status,
      priority,
      points,
      assigneeId,
      sprintId,
      new Date().toISOString(),
      id,
      workspaceId,
    )
    .run();

  if (status !== current.status) {
    const statusNames: Record<TaskStatus, string> = {
      backlog: "Backlog",
      todo: "Por hacer",
      progress: "En curso",
      review: "En revisión",
      done: "Terminado",
    };
    await addActivity(workspaceId, user.id, `movió ${String(current.code)} a ${statusNames[status]}`);
  }
}

export async function deleteTask(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 100);
  if (!(await isMember(workspaceId, user.id))) throw new Error("No tienes acceso a este equipo.");
  const id = cleanText(payload.id, 100);
  const task = await database()
    .prepare("SELECT code, title FROM tasks WHERE id = ? AND workspace_id = ?")
    .bind(id, workspaceId)
    .first<{ code: string; title: string }>();
  if (!task) throw new Error("No encontramos esa tarea.");
  await database()
    .prepare("DELETE FROM tasks WHERE id = ? AND workspace_id = ?")
    .bind(id, workspaceId)
    .run();
  await addActivity(workspaceId, user.id, `eliminó ${task.code}: ${task.title}`);
}

export async function createSprint(user: AppUser, payload: Record<string, unknown>) {
  const workspaceId = cleanText(payload.workspaceId, 100);
  if (!(await isMember(workspaceId, user.id))) throw new Error("No tienes acceso a este equipo.");
  const name = cleanText(payload.name, 80);
  if (!name) throw new Error("Escribe un nombre para el sprint.");
  const startDate = cleanText(payload.startDate, 10) || isoDay();
  const endDate = cleanText(payload.endDate, 10) || isoDay(13);
  if (endDate < startDate) throw new Error("La fecha final debe ser posterior a la inicial.");
  const existing = await database()
    .prepare("SELECT COUNT(*) AS total FROM sprints WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<{ total: number }>();
  const status = Number(existing?.total ?? 0) === 0 ? "active" : "planned";
  await database()
    .prepare(
      `INSERT INTO sprints (id, workspace_id, name, goal, status, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("sp"),
      workspaceId,
      name,
      cleanText(payload.goal, 300),
      status,
      startDate,
      endDate,
      new Date().toISOString(),
    )
    .run();
  await addActivity(workspaceId, user.id, `creó ${name}`);
}

export async function createWorkspace(user: AppUser, payload: Record<string, unknown>) {
  await upsertUser(user);
  const name = cleanText(payload.name, 80);
  if (!name) throw new Error("Escribe un nombre para el proyecto.");
  const workspaceId = newId("ws");
  const sprintId = newId("sp");
  const now = new Date().toISOString();
  const db = database();
  await db.batch([
    db.prepare(
      "INSERT INTO workspaces (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(workspaceId, name, inviteCode(), user.id, now),
    db.prepare(
      "INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(workspaceId, user.id, now),
    db.prepare(
      `INSERT INTO sprints (id, workspace_id, name, goal, status, start_date, end_date, created_at)
       VALUES (?, ?, 'Sprint 1', 'Organizar y entregar el primer incremento', 'active', ?, ?, ?)`,
    ).bind(sprintId, workspaceId, isoDay(), isoDay(13), now),
  ]);
  await addActivity(workspaceId, user.id, "creó el espacio de trabajo");
  return workspaceId;
}

export async function joinWorkspace(user: AppUser, payload: Record<string, unknown>) {
  await upsertUser(user);
  const code = cleanText(payload.inviteCode, 20).toUpperCase();
  if (!code) throw new Error("Escribe el código de invitación.");
  const workspace = await database()
    .prepare("SELECT id, name FROM workspaces WHERE invite_code = ?")
    .bind(code)
    .first<{ id: string; name: string }>();
  if (!workspace) throw new Error("Ese código de invitación no existe.");
  await database()
    .prepare(
      `INSERT INTO members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?)
       ON CONFLICT(workspace_id, user_id) DO NOTHING`,
    )
    .bind(workspace.id, user.id, new Date().toISOString())
    .run();
  await addActivity(workspace.id, user.id, "se unió al equipo");
  return workspace.id;
}
