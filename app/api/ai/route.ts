import { auth } from "../../../auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AI_BYTES = 32_000;
const MAX_MESSAGE_LENGTH = 1_200;
const MAX_TASKS = 40;

type AiTask = {
  code?: unknown;
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  points?: unknown;
};

type AiSprint = { id?: unknown; name?: unknown; status?: unknown };

type AssistantAction = {
  type: "createSprint" | "createTask" | "selectSprint";
  label: string;
  payload: Record<string, unknown>;
};

type AiPayload = {
  message?: unknown;
  context?: {
    workspaceName?: unknown;
    sprintName?: unknown;
    sprintGoal?: unknown;
    sprints?: unknown;
    tasks?: unknown;
  };
};

type SafeTask = {
  code: string;
  title: string;
  status: string;
  priority: string;
  points: number;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 240) : fallback;
}

function safeTasks(value: unknown): SafeTask[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TASKS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const task = item as AiTask;
    const title = text(task.title);
    if (!title) return [];
    const points = typeof task.points === "number" && Number.isFinite(task.points)
      ? Math.max(0, Math.min(100, task.points))
      : 0;
    return [{
      code: text(task.code, "Tarea"),
      title,
      status: text(task.status, "todo"),
      priority: text(task.priority, "medium"),
      points,
    }];
  });
}

function safeSprints(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const sprint = item as AiSprint;
    const id = text(sprint.id, "");
    const name = text(sprint.name, "");
    if (!id || !name) return [];
    return [{ id, name, status: text(sprint.status, "planned") }];
  });
}

