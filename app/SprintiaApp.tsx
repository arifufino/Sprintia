"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AppUser,
  BootstrapData,
  Member,
  ScrumTask,
  Sprint,
  TaskPriority,
  TaskStatus,
} from "./lib/types";

type View = "board" | "backlog" | "summary" | "team" | "settings";
type Modal = "task" | "invite" | "workspace" | "sprint" | null;
type ThemePreference = "light" | "dark" | "system";
type TextSizePreference = "small" | "medium" | "large" | "xlarge";
type AssistantAction = {
  type: "createSprint" | "createTask" | "selectSprint";
  label: string;
  payload: Record<string, unknown>;
};
type AssistantMessage = { role: "assistant" | "user"; content: string; action?: AssistantAction };
type MutationResult = { ok?: boolean; error?: string; workspaceId?: string; sprintId?: string };

const THEME_STORAGE_KEY = "sprintia-theme";
const TEXT_SIZE_STORAGE_KEY = "sprintia-text-size";
const SIDEBAR_WIDTH_STORAGE_KEY = "sprintia-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sprintia-sidebar-collapsed";

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

const isTextSizePreference = (value: string | null): value is TextSizePreference =>
  value === "small" || value === "medium" || value === "large" || value === "xlarge";

function initialThemePreference(): ThemePreference {
  if (typeof document === "undefined") return "dark";
  const value = document.documentElement.dataset.themePreference ?? null;
  return isThemePreference(value) ? value : "dark";
}

function initialTextSizePreference(): TextSizePreference {
  if (typeof document === "undefined") return "large";
  const value = document.documentElement.dataset.textSize ?? null;
  return isTextSizePreference(value) ? value : "large";
}

function applyThemePreference(preference: ThemePreference) {
  const resolved = preference === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", resolved === "dark" ? "#101520" : "#f5f6f8");
}

function applyTextSizePreference(preference: TextSizePreference) {
  document.documentElement.dataset.textSize = preference;
}

function initialSidebarWidth() {
  if (typeof window === "undefined") return 248;
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(saved) ? Math.min(360, Math.max(220, saved)) : 248;
}

function initialSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

const statusMeta: Array<{
  id: Exclude<TaskStatus, "backlog">;
  label: string;
  hint: string;
}> = [
  { id: "todo", label: "Por hacer", hint: "Lista para comenzar" },
  { id: "progress", label: "En curso", hint: "Trabajo activo" },
  { id: "review", label: "En revisión", hint: "Esperando validación" },
  { id: "done", label: "Terminado", hint: "Objetivo cumplido" },
];

const allStatusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Por hacer",
  progress: "En curso",
  review: "En revisión",
  done: "Terminado",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  board: { eyebrow: "Sprint activo", title: "Tablero" },
  backlog: { eyebrow: "Próximamente", title: "Backlog" },
  summary: { eyebrow: "Estado del proyecto", title: "Resumen" },
  team: { eyebrow: "Personas y carga", title: "Equipo" },
  settings: { eyebrow: "Tu experiencia", title: "Configuración" },
};

const APP_NOW = new Date().getTime();

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value.replace(" ", "T") + (value.includes("T") ? "" : "Z")).getTime();
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

function Avatar({ member, size = "normal" }: { member: Pick<Member, "name" | "avatarColor">; size?: "small" | "normal" | "large" }) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ backgroundColor: member.avatarColor }}
      title={member.name}
      aria-label={member.name}
    >
      {initials(member.name)}
    </span>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">✓</span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function AssistantPanel({
  messages,
  input,
  busy,
  closing,
  onInput,
  onSubmit,
  onPrompt,
  onAction,
  onClose,
}: {
  messages: AssistantMessage[];
  input: string;
  busy: boolean;
  closing: boolean;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onPrompt: (value: string) => void;
  onAction: (action: AssistantAction) => void;
  onClose: () => void;
}) {
  const prompts = ["¿Qué hago después?", "Dame un resumen", "Ayúdame a priorizar"];

  return (
    <aside className={`assistant-panel${closing ? " assistant-panel-closing" : ""}`} role="dialog" aria-modal="false" aria-labelledby="assistant-title">
      <header className="assistant-header">
        <div className="assistant-heading">
          <span className="assistant-orb" aria-hidden="true">✦</span>
          <div><strong id="assistant-title">Sprintia Copiloto</strong><small>Tu contexto, en una conversación</small></div>
        </div>
        <button className="assistant-close" onClick={onClose} aria-label="Cerrar copiloto">×</button>
      </header>
      <div className="assistant-messages" aria-live="polite">
        {messages.map((message, index) => (
          <div className={`assistant-message assistant-message-${message.role}`} key={`${message.role}-${index}`}>
            {message.role === "assistant" && <span className="assistant-message-mark" aria-hidden="true">✦</span>}
            <div className="assistant-message-body"><p>{message.content}</p>{message.action && <button className="assistant-action" type="button" onClick={() => onAction(message.action!)} disabled={busy}>Ejecutar · {message.action.label}</button>}</div>
          </div>
        ))}
        {busy && <div className="assistant-message assistant-message-assistant assistant-message-typing"><span className="assistant-message-mark" aria-hidden="true">✦</span><p><i /><i /><i /></p></div>}
      </div>
      <div className="assistant-prompts" aria-label="Sugerencias del copiloto">
        {prompts.map((prompt) => <button key={prompt} type="button" onClick={() => onPrompt(prompt)} disabled={busy}>{prompt}</button>)}
      </div>
      <form className="assistant-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit(); }}>
        <textarea value={input} onChange={(event) => onInput(event.target.value)} placeholder="Escribe un comando o pregunta…" aria-label="Mensaje para Sprintia Copiloto" rows={1} maxLength={1200} />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar mensaje">↑</button>
      </form>
      <small className="assistant-disclaimer">Sugerencias para organizarte. Tú decides qué cambia en el tablero.</small>
    </aside>
  );
}