function commandTitle(message: string, fallback: string) {
  const quoted = message.match(/["“]([^"”]+)["”]/)?.[1];
  if (quoted) return quoted.trim().slice(0, 80);
  const named = message.match(/(?:llamad[oa]|titulad[oa]|título|titulo|que se llame)\s+(.+?)(?:[.!?]|$)/i)?.[1];
  if (named) return named.replace(/["”]+$/g, "").trim().slice(0, 80) || fallback;
  return fallback;
}

function detectAction(message: string, sprints: ReturnType<typeof safeSprints>): AssistantAction | undefined {
  const normalized = message.toLocaleLowerCase("es");
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + 13 * 86_400_000).toISOString().slice(0, 10);

  if (/\b(crea|crear|nuevo|nueva)\b/.test(normalized) && /\bsprint\b/.test(normalized)) {
    const name = commandTitle(message, "Nuevo sprint");
    return {
      type: "createSprint",
      label: `crear “${name}”`,
      payload: { name, goal: "", startDate, endDate },
    };
  }

  if (/\b(crea|crear|añade|anade|agrega|nueva|nuevo)\b/.test(normalized) && /\b(backlog|tarea|actividad)\b/.test(normalized)) {
    const title = commandTitle(message, "Nueva tarea");
    return {
      type: "createTask",
      label: `crear “${title}” en Backlog`,
      payload: { title, description: "Creada desde Sprintia Copiloto.", status: "backlog", priority: "medium", points: 3 },
    };
  }

  if (/\b(cambia|cambiar|abre|abrir|ver|selecciona|seleccionar)\b/.test(normalized) && /\bsprint\b/.test(normalized)) {
    const match = sprints.find((sprint) => normalized.includes(sprint.name.toLocaleLowerCase("es")));
    if (match) return { type: "selectSprint", label: match.name, payload: { sprintId: match.id } };
  }

  return undefined;
}

function localReply(message: string, tasks: SafeTask[], sprintName: string, goal: string) {
  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");
  const totalPoints = tasks.reduce((sum, task) => sum + task.points, 0);
  const donePoints = doneTasks.reduce((sum, task) => sum + task.points, 0);
  const normalized = message.toLocaleLowerCase("es");

  if (normalized.includes("resumen") || normalized.includes("cómo vamos") || normalized.includes("como vamos")) {
    return `En ${sprintName || "el sprint activo"} hay ${tasks.length} tareas y ${donePoints} de ${totalPoints || 0} puntos terminados (${totalPoints ? Math.round((donePoints / totalPoints) * 100) : 0}%). ${goal ? `El objetivo es: ${goal}` : "Define un objetivo para orientar el sprint."}`;
  }

  if (normalized.includes("prior") || normalized.includes("siguiente") || normalized.includes("qué hago") || normalized.includes("que hago")) {
    const shortlist = openTasks
      .slice()
      .sort((a, b) => (b.priority === "urgent" ? 1 : 0) - (a.priority === "urgent" ? 1 : 0) || b.points - a.points)
      .slice(0, 3);
    if (!shortlist.length) return "El sprint no tiene tareas pendientes. Buen momento para revisar el backlog y preparar el siguiente objetivo.";
    return `Yo priorizaría ${shortlist.map((task) => `${task.code} · ${task.title}`).join(", ")}. Empieza por la primera, aclara su criterio de terminado y deja la siguiente lista para revisión.`;
  }

  if (normalized.includes("plan") || normalized.includes("sprint") || normalized.includes("organiza")) {
    const shortlist = openTasks.slice(0, 3).map((task) => `• ${task.title}`).join("\n");
    return `Plan rápido para avanzar:\n1. Elige una tarea pequeña y muévela a En curso.\n2. Trabaja con un criterio de terminado claro.\n3. Revisa el resultado con el equipo antes de abrir otra tarea.${shortlist ? `\n\nTareas abiertas ahora:\n${shortlist}` : ""}`;
  }

  return "Puedo ayudarte a priorizar, resumir el sprint o preparar un plan de trabajo. Prueba con «¿qué hago después?» o «dame un resumen del sprint».";
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const result = payload as { output_text?: unknown; output?: unknown };
  if (typeof result.output_text === "string") return result.output_text.trim();
  if (!Array.isArray(result.output)) return "";
  return result.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = (part as { text?: unknown }).text;
      return typeof value === "string" ? [value] : [];
    });
  }).join("\n").trim();
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AI_BYTES) return Response.json({ error: "El mensaje es demasiado largo." }, { status: 413 });

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }

  let payload: AiPayload;
  try {
    payload = await request.json() as AiPayload;
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }

  const message = text(payload.message).slice(0, MAX_MESSAGE_LENGTH);
  if (!message) return Response.json({ error: "Escribe una pregunta para el copiloto." }, { status: 422 });

  const context = payload.context ?? {};
  const workspaceName = text(context.workspaceName, "Sprintia");
  const sprintName = text(context.sprintName, "sprint activo");
  const sprintGoal = text(context.sprintGoal);
  const sprints = safeSprints(context.sprints);
  const tasks = safeTasks(context.tasks);
  const action = detectAction(message, sprints);
  const fallback = localReply(message, tasks, sprintName, sprintGoal);
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (action) {
    const actionVerb = action.type === "selectSprint" ? "Puedo cambiar" : "Puedo";
    return Response.json({ reply: `${actionVerb} ${action.label}. Pulsa el botón para confirmarlo.`, source: "command", action });
  }

  if (!apiKey) return Response.json({ reply: fallback, source: "local" });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        store: false,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `Eres Sprintia Copiloto, un asistente breve para equipos universitarios que usan Scrum. Ayuda a priorizar y aclarar trabajo, pero nunca inventes datos ni cambies tareas. Responde en español claro, con máximo 160 palabras. Contexto: espacio ${workspaceName}; ${sprintName}; objetivo: ${sprintGoal || "sin objetivo definido"}. Tareas: ${JSON.stringify(tasks)}.`,
            }],
          },
          { role: "user", content: [{ type: "input_text", text: message }] },
        ],
      }),
    });
    if (!response.ok) return Response.json({ reply: fallback, source: "local" });
    const result = await response.json();
    const reply = extractOutputText(result);
    return Response.json({ reply: reply || fallback, source: reply ? "openai" : "local" });
  } catch {
    return Response.json({ reply: fallback, source: "local" });
  }
}