function ModalShell({ title, subtitle, onClose, children, wide = false }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 240);
  }, [closing, onClose]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [close]);

  return (
    <div className={`modal-backdrop${closing ? " modal-closing" : ""}`} role="presentation" onMouseDown={close}>
      <section
        className={`modal-card${wide ? " modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={close} aria-label="Cerrar ventana">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function LoadingScreen({ user }: { user: AppUser }) {
  return (
    <main className="loading-screen" role="status" aria-live="polite">
      <div className="brand-lockup brand-lockup-large">
        <span className="brand-mark">S</span>
        <span>Sprintia</span>
      </div>
      <div className="loading-orbit" aria-hidden="true"><span /></div>
      <h1>Preparando tu espacio</h1>
      <p>Estamos organizando el tablero de {user.name.split(" ")[0]}.</p>
    </main>
  );
}

export function SprintiaApp({
  user,
  signOutAction,
  initialJoinCode,
}: {
  user: AppUser;
  signOutAction: () => Promise<void>;
  initialJoinCode?: string;
}) {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [view, setView] = useState<View>("board");
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedTask, setSelectedTask] = useState<ScrumTask | null>(null);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TaskPriority>("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const [textSizePreference, setTextSizePreference] = useState<TextSizePreference>(initialTextSizePreference);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantClosing, setAssistantClosing] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    { role: "assistant", content: "Hola, soy tu copiloto de sprint. Puedo ayudarte a priorizar tareas, resumir el avance o preparar un plan." },
  ]);
  const joinedFromLink = useRef(false);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarWidth, sidebarCollapsed]);

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      let current: string | null = null;
      try {
        current = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        current = document.documentElement.dataset.themePreference ?? "system";
      }
      if (!isThemePreference(current) || current === "system") applyThemePreference("system");
    };
    const syncStoredPreferences = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        const nextTheme = isThemePreference(event.newValue) ? event.newValue : "system";
        setThemePreference(nextTheme);
        applyThemePreference(nextTheme);
      }
      if (event.key === TEXT_SIZE_STORAGE_KEY) {
        const nextTextSize = isTextSizePreference(event.newValue) ? event.newValue : "large";
        setTextSizePreference(nextTextSize);
        applyTextSizePreference(nextTextSize);
      }
    };

    colorScheme.addEventListener("change", syncSystemTheme);
    window.addEventListener("storage", syncStoredPreferences);
    return () => {
      colorScheme.removeEventListener("change", syncSystemTheme);
      window.removeEventListener("storage", syncStoredPreferences);
    };
  }, []);

  const changeThemePreference = (preference: ThemePreference) => {
    setThemePreference(preference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Keep the preference active for this session if storage is blocked.
    }
    applyThemePreference(preference);
  };

  const changeTextSizePreference = (preference: TextSizePreference) => {
    setTextSizePreference(preference);
    try {
      window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, preference);
    } catch {
      // Keep the preference active for this session if storage is blocked.
    }
    applyTextSizePreference(preference);
  };

  const load = useCallback(async (workspaceId?: string, quiet = false) => {
    if (!quiet) setError("");
    try {
      const query = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
      const response = await fetch(`/api/bootstrap${query}`, { cache: "no-store" });
      const payload = (await response.json()) as BootstrapData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No pudimos cargar el tablero.");
      setData(payload);
      setSelectedSprintId((current) => {
        if (current && payload.sprints.some((sprint) => sprint.id === current)) return current;
        return payload.sprints.find((sprint) => sprint.status === "active")?.id ?? payload.sprints[0]?.id ?? "";
      });
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "No pudimos cargar el tablero.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && data) void load(data.workspace.id, true);
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [data, load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const mutate = useCallback(async (
    payload: Record<string, unknown>,
    successMessage: string,
    options?: { switchTo?: string },
  ) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as MutationResult;
      if (!response.ok) throw new Error(result.error ?? "No pudimos guardar el cambio.");
      const nextWorkspace = options?.switchTo ?? result.workspaceId ?? data?.workspace.id;
      await load(nextWorkspace);
      setToast(successMessage);
      return result;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "No pudimos guardar el cambio.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [data, load]);

  useEffect(() => {
    if (!data || !initialJoinCode || joinedFromLink.current) return;
    joinedFromLink.current = true;
    void mutate(
      { action: "joinWorkspace", inviteCode: initialJoinCode },
      "Te uniste al equipo correctamente.",
    ).then((ok) => {
      if (ok) window.history.replaceState({}, "", "/");
    });
  }, [data, initialJoinCode, mutate]);

  const activeSprint = data?.sprints.find((sprint) => sprint.id === selectedSprintId) ?? null;
  const sprintTasks = useMemo(() => {
    if (!data) return [];
    return data.tasks.filter((task) => task.sprintId === selectedSprintId);
  }, [data, selectedSprintId]);
  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return sprintTasks.filter((task) => {
      const matchesText = !needle || `${task.code} ${task.title} ${task.description}`.toLocaleLowerCase("es").includes(needle);
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      const matchesAssignee = assigneeFilter === "all" || (assigneeFilter === "none" ? !task.assigneeId : task.assigneeId === assigneeFilter);
      return matchesText && matchesPriority && matchesAssignee;
    });
  }, [assigneeFilter, priorityFilter, search, sprintTasks]);

  if (!data && !error) return <LoadingScreen user={user} />;

  if (!data) {
    return (
      <main className="fatal-state">
        <div className="brand-lockup brand-lockup-large"><span className="brand-mark">S</span><span>Sprintia</span></div>
        <h1>No pudimos abrir tu espacio</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void load()}>Intentar de nuevo</button>
      </main>
    );
  }

  const navigateToView = (nextView: View) => {
    setView(nextView);
    setMobileMenu(false);
  };

  const openNewTask = (status: TaskStatus = "todo") => {
    setSelectedTask({
      id: "",
      workspaceId: data.workspace.id,
      sprintId: status === "backlog" ? null : selectedSprintId,
      code: "Nueva",
      title: "",
      description: "",
      status,
      priority: "medium",
      points: 3,
      assigneeId: user.id,
      assigneeName: user.name,
      assigneeColor: data.members.find((member) => member.id === user.id)?.avatarColor ?? "#6757d9",
      reporterId: user.id,
      sortOrder: data.tasks.length,
      createdAt: "",
      updatedAt: "",
    });
    setModal("task");
  };

  const openTask = (task: ScrumTask) => {
    setSelectedTask(task);
    setModal("task");
  };

  const moveTask = async (task: ScrumTask, status: TaskStatus) => {
    if (task.status === status) return;
    setData((current) => current ? {
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status } : item),
    } : current);
    const ok = await mutate(
      { action: "updateTask", workspaceId: data.workspace.id, id: task.id, status },
      `${task.code} ahora está en ${allStatusLabels[status]}.`,
    );
    if (!ok) await load(data.workspace.id);
  };

  const pageTitle = viewTitles[view];
  const totalPoints = sprintTasks.reduce((sum, task) => sum + task.points, 0);
  const donePoints = sprintTasks.filter((task) => task.status === "done").reduce((sum, task) => sum + task.points, 0);
  const progress = totalPoints ? Math.round((donePoints / totalPoints) * 100) : 0;

  const askAssistant = async (value = assistantInput) => {
    const message = value.trim();
    if (!message || assistantBusy) return;
    setAssistantInput("");
    setAssistantMessages((current) => [...current, { role: "user", content: message }]);
    setAssistantBusy(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          context: {
            workspaceName: data.workspace.name,
            sprintName: activeSprint?.name,
            sprintGoal: activeSprint?.goal,
            sprints: data.sprints.map((sprint) => ({ id: sprint.id, name: sprint.name, status: sprint.status })),
            tasks: sprintTasks.map((task) => ({
              code: task.code,
              title: task.title,
              status: task.status,
              priority: task.priority,
              points: task.points,
            })),
          },
        }),
      });
      const result = await response.json() as { reply?: string; error?: string; source?: string; action?: AssistantAction };
      if (!response.ok) throw new Error(result.error ?? "No pudimos consultar al copiloto.");
      setAssistantMessages((current) => [...current, {
        role: "assistant",
        content: result.reply ?? "No encontré una respuesta para eso.",
        action: result.action,
      }]);
    } catch (assistantError) {
      setAssistantMessages((current) => [...current, {
        role: "assistant",
        content: assistantError instanceof Error ? assistantError.message : "No pudimos consultar al copiloto.",
      }]);
    } finally {
      setAssistantBusy(false);
    }
  };

  const executeAssistantAction = async (action: AssistantAction) => {
    if (action.type === "selectSprint") {
      const sprintId = typeof action.payload.sprintId === "string" ? action.payload.sprintId : "";
      if (!sprintId || !data.sprints.some((sprint) => sprint.id === sprintId)) return;
      setSelectedSprintId(sprintId);
      setAssistantMessages((current) => [...current, { role: "assistant", content: `Listo. Ahora estás viendo ${action.label}.` }]);
      return;
    }

    const result = await mutate({ ...action.payload, action: action.type, workspaceId: data.workspace.id }, `${action.label} creado correctamente.`);
    if (!result) return;
    if (action.type === "createSprint" && result.sprintId) setSelectedSprintId(result.sprintId);
    setAssistantMessages((current) => [...current, { role: "assistant", content: `Listo. ${action.label} ya está en tu espacio.` }]);
  };

  const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarResizing || sidebarCollapsed) return;
    setSidebarWidth(Math.min(360, Math.max(220, event.clientX)));
  };

  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return;
    setSidebarResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const endSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    setSidebarResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const toggleAssistant = () => {
    if (assistantOpen) {
      if (assistantClosing) return;
      setAssistantClosing(true);
      window.setTimeout(() => {
        setAssistantOpen(false);
        setAssistantClosing(false);
      }, 280);
      return;
    }
    setAssistantClosing(false);
    setAssistantOpen(true);
  };

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`} style={{ "--sidebar-width": sidebarCollapsed ? "0px" : `${sidebarWidth}px` } as React.CSSProperties}>
      <aside className={`sidebar${mobileMenu ? " sidebar-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-lockup"><span className="brand-mark">S</span><span>Sprintia</span></div>
          <button className="sidebar-collapse-button" onClick={() => setSidebarCollapsed(true)} aria-label="Ocultar barra lateral" title="Ocultar barra lateral">‹</button>
          <button className="sidebar-close" onClick={() => setMobileMenu(false)} aria-label="Cerrar menú">×</button>
        </div>

        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Ajustar ancho de la barra lateral"
          aria-orientation="vertical"
          onPointerDown={beginSidebarResize}
          onPointerMove={resizeSidebar}
          onPointerUp={endSidebarResize}
          onPointerCancel={endSidebarResize}
        />

        <label className="workspace-picker">
          <span>Espacio de trabajo</span>
          <select
            value={data.workspace.id}
            onChange={(event) => void load(event.target.value)}
            aria-label="Cambiar espacio de trabajo"
          >
            {data.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>

        <nav className="main-nav" aria-label="Navegación principal">
          {([
            ["board", "▦", "Tablero"],
            ["backlog", "≡", "Backlog"],
            ["summary", "↗", "Resumen"],
            ["team", "◉", "Equipo"],
            ["settings", "⚙", "Configuración"],
          ] as Array<[View, string, string]>).map(([id, icon, label]) => (
            <button
              key={id}
              className={view === id ? "nav-active" : ""}
              onClick={() => navigateToView(id)}
            >
              <span aria-hidden="true">{icon}</span>{label}
              {id === "backlog" && <small>{data.tasks.filter((task) => !task.sprintId).length}</small>}
            </button>
          ))}
        </nav>

        <div className="sidebar-project">
          <span className="sidebar-project-label">Proyecto actual</span>
          <strong>{data.workspace.name}</strong>
          <p>{data.members.length} {data.members.length === 1 ? "integrante" : "integrantes"}</p>
          <button onClick={() => setModal("invite")}>+ Invitar al equipo</button>
        </div>

        <div className="sidebar-footer">
          <Avatar member={{ name: user.name, avatarColor: data.members.find((member) => member.id === user.id)?.avatarColor ?? "#6757d9" }} />
          <span><strong>{user.name}</strong><small>{data.workspace.role === "owner" ? "Propietario" : "Miembro"}</small></span>
          <form action={signOutAction}>
            <button className="sidebar-signout" type="submit" aria-label="Cerrar sesión" title="Cerrar sesión">↪</button>
          </form>
        </div>
      </aside>

      {sidebarCollapsed && <button className="sidebar-reopen" onClick={() => setSidebarCollapsed(false)} aria-label="Mostrar barra lateral" title="Mostrar barra lateral">›</button>}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menú">☰</button>
          <div className="page-heading"><span>{pageTitle.eyebrow}</span><h1>{pageTitle.title}</h1></div>
          {view !== "settings" && (
            <div className="topbar-actions">
              <button className="secondary-button hide-mobile" onClick={() => setModal("invite")}>Invitar</button>
              <button className="primary-button" onClick={() => openNewTask(view === "backlog" ? "backlog" : "todo")}><span>+</span> Nueva tarea</button>
            </div>
          )}
        </header>

        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")}>Cerrar</button></div>}

        <div key={view} className={`view-transition view-transition-${view}`}>
          {view === "board" && (
            <BoardView
              sprint={activeSprint}
              sprints={data.sprints}
              selectedSprintId={selectedSprintId}
              onSprintChange={setSelectedSprintId}
              tasks={filteredTasks}
              members={data.members}
              progress={progress}
              donePoints={donePoints}
              totalPoints={totalPoints}
              search={search}
              onSearch={setSearch}
              priorityFilter={priorityFilter}
              onPriorityFilter={setPriorityFilter}
              assigneeFilter={assigneeFilter}
              onAssigneeFilter={setAssigneeFilter}
            onOpenTask={openTask}
            onMoveTask={moveTask}
            onNewTask={openNewTask}
            onNewSprint={() => setModal("sprint")}
            />
          )}
          {view === "backlog" && (
            <BacklogView
              tasks={data.tasks.filter((task) => !task.sprintId || task.status === "backlog")}
              sprint={activeSprint}
              members={data.members}
              onOpenTask={openTask}
              onNewTask={() => openNewTask("backlog")}
              onAddToSprint={(task) => void mutate(
                { action: "updateTask", workspaceId: data.workspace.id, id: task.id, sprintId: activeSprint?.id, status: "todo" },
                `${task.code} se añadió al sprint.`,
              )}
            />
          )}
          {view === "summary" && (
            <SummaryView
              sprint={activeSprint}
              tasks={sprintTasks}
              activities={data.activities}
              progress={progress}
              totalPoints={totalPoints}
              donePoints={donePoints}
              onNewSprint={() => setModal("sprint")}
            />
          )}
          {view === "team" && (
            <TeamView
              members={data.members}
              tasks={sprintTasks}
              inviteCode={data.workspace.inviteCode}
              onInvite={() => setModal("invite")}
            />
          )}
          {view === "settings" && (
            <SettingsView
              themePreference={themePreference}
              textSizePreference={textSizePreference}
              onThemeChange={changeThemePreference}
              onTextSizeChange={changeTextSizePreference}
            />
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {([
          ["board", "▦", "Tablero"],
          ["backlog", "≡", "Backlog"],
          ["summary", "↗", "Resumen"],
          ["team", "◉", "Equipo"],
          ["settings", "⚙", "Ajustes"],
        ] as Array<[View, string, string]>).map(([id, icon, label]) => (
          <button key={id} className={view === id ? "nav-active" : ""} onClick={() => navigateToView(id)}><span aria-hidden="true">{icon}</span>{label}</button>
        ))}
      </nav>

      {modal === "task" && selectedTask && (
        <TaskModal
          task={selectedTask}
          members={data.members}
          sprints={data.sprints}
          busy={busy}
          onClose={() => { setModal(null); setSelectedTask(null); }}
          onSave={async (task) => {
            const isNew = !task.id;
            const ok = await mutate(
              {
                action: isNew ? "createTask" : "updateTask",
                ...task,
                workspaceId: data.workspace.id,
              },
              isNew ? "Tarea creada correctamente." : "Cambios guardados.",
            );
            if (ok) { setModal(null); setSelectedTask(null); }
          }}
          onDelete={selectedTask.id ? async () => {
            const ok = await mutate(
              { action: "deleteTask", workspaceId: data.workspace.id, id: selectedTask.id },
              "Tarea eliminada.",
            );
            if (ok) { setModal(null); setSelectedTask(null); }
          } : undefined}
        />
      )}
      {modal === "invite" && (
        <InviteModal workspaceName={data.workspace.name} inviteCode={data.workspace.inviteCode} onClose={() => setModal(null)} />
      )}
      {modal === "workspace" && (
        <WorkspaceModal busy={busy} onClose={() => setModal(null)} onSubmit={async (mode, value) => {
          const ok = await mutate(
            mode === "create" ? { action: "createWorkspace", name: value } : { action: "joinWorkspace", inviteCode: value },
            mode === "create" ? "Proyecto creado." : "Te uniste al proyecto.",
          );
          if (ok) setModal(null);
        }} />
      )}
      {modal === "sprint" && (
        <SprintModal busy={busy} onClose={() => setModal(null)} onSubmit={async (payload) => {
          const result = await mutate({ action: "createSprint", workspaceId: data.workspace.id, ...payload }, "Sprint creado correctamente.");
          if (result) {
            if (result.sprintId) setSelectedSprintId(result.sprintId);
            setModal(null);
          }
        }} />
      )}

      {assistantOpen && (
        <AssistantPanel
          messages={assistantMessages}
          input={assistantInput}
          busy={assistantBusy}
          closing={assistantClosing}
          onInput={setAssistantInput}
          onSubmit={() => void askAssistant()}
          onPrompt={(prompt) => void askAssistant(prompt)}
          onAction={(action) => void executeAssistantAction(action)}
          onClose={toggleAssistant}
        />
      )}
      <button
        className={`assistant-launcher${assistantOpen ? " assistant-launcher-open" : ""}`}
        onClick={toggleAssistant}
        aria-label={assistantOpen ? "Cerrar copiloto" : "Abrir copiloto de Sprintia"}
        title="Sprintia Copiloto"
      >
        <span aria-hidden="true">✦</span><small>Copiloto</small>
      </button>
      <button className="workspace-fab" onClick={() => setModal("workspace")} aria-label="Crear o unirse a otro proyecto" title="Cambiar de proyecto">＋</button>
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
      {busy && <div className="saving-indicator" role="status">Guardando…</div>}
    </div>
  );
}

function BoardView({
  sprint,
  sprints,
  selectedSprintId,
  onSprintChange,
  tasks,
  members,
  progress,
  donePoints,
  totalPoints,
  search,
  onSearch,
  priorityFilter,
  onPriorityFilter,
  assigneeFilter,
  onAssigneeFilter,
  onOpenTask,
  onMoveTask,
  onNewTask,
  onNewSprint,
}: {
  sprint: Sprint | null;
  sprints: Sprint[];
  selectedSprintId: string;
  onSprintChange: (id: string) => void;
  tasks: ScrumTask[];
  members: Member[];
  progress: number;
  donePoints: number;
  totalPoints: number;
  search: string;
  onSearch: (value: string) => void;
  priorityFilter: "all" | TaskPriority;
  onPriorityFilter: (value: "all" | TaskPriority) => void;
  assigneeFilter: string;
  onAssigneeFilter: (value: string) => void;
  onOpenTask: (task: ScrumTask) => void;
  onMoveTask: (task: ScrumTask, status: TaskStatus) => void;
  onNewTask: (status: TaskStatus) => void;
  onNewSprint: () => void;
}) {
  if (!sprint) {
    return <div className="content-pad"><EmptyState title="Todavía no hay un sprint" body="Crea tu primer sprint para comenzar a trabajar." action={<button className="primary-button" onClick={onNewSprint} type="button">+ Crear sprint</button>} /></div>;
  }

  const daysLeft = Math.max(0, Math.ceil((new Date(`${sprint.endDate}T23:59:59`).getTime() - APP_NOW) / 86_400_000));

  return (
    <div className="board-page">
      <section className="sprint-strip">
        <div className="sprint-main">
          <label>
            <span>Sprint</span>
            <select value={selectedSprintId} onChange={(event) => onSprintChange(event.target.value)}>
              {sprints.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="sprint-goal"><span>Objetivo</span><strong>{sprint.goal || "Sin objetivo definido"}</strong></div>
          <button className="sprint-add-button" onClick={onNewSprint} type="button">+ Sprint</button>
        </div>
        <div className="sprint-metrics">
          <div><strong>{daysLeft}</strong><span>días restantes</span></div>
          <div><strong>{donePoints}<small>/{totalPoints}</small></strong><span>puntos listos</span></div>
          <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><span>{progress}%</span></div>
        </div>
      </section>

      <section className="board-toolbar" aria-label="Filtros del tablero">
        <label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por título o código…" aria-label="Buscar tareas" /></label>
        <select value={priorityFilter} onChange={(event) => onPriorityFilter(event.target.value as "all" | TaskPriority)} aria-label="Filtrar por prioridad">
          <option value="all">Todas las prioridades</option>
          <option value="urgent">Urgente</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option>
        </select>
        <select value={assigneeFilter} onChange={(event) => onAssigneeFilter(event.target.value)} aria-label="Filtrar por responsable">
          <option value="all">Todo el equipo</option><option value="none">Sin asignar</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <span className="result-count">{tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}</span>
      </section>

      <section className="kanban" aria-label="Tablero Scrum">
        {statusMeta.map((column) => {
          const columnTasks = tasks.filter((task) => task.status === column.id);
          const points = columnTasks.reduce((sum, task) => sum + task.points, 0);
          return (
            <div
              className={`kanban-column column-${column.id}`}
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const task = tasks.find((item) => item.id === event.dataTransfer.getData("text/task-id"));
                if (task) void onMoveTask(task, column.id);
              }}
            >
              <div className="column-heading">
                <div><span className="status-dot" /><strong>{column.label}</strong><small>{columnTasks.length}</small></div>
                <span>{points} pts</span>
              </div>
              <p className="column-hint">{column.hint}</p>
              <div className="task-stack">
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={() => onOpenTask(task)} onMove={(status) => onMoveTask(task, status)} />
                ))}
                {columnTasks.length === 0 && <div className="column-empty">Suelta una tarea aquí</div>}
              </div>
              <button className="add-card-button" onClick={() => onNewTask(column.id)}>+ Añadir tarea</button>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function TaskCard({ task, onOpen, onMove }: { task: ScrumTask; onOpen: () => void; onMove: (status: TaskStatus) => void }) {
  return (
    <article
      className="task-card"
      draggable
      tabIndex={0}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/task-id", task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}
      aria-label={`${task.code}: ${task.title}`}
    >
      <div className="task-card-top"><span>{task.code}</span><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span></div>
      <h3>{task.title}</h3>
      {task.description && <p>{task.description}</p>}
      <div className="task-card-footer">
        <span className="story-points" title={`${task.points} puntos`}>{task.points}</span>
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onMove(event.target.value as TaskStatus)}
          aria-label={`Mover ${task.code}`}
        >
          {statusMeta.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
        </select>
        {task.assigneeName ? (
          <Avatar size="small" member={{ name: task.assigneeName, avatarColor: task.assigneeColor ?? "#8791a5" }} />
        ) : <span className="avatar avatar-small avatar-empty" title="Sin asignar">?</span>}
      </div>
    </article>
  );
}

function BacklogView({ tasks, sprint, members, onOpenTask, onNewTask, onAddToSprint }: {
  tasks: ScrumTask[];
  sprint: Sprint | null;
  members: Member[];
  onOpenTask: (task: ScrumTask) => void;
  onNewTask: () => void;
  onAddToSprint: (task: ScrumTask) => void;
}) {
  const total = tasks.reduce((sum, task) => sum + task.points, 0);
  return (
    <div className="content-pad content-narrow">
      <section className="section-intro">
        <div><span className="section-kicker">Ideas por priorizar</span><h2>Backlog del producto</h2><p>Ordena las próximas historias y llévalas al sprint cuando estén listas.</p></div>
        <button className="primary-button" onClick={onNewTask}>+ Añadir al backlog</button>
      </section>
      <div className="backlog-summary"><span><strong>{tasks.length}</strong> elementos pendientes</span><span><strong>{total}</strong> puntos estimados</span><span><strong>{members.length}</strong> integrantes disponibles</span></div>
      <section className="backlog-list">
        <div className="backlog-list-header"><span>Historia o tarea</span><span>Prioridad</span><span>Puntos</span><span>Responsable</span><span /></div>
        {tasks.map((task) => (
          <article className="backlog-row" key={task.id} onClick={() => onOpenTask(task)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpenTask(task)}>
            <div><span className="backlog-code">{task.code}</span><strong>{task.title}</strong><small>{task.description || "Sin descripción"}</small></div>
            <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
            <span className="story-points">{task.points}</span>
            <span>{task.assigneeName ?? "Sin asignar"}</span>
            <button className="secondary-button small-button" disabled={!sprint} onClick={(event) => { event.stopPropagation(); onAddToSprint(task); }}>Añadir al sprint</button>
          </article>
        ))}
        {tasks.length === 0 && <EmptyState title="Backlog despejado" body="Todas las ideas ya están en un sprint. Añade una nueva cuando surja." action={<button className="secondary-button" onClick={onNewTask}>Crear tarea</button>} />}
      </section>
    </div>
  );
}

function SummaryView({ sprint, tasks, activities, progress, totalPoints, donePoints, onNewSprint }: {
  sprint: Sprint | null;
  tasks: ScrumTask[];
  activities: BootstrapData["activities"];
  progress: number;
  totalPoints: number;
  donePoints: number;
  onNewSprint: () => void;
}) {
  const counts = statusMeta.map((status) => ({ ...status, count: tasks.filter((task) => task.status === status.id).length }));
  const maxCount = Math.max(1, ...counts.map((item) => item.count));
  const days = sprint ? Math.max(1, Math.ceil((new Date(`${sprint.endDate}T23:59:59`).getTime() - new Date(`${sprint.startDate}T00:00:00`).getTime()) / 86_400_000)) : 0;
  const elapsed = sprint ? Math.min(days, Math.max(0, Math.ceil((APP_NOW - new Date(`${sprint.startDate}T00:00:00`).getTime()) / 86_400_000))) : 0;

  return (
    <div className="content-pad content-narrow summary-page">
      <section className="section-intro">
        <div><span className="section-kicker">{sprint?.name ?? "Sin sprint"}</span><h2>Así avanza el equipo</h2><p>{sprint?.goal ?? "Crea un sprint para comenzar a medir el progreso."}</p></div>
        <button className="secondary-button" onClick={onNewSprint}>+ Nuevo sprint</button>
      </section>
      <section className="metric-grid">
        <article><span>Progreso</span><strong>{progress}%</strong><div className="mini-progress"><i style={{ width: `${progress}%` }} /></div><small>{donePoints} de {totalPoints} puntos</small></article>
        <article><span>Tareas listas</span><strong>{tasks.filter((task) => task.status === "done").length}<small>/{tasks.length}</small></strong><p>del sprint actual</p></article>
        <article><span>Tiempo</span><strong>{elapsed}<small>/{days}</small></strong><p>días transcurridos</p></article>
        <article><span>En revisión</span><strong>{tasks.filter((task) => task.status === "review").length}</strong><p>esperando validación</p></article>
      </section>
      <section className="summary-grid">
        <article className="panel status-panel">
          <div className="panel-heading"><div><span>Distribución</span><h3>Tareas por estado</h3></div><span>{tasks.length} total</span></div>
          <div className="bar-chart">
            {counts.map((item) => (
              <div key={item.id}><div className="bar-track"><i className={`bar-${item.id}`} style={{ height: `${Math.max(8, (item.count / maxCount) * 100)}%` }}><span>{item.count}</span></i></div><small>{item.label.replace("Por hacer", "Pendiente").replace("En curso", "Curso").replace("En revisión", "Revisión").replace("Terminado", "Listo")}</small></div>
            ))}
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-heading"><div><span>Últimos cambios</span><h3>Actividad del equipo</h3></div><span className="live-pill">En vivo</span></div>
          <div className="activity-list">
            {activities.slice(0, 6).map((activity) => (
              <div key={activity.id}><Avatar size="small" member={{ name: activity.userName, avatarColor: activity.avatarColor }} /><p><strong>{activity.userName}</strong> {activity.message}<small>{relativeTime(activity.createdAt)}</small></p></div>
            ))}
            {activities.length === 0 && <p className="muted-copy">La actividad aparecerá cuando el equipo haga cambios.</p>}
          </div>
        </article>
      </section>
    </div>
  );
}

function TeamView({ members, tasks, inviteCode, onInvite }: { members: Member[]; tasks: ScrumTask[]; inviteCode: string; onInvite: () => void }) {
  const totalPoints = tasks.reduce((sum, task) => sum + task.points, 0);
  return (
    <div className="content-pad content-narrow">
      <section className="section-intro">
        <div><span className="section-kicker">{members.length} {members.length === 1 ? "persona" : "personas"}</span><h2>Tu equipo Scrum</h2><p>Revisa responsabilidades y distribuye el trabajo del sprint.</p></div>
        <button className="primary-button" onClick={onInvite}>+ Invitar integrante</button>
      </section>
      <section className="team-layout">
        <div className="team-list">
          {members.map((member) => {
            const assigned = tasks.filter((task) => task.assigneeId === member.id && task.status !== "done");
            const points = assigned.reduce((sum, task) => sum + task.points, 0);
            const percentage = totalPoints ? Math.min(100, Math.round((points / totalPoints) * 100 * members.length)) : 0;
            return (
              <article className="member-card" key={member.id}>
                <Avatar size="large" member={member} />
                <div className="member-info"><strong>{member.name}</strong><span>{member.email}</span><small>{member.role === "owner" ? "Propietario · Scrum Master" : "Miembro del equipo"}</small></div>
                <div className="member-work"><span><strong>{assigned.length}</strong> tareas activas</span><span><strong>{points}</strong> puntos</span><div className="mini-progress"><i style={{ width: `${percentage}%` }} /></div></div>
              </article>
            );
          })}
        </div>
        <aside className="invite-card">
          <span className="invite-symbol" aria-hidden="true">＋</span><span>Haz crecer el equipo</span><h3>Invita a tus compañeros</h3><p>Comparte el código para que todos trabajen sobre el mismo tablero.</p><code>{inviteCode}</code><button className="secondary-button" onClick={onInvite}>Compartir invitación</button>
        </aside>
      </section>
    </div>
  );
}

function SettingsView({
  themePreference,
  textSizePreference,
  onThemeChange,
  onTextSizeChange,
}: {
  themePreference: ThemePreference;
  textSizePreference: TextSizePreference;
  onThemeChange: (preference: ThemePreference) => void;
  onTextSizeChange: (preference: TextSizePreference) => void;
}) {
  const themeOptions: Array<{ id: ThemePreference; icon: string; label: string; detail: string }> = [
    { id: "light", icon: "☀", label: "Claro", detail: "Fondo luminoso y limpio" },
    { id: "dark", icon: "◐", label: "Oscuro", detail: "Menos brillo en la pantalla" },
    { id: "system", icon: "◑", label: "Sistema", detail: "Sigue tu dispositivo" },
  ];
  const textSizeOptions: Array<{ id: TextSizePreference; label: string; detail: string; sample: string }> = [
    { id: "small", label: "Pequeño", detail: "Más contenido visible", sample: "Aa" },
    { id: "medium", label: "Medio", detail: "Más compacto", sample: "Aa" },
    { id: "large", label: "Grande", detail: "Predeterminado y cómodo", sample: "Aa" },
    { id: "xlarge", label: "Muy grande", detail: "Máxima legibilidad", sample: "Aa" },
  ];

  return (
    <div className="content-pad content-narrow settings-page">
      <section className="section-intro settings-intro">
        <div>
          <span className="section-kicker">Preferencias personales</span>
          <h2>Haz que Sprintia se sienta tuyo</h2>
          <p>Estos cambios se guardan únicamente en este dispositivo y no afectan al resto del equipo.</p>
        </div>
        <span className="local-preference-pill"><span aria-hidden="true">✓</span> Guardado automático</span>
      </section>

      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="theme-settings-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">◒</span>
            <div><h3 id="theme-settings-title">Apariencia</h3><p>Elige cómo se muestran fondos, tarjetas y controles.</p></div>
          </div>
          <fieldset className="preference-fieldset">
            <legend>Tema de color</legend>
            <div className="preference-options preference-options-theme">
              {themeOptions.map((option) => (
                <label className="preference-option" key={option.id}>
                  <input
                    type="radio"
                    name="theme-preference"
                    value={option.id}
                    checked={themePreference === option.id}
                    onChange={() => onThemeChange(option.id)}
                  />
                  <span className="preference-option-body">
                    <span className={`preference-sample theme-sample theme-sample-${option.id}`} aria-hidden="true">{option.icon}</span>
                    <span className="preference-copy"><strong>{option.label}</strong><small>{option.detail}</small></span>
                    <span className="preference-check" aria-hidden="true">✓</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="settings-card" aria-labelledby="text-settings-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">Aa</span>
            <div><h3 id="text-settings-title">Tamaño de texto</h3><p>Ajusta la escala para leer y trabajar con comodidad.</p></div>
          </div>
          <fieldset className="preference-fieldset">
            <legend>Escala de lectura</legend>
            <div className="preference-options preference-options-size">
              {textSizeOptions.map((option) => (
                <label className="preference-option" key={option.id}>
                  <input
                    type="radio"
                    name="text-size-preference"
                    value={option.id}
                    checked={textSizePreference === option.id}
                    onChange={() => onTextSizeChange(option.id)}
                  />
                  <span className="preference-option-body">
                    <span className={`preference-sample text-sample text-sample-${option.id}`} aria-hidden="true">{option.sample}</span>
                    <span className="preference-copy"><strong>{option.label}</strong><small>{option.detail}</small></span>
                    <span className="preference-check" aria-hidden="true">✓</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      </div>

      <section className="settings-preview" aria-labelledby="settings-preview-title">
        <div className="settings-preview-copy">
          <span className="section-kicker">Vista previa</span>
          <h3 id="settings-preview-title">Así se verá tu tablero</h3>
          <p>La preferencia se aplica al instante en todas las vistas de Sprintia.</p>
        </div>
        <article className="settings-preview-task">
          <div><span>UNI-24</span><span className="priority priority-medium">Media</span></div>
          <strong>Preparar la presentación del sprint</strong>
          <p>Revisar avances y organizar los entregables con el equipo.</p>
          <footer><span>5 puntos</span><span className="preview-avatar-mini" aria-hidden="true">AM</span></footer>
        </article>
      </section>
    </div>
  );
}

function TaskModal({ task, members, sprints, busy, onClose, onSave, onDelete }: {
  task: ScrumTask;
  members: Member[];
  sprints: Sprint[];
  busy: boolean;
  onClose: () => void;
  onSave: (task: ScrumTask) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState(task);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = <K extends keyof ScrumTask>(key: K, value: ScrumTask[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave(form); };
  return (
    <ModalShell title={task.id ? task.code : "Nueva tarea"} subtitle={task.id ? "Actualiza la información y guarda los cambios." : "Añade una tarea clara y fácil de completar."} onClose={onClose} wide>
      <form className="task-form" onSubmit={submit}>
        <label className="field field-full"><span>Título</span><input autoFocus value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Ej. Preparar encuesta para usuarios" maxLength={160} required /></label>
        <label className="field field-full"><span>Descripción</span><textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Añade el contexto y los criterios para considerarla terminada…" rows={5} maxLength={1200} /></label>
        <label className="field"><span>Estado</span><select value={form.status} onChange={(event) => { const status = event.target.value as TaskStatus; setForm((current) => ({ ...current, status, sprintId: status === "backlog" ? null : current.sprintId })); }}><option value="backlog">Backlog</option>{statusMeta.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label>
        <label className="field"><span>Prioridad</span><select value={form.priority} onChange={(event) => update("priority", event.target.value as TaskPriority)}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
        <label className="field"><span>Puntos</span><select value={form.points} onChange={(event) => update("points", Number(event.target.value))}>{[1, 2, 3, 5, 8, 13].map((point) => <option key={point} value={point}>{point} {point === 1 ? "punto" : "puntos"}</option>)}</select></label>
        <label className="field"><span>Responsable</span><select value={form.assigneeId ?? ""} onChange={(event) => update("assigneeId", event.target.value || null)}><option value="">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="field field-full"><span>Sprint</span><select value={form.sprintId ?? ""} onChange={(event) => { const sprintId = event.target.value || null; setForm((current) => ({ ...current, sprintId, status: sprintId ? (current.status === "backlog" ? "todo" : current.status) : "backlog" })); }}><option value="">Backlog del producto</option>{sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status === "active" ? "Activo" : sprint.status === "planned" ? "Planeado" : "Finalizado"}</option>)}</select></label>
        <div className="modal-actions field-full">
          {onDelete && (confirmDelete ? <span className="delete-confirm">¿Eliminar? <button type="button" onClick={() => void onDelete()} disabled={busy}>Sí, eliminar</button><button type="button" onClick={() => setConfirmDelete(false)}>No</button></span> : <button className="danger-link" type="button" onClick={() => setConfirmDelete(true)}>Eliminar tarea</button>)}
          <span className="modal-action-spacer" />
          <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={busy || !form.title.trim()}>{busy ? "Guardando…" : task.id ? "Guardar cambios" : "Crear tarea"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function InviteModal({ workspaceName, inviteCode, onClose }: { workspaceName: string; inviteCode: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?join=${inviteCode}`;
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  return (
    <ModalShell title="Invitar al equipo" subtitle={`Comparte el acceso a “${workspaceName}”.`} onClose={onClose}>
      <div className="invite-modal-body"><div className="invite-note"><span>i</span><p>Cualquier persona con una cuenta de Google y este enlace podrá unirse como miembro.</p></div><label className="field"><span>Código de invitación</span><div className="copy-field"><code>{inviteCode}</code><button type="button" onClick={() => void copy(inviteCode)}>{copied ? "Copiado" : "Copiar"}</button></div></label><label className="field"><span>Enlace directo</span><div className="copy-field copy-link"><input readOnly value={link} /><button type="button" onClick={() => void copy(link)}>{copied ? "Copiado" : "Copiar"}</button></div></label><div className="modal-actions"><span className="modal-action-spacer" /><button className="primary-button" type="button" onClick={onClose}>Listo</button></div></div>
    </ModalShell>
  );
}

function WorkspaceModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (mode: "create" | "join", value: string) => Promise<void> }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [value, setValue] = useState("");
  return (
    <ModalShell title="Otro proyecto" subtitle="Crea un espacio nuevo o únete al tablero de tu equipo." onClose={onClose}>
      <div className="segmented"><button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setValue(""); }}>Crear proyecto</button><button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setValue(""); }}>Unirme con código</button></div>
      <form className="simple-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(mode, value); }}><label className="field"><span>{mode === "create" ? "Nombre del proyecto" : "Código de invitación"}</span><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={mode === "create" ? "Ej. Aplicación de tutorías" : "Ej. A1B2C3D4"} maxLength={mode === "create" ? 80 : 20} pattern={mode === "join" ? "[A-Za-z0-9]{8,20}" : undefined} required /></label><div className="modal-actions"><span className="modal-action-spacer" /><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || !value.trim()}>{busy ? "Guardando…" : mode === "create" ? "Crear proyecto" : "Unirme"}</button></div></form>
    </ModalShell>
  );
}

function SprintModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (payload: { name: string; goal: string; startDate: string; endDate: string }) => Promise<void> }) {
  const today = new Date(APP_NOW).toISOString().slice(0, 10);
  const end = new Date(APP_NOW + 13 * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ name: "Sprint 2", goal: "", startDate: today, endDate: end });
  return (
    <ModalShell title="Crear sprint" subtitle="Define una meta corta y un periodo alcanzable." onClose={onClose}>
      <form className="simple-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(form); }}><label className="field"><span>Nombre</span><input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required /></label><label className="field"><span>Objetivo</span><textarea value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} rows={3} placeholder="¿Qué resultado concreto entregará el equipo?" maxLength={300} /></label><div className="form-row"><label className="field"><span>Inicio</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label><label className="field"><span>Fin</span><input type="date" value={form.endDate} min={form.startDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required /></label></div><div className="modal-actions"><span className="modal-action-spacer" /><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || !form.name.trim()}>{busy ? "Creando…" : "Crear sprint"}</button></div></form>
    </ModalShell>
  );
}
