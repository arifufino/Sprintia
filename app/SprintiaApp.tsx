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
  Workspace,
} from "./lib/types";

import { AppShell, type View } from "./components/AppShell";
import { BoardToolbar, SprintOverview } from "./components/BoardHeader";
import boardStyles from "./components/BoardLayout.module.css";
import { DialogLifecycle, ModalShell } from "./components/ModalShell";
import { useDisclosure, useExitMotion, useOverlayLayer, type Disclosure } from "./components/overlay";
import { useWorkspaceNavigation } from "./components/useWorkspaceNavigation";
import { NavigationError } from "./components/NavigationError";
import { defaultNavigation } from "./lib/navigation";
import { accessLabels, canManageAccess, canManageProject, scrumLabels } from "./lib/permissions";
import { InviteModal, MemberAccessModal, ScrumConfigurationModal, ScrumSettings } from "./components/ScrumGovernance";
import governanceStyles from "./components/ScrumGovernance.module.css";
import { TaskModal } from "./components/TaskModal";
import { BacklogView } from "./components/BacklogView";
import { SprintPlanModal, SprintPlanStatus, StartSprintModal } from "./components/SprintPlanning";
import { EndSprintModal, isFinishedSprint, SprintArchive, SprintHistoryModal, SprintLifecycleActions } from "./components/SprintLifecycle";
import { DailyView, localDay } from "./components/DailyView";
import { ReviewView } from "./components/ReviewView";
import { RetroView } from "./components/RetroView";
import { ReportsView } from "./components/ReportsView";
import { ProjectData } from "./components/ProjectData";
import { persistPendingTask, readPendingTask, settlePendingTask, taskDraftKey, type PendingChange } from "./lib/task-drafts";
type Modal = "task" | "invite" | "workspace" | "sprint" | "planSprint" | "startSprint" | "closeSprint" | "cancelSprint" | "sprintHistory" | "scrum" | "access" | null;
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
  themeColor?.setAttribute("content", resolved === "dark" ? "#242931" : "#e9edf2");
}

function applyTextSizePreference(preference: TextSizePreference) {
  document.documentElement.dataset.textSize = preference;
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
  backlog: { eyebrow: "Producto", title: "Backlog" },
  daily: { eyebrow: "Inspección y adaptación", title: "Daily" },
  review: { eyebrow: "Resultado y aprendizaje", title: "Review" },
  retro: { eyebrow: "Aprendizaje y mejora continua", title: "Retrospectiva" },
  reports: { eyebrow: "Evolución y contexto del equipo", title: "Informes" },
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
  state,
  onInput,
  onSubmit,
  onPrompt,
  onAction,
  onClose,
}: {
  messages: AssistantMessage[];
  input: string;
  busy: boolean;
  state: Disclosure<boolean>;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onPrompt: (value: string) => void;
  onAction: (action: AssistantAction) => void;
  onClose: () => void;
}) {
  const prompts = ["¿Qué hago después?", "Dame un resumen", "Ayúdame a priorizar"];
  const ref = useRef<HTMLElement>(null);
  useExitMotion(ref, state.closing, state.finish);
  useOverlayLayer({ ref, modal: false, origin: state.origin, onClose });

  return (
    <aside ref={ref} className="assistant-panel assistant-soft" inert={state.closing} data-motion={state.closing ? "closing" : "open"} role="dialog" aria-modal="false" aria-labelledby="assistant-title">
      <header className="assistant-header">
        <div className="assistant-heading">
          <span className="assistant-orb" aria-hidden="true">✦</span>
          <div><strong id="assistant-title">Sprintia Copiloto</strong><small>Tu contexto, en una conversación</small></div>
        </div>
        <button className="assistant-close" onClick={onClose} aria-label="Cerrar copiloto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
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
  const navigation = useWorkspaceNavigation();
  const { data, setData, route } = navigation;
  const { view, search, priority: priorityFilter, assignee: assigneeFilter } = route;
  const selectedSprintId = route.sprint ?? "";
  const modalState = useDisclosure<Exclude<Modal, null>>();
  const modal = modalState.value;
  const setModal = modalState.open;
  const [selectedTask, setSelectedTask] = useState<ScrumTask | null>(null);
  const [confirmedTaskId, setConfirmedTaskId] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const pendingChange = useRef<PendingChange | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const closingLinkedTask = useRef<string | undefined>(undefined);
  const historyWaiters = useRef<Array<() => void>>([]);
  const closeModal = () => {
    if (mutationPending.current) return;
    if (route.task) { closingLinkedTask.current = route.task; navigation.closeTask(); }
    modalState.close();
  };
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const [textSizePreference, setTextSizePreference] = useState<TextSizePreference>(initialTextSizePreference);
  const assistantState = useDisclosure<boolean>();
  const assistantOpen = assistantState.value !== null;
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    { role: "assistant", content: "Hola, soy tu copiloto de sprint. Puedo ayudarte a priorizar tareas, resumir el avance o preparar un plan." },
  ]);
  const joinedFromLink = useRef(false);


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

  const { go, update, refresh, pauseSync, current: navigationCurrent, beforeHistoryChange, historyChanging } = navigation;
  useEffect(() => {
    const restored = readPendingTask(user.id);
    if (restored && !pendingChange.current) {
      pendingChange.current = restored;
      setUncertain(true);
      pauseSync(true);
      setError("Se recuperó un cambio sin confirmar de esta pestaña. Reinténtalo para comprobar su resultado sin duplicarlo.");
    }
  }, [user.id, pauseSync]);
  const setSelectedSprintId = (sprint: string) => { void update({ sprint }); };

  useEffect(() => {
    beforeHistoryChange.current = () => {
      if (!modal) return Promise.resolve();
      return new Promise<void>((resolve) => {
        historyWaiters.current.push(resolve);
        if (!mutationPending.current) modalState.close();
      });
    };
    if (!busy && historyWaiters.current.length) modalState.close();
    if (!modal) historyWaiters.current.splice(0).forEach((resolve) => resolve());
    return () => { beforeHistoryChange.current = null; };
  }, [beforeHistoryChange, busy, modal, modalState.close]);

  useEffect(() => {
    if (closingLinkedTask.current !== route.task) closingLinkedTask.current = undefined;
    if (historyChanging) return;
    if (!data) {
      // Revoked access must remove stale details, even if a dialog was open.
      if (modal) { modalState.close(); modalState.finish(); }
      return;
    }
    const task = data.tasks.find((item) => item.id === route.task);
    if (task && closingLinkedTask.current !== task.id) {
      if (!modal) { setSelectedTask(task); setConfirmedTaskId(null); modalState.open("task"); }
      else if (modal !== "task" || selectedTask?.id !== task.id) modalState.close();
    } else if (!route.task && modal === "task" && selectedTask?.id && !busy) modalState.close();
  }, [data, route.task, historyChanging, busy, modal, selectedTask?.id, modalState.open, modalState.close, modalState.finish]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain]);

  const mutate = useCallback(async (
    payload: Record<string, unknown>,
    successMessage: string,
    options?: PendingChange["options"],
  ) => {
    if (mutationPending.current) return false;
    if (pendingChange.current && JSON.stringify(pendingChange.current.payload) !== JSON.stringify(payload)) {
      setError("Hay un cambio sin confirmar. Reinténtalo antes de enviar otro; tu borrador sigue aquí.");
      return false;
    }
    const intent = pendingChange.current ?? { payload, message: successMessage, options, mutationId: crypto.randomUUID(), workspaceId: data?.workspace.id };
    pendingChange.current = intent;
    persistPendingTask(user.id, intent);
    mutationPending.current = true;
    setConfirmedTaskId(null);
    pauseSync(true);
    setBusy(true);
    setError("");
    let confirmed = false;
    let saved = false;
    try {
      const response = await fetch("/api/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...intent.payload, mutationId: intent.mutationId }),
      });
      // 4xx is a definite rejection. A lost/invalid response or 5xx is uncertain:
      // preserve the exact intent and key until the server confirms its outcome.
      if (response.status >= 400 && response.status < 500) confirmed = true;
      const result = (await response.json()) as MutationResult;
      if (!response.ok) {
        if ((response.status === 409 || response.status === 403 || response.status === 400)
          && navigationCurrent.current.route.workspace === intent.workspaceId) await refresh();
        throw new Error(result.error ?? "No pudimos guardar el cambio.");
      }
      if (result.ok !== true) throw new Error("La respuesta del servidor no confirma el cambio.");
      confirmed = true;
      saved = true;
      settlePendingTask(user.id, intent, true);
      // A refresh of our own acknowledged edit/removal is not a remote conflict.
      if (["updateTask", "deleteTask"].includes(String(intent.payload.action))) setConfirmedTaskId(String(intent.payload.id));
      const nextWorkspace = intent.options?.switchTo ?? result.workspaceId ?? intent.workspaceId;
      // A late save/refresh must never navigate away from a newer project selection.
      if (navigationCurrent.current.route.workspace === intent.workspaceId) {
        if (nextWorkspace && nextWorkspace !== intent.workspaceId) await go({ ...defaultNavigation, workspace: nextWorkspace }, "push", false, true);
        else await refresh(payload.action === "deleteTask" && payload.id === navigationCurrent.current.route.task ? { task: undefined } : undefined);
      }
      setToast(intent.message);
      return result;
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : "No pudimos guardar el cambio.";
      setError(confirmed ? message : `${message} No pudimos confirmar el resultado. Reintenta el cambio pendiente sin duplicarlo.`);
      return false;
    } finally {
      mutationPending.current = false;
      if (confirmed) pendingChange.current = null;
      if (confirmed && !saved) settlePendingTask(user.id, intent, false);
      setUncertain(!confirmed);
      pauseSync(!confirmed);
      setBusy(false);
    }
  }, [data, go, navigationCurrent, refresh, pauseSync, user.id]);

  useEffect(() => {
    if (!data || !initialJoinCode || joinedFromLink.current) return;
    joinedFromLink.current = true;
    void mutate(
      { action: "joinWorkspace", inviteCode: initialJoinCode },
      "Te uniste al equipo correctamente.",
    );
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

  if (navigation.problem) return <NavigationError problem={navigation.problem}
    onRetry={() => void refresh()} onHome={() => void go({ ...defaultNavigation })}
    onProject={route.workspace && ["task", "sprint"].includes(navigation.problem) ? () => void go({ ...defaultNavigation, workspace: route.workspace }) : undefined} />;
  if (!data) return <LoadingScreen user={user} />;

  const navigateToView = (nextView: View) => {
    void update({ view: nextView, task: undefined });
  };

  const openNewTask = (status: TaskStatus = "todo") => {
    if (isFinishedSprint(activeSprint)) status = "backlog";
    setSelectedTask({
      impediment: null, discussionRevision: 0,
      revision: 0,
      id: "",
      workspaceId: data.workspace.id,
      sprintId: status === "backlog" ? null : selectedSprintId,
      code: "Nueva",
      title: "",
      description: "",
      acceptanceCriteria: [],
      checklist: [],
      status,
      priority: "medium",
      points: null,
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
    void update({ task: task.id });
  };

  const moveTask = async (task: ScrumTask, status: TaskStatus) => {
    if (task.status === status || mutationPending.current || pendingChange.current) return;
    pauseSync(true);
    setData((current) => current ? {
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status } : item),
    } : current);
    const ok = await mutate(
      { action: "updateTask", workspaceId: data.workspace.id, id: task.id, revision: task.revision, status },
      `${task.code} ahora está en ${allStatusLabels[status]}.`,
    );
    if (!ok && navigationCurrent.current.route.workspace === data.workspace.id) {
      setData((current) => current ? { ...current, tasks: current.tasks.map((item) => item.id === task.id && item.revision === task.revision ? task : item) } : current);
      await refresh();
    }
  };

  const pageTitle = viewTitles[view];
  const totalPoints = sprintTasks.reduce((sum, task) => sum + (task.points ?? 0), 0);
  const donePoints = sprintTasks.filter((task) => task.status === "done").reduce((sum, task) => sum + (task.points ?? 0), 0);
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

  const toggleAssistant = () => {
    if (assistantOpen) assistantState.close();
    else assistantState.open(true);
  };

  const retryChange = async () => {
    const intent = pendingChange.current;
    if (!intent) return;
    const result = await mutate(intent.payload, intent.message, intent.options);
    if (result && navigationCurrent.current.route.workspace === (result.workspaceId ?? intent.workspaceId)) {
      if (result.sprintId) setSelectedSprintId(result.sprintId);
      // Retry acknowledges the original form, not a second submission.
      if (modal && modal !== "invite" && !["addTaskComment", "changeImpediment", "saveDailyNote", "saveSprintReview", "addReviewEntry", "convertReviewDecision", "addRetroObservation", "selectRetroProblem", "createRetroAction", "updateRetroAction"].includes(String(intent.payload.action))) closeModal();
    }
  };

  return (
    <AppShell
      user={user} workspace={data.workspace} workspaces={data.workspaces} memberCount={data.members.length}
      avatarColor={data.members.find((member) => member.id === user.id)?.avatarColor ?? "#2f9c88"}
      backlogCount={data.tasks.filter((task) => !task.sprintId).length} view={view} title={pageTitle.title} eyebrow={view === "board" ? activeSprint?.status === "planned" ? "Sprint planificado" : activeSprint?.status === "completed" ? "Sprint completado" : activeSprint?.status === "cancelled" ? "Sprint cancelado" : activeSprint ? "Sprint activo" : "Tu equipo" : pageTitle.eyebrow}
      onNavigate={navigateToView} onWorkspace={(id) => { setError(""); void go({ ...defaultNavigation, workspace: id, view }); }} onInvite={() => { setError(""); setModal("invite"); }}
      onCreateWorkspace={() => setModal("workspace")} onNewTask={() => openNewTask(view === "backlog" ? "backlog" : "todo")}
      signOutAction={signOutAction} overlays={<>
      <DialogLifecycle.Provider value={{ state: modalState, busy, onRetry: uncertain ? () => void retryChange() : undefined, error: error || (navigation.syncFailed ? "No pudimos actualizar el proyecto. Tu borrador se conserva; volveremos a intentarlo." : "") }}>
      {modal === "task" && selectedTask && (
        <TaskModal
          key={`${selectedTask.workspaceId}:${selectedTask.id || "new-task"}`} actorId={user.id} task={selectedTask}
          latestTask={data.tasks.find((item) => item.id === selectedTask.id) ?? null}
          acknowledged={confirmedTaskId === selectedTask.id}
          members={data.members}
          sprints={data.sprints}
          busy={busy}
          onClose={closeModal}
          onCollaborate={async (payload, message, options) => !!(await mutate({ ...payload, workspaceId: data.workspace.id }, message, options))}
          onReviewSource={(sprintId) => { if (busy) return; closingLinkedTask.current = route.task; modalState.close(() => void update({ view: "review", sprint: sprintId, task: undefined })); }}
          onCopyLink={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setToast("Enlace copiado. Solo pueden abrirlo los miembros del proyecto.");
            } catch { setToast("Puedes copiar el enlace desde la barra de direcciones."); }
          }}
          onSave={async (task, patch) => {
            const isNew = !task.id;
            const ok = await mutate(
              {
                action: isNew ? "createTask" : "updateTask",
                ...(isNew ? task : { id: task.id, revision: task.revision, ...patch }),
                workspaceId: data.workspace.id,
              },
              isNew ? "Tarea creada correctamente." : "Cambios guardados.",
              { draftKey: taskDraftKey(user.id, task.workspaceId, task.id) },
            );
            if (ok) closeModal();
          }}
          onDelete={selectedTask.id ? async (revision) => {
            const ok = await mutate(
              { action: "deleteTask", workspaceId: data.workspace.id, id: selectedTask.id, revision },
              "Tarea eliminada.",
              { draftKey: taskDraftKey(user.id, selectedTask.workspaceId, selectedTask.id) },
            );
            if (ok) closeModal();
          } : undefined}
        />
      )}
      {modal === "invite" && (
        <InviteModal workspace={data.workspace} onClose={closeModal} onManage={async (operation, invitationRevision) => {
          const result = await mutate({ action: "manageInvitation", workspaceId: data.workspace.id, operation, invitationRevision }, operation === "revoke" ? "Invitación revocada. El equipo conserva su acceso." : "Nueva invitación generada.");
          return !!result && !navigationCurrent.current.syncFailed;
        }} />
      )}
      {modal === "scrum" && (
        <ScrumConfigurationModal workspace={data.workspace} members={data.members} onClose={closeModal} onSave={async (configuration) => {
          const result = await mutate({ action: "updateScrumConfiguration", workspaceId: data.workspace.id, ...configuration }, "Configuración Scrum guardada para todo el equipo.");
          if (result) closeModal();
        }} />
      )}
      {modal === "access" && selectedMember && (
        <MemberAccessModal workspace={data.workspace} member={selectedMember} onClose={closeModal} onSave={async (role, expectedRole, accessRevision) => {
          const result = await mutate({ action: "updateMemberAccess", workspaceId: data.workspace.id, userId: selectedMember.id, role, expectedRole, accessRevision }, "Acceso actualizado. Las responsabilidades Scrum se conservan.");
          if (result) closeModal();
        }} />
      )}
      {modal === "workspace" && (
        <WorkspaceModal busy={busy} onClose={closeModal} onSubmit={async (mode, value) => {
          const ok = await mutate(
            mode === "create" ? { action: "createWorkspace", name: value } : { action: "joinWorkspace", inviteCode: value },
            mode === "create" ? "Proyecto creado." : "Te uniste al proyecto.",
          );
          if (ok) closeModal();
        }} />
      )}
      {(modal === "sprint" || modal === "planSprint") && (
        <SprintPlanModal key={modal === "planSprint" ? activeSprint?.id : "new-sprint"} sprint={modal === "planSprint" ? activeSprint ?? undefined : undefined} tasks={data.tasks} nextNumber={data.sprints.length + 1} busy={busy} onClose={closeModal} onSave={async (payload) => {
          const result = await mutate({ action: modal === "sprint" ? "createSprint" : "updateSprint", workspaceId: data.workspace.id, ...payload }, modal === "sprint" ? "Sprint planificado. Selecciona su trabajo antes de iniciarlo." : "Planificación guardada para todo el equipo.");
          if (result) {
            if (result.sprintId) setSelectedSprintId(result.sprintId);
            closeModal();
          }
        }} />
      )}
      {modal === "startSprint" && activeSprint && <StartSprintModal sprint={activeSprint} tasks={data.tasks} currentActive={data.sprints.find((sprint) => sprint.status === "active")} busy={busy} onClose={closeModal} onStart={async (revision) => {
        const result = await mutate({ action: "startSprint", workspaceId: data.workspace.id, id: activeSprint.id, revision }, "Sprint iniciado. El equipo ya puede trabajar en el incremento.");
        if (result) closeModal();
      }} />}
      {(modal === "closeSprint" || modal === "cancelSprint") && activeSprint && <EndSprintModal key={`${modal}:${activeSprint.id}`} sprint={activeSprint} workspace={data.workspace} tasks={data.tasks} cancel={modal === "cancelSprint"} busy={busy} onClose={closeModal} onFinish={async (payload) => {
        const result = await mutate({ action: modal, workspaceId: data.workspace.id, id: activeSprint.id, ...payload }, modal === "cancelSprint" ? "Sprint cancelado. El motivo y su trabajo quedaron en el historial." : "Sprint cerrado. El trabajo incompleto vuelve al backlog.");
        if (result) closeModal();
      }} />}
      {modal === "sprintHistory" && <SprintHistoryModal sprints={data.sprints} onClose={closeModal} onSelect={(id) => { closeModal(); setSelectedSprintId(id); }} />}
      </DialogLifecycle.Provider>

      {assistantOpen && (
        <AssistantPanel
          messages={assistantMessages}
          input={assistantInput}
          busy={assistantBusy}
          state={assistantState}
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
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
      {busy && <div className="saving-indicator" role="status">Guardando…</div>}
      </>}
    >
        <div className="sync-status" aria-label="Estado de sincronización">
          <span role="status" aria-live={busy || uncertain || !navigation.online || navigation.syncFailed ? "polite" : "off"}>{busy ? "Guardando…" : uncertain ? "Cambio sin confirmar" : !navigation.online ? "Sin conexión · última copia recibida" : navigation.syncFailed ? "Sincronización pendiente" : navigation.loading ? "Comprobando cambios…" : "Actualizado"}</span>
          {uncertain ? <button disabled={busy} onClick={() => void retryChange()}>Reintentar cambio pendiente</button>
            : <button disabled={busy || navigation.loading || !navigation.online} onClick={() => void refresh()} title={navigation.lastSyncedAt ? `Última comprobación: ${new Date(navigation.lastSyncedAt).toLocaleTimeString("es")}` : undefined}>Actualizar</button>}
        </div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")}>Cerrar</button></div>}
        {navigation.syncFailed && <div className="error-banner" role="status"><span>No pudimos actualizar. Tus cambios sin guardar se conservan.</span><button onClick={() => void refresh()}>Reintentar sincronización</button></div>}

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
              onSearch={(search) => void update({ search }, "replace")}
              priorityFilter={priorityFilter}
              onPriorityFilter={(priority) => void update({ priority }, "replace")}
              assigneeFilter={assigneeFilter}
              onAssigneeFilter={(assignee) => void update({ assignee }, "replace")}
            onOpenTask={openTask}
            onMoveTask={moveTask}
            onNewTask={openNewTask}
            onNewSprint={() => setModal("sprint")}
            onPlanSprint={() => { setError(""); setModal("planSprint"); }}
            onStartSprint={() => { setError(""); setModal("startSprint"); }}
            workspace={data.workspace}
            onCloseSprint={() => { setError(""); setModal("closeSprint"); }}
            onCancelSprint={() => { setError(""); setModal("cancelSprint"); }}
            onHistory={() => { setError(""); setModal("sprintHistory"); }}
            currentTasks={data.tasks}
            onReview={() => navigateToView("review")}
            onRetro={() => navigateToView("retro")}
            onReports={() => navigateToView("reports")}
            />
          )}
          {view === "backlog" && (
            <BacklogView
              busy={busy || uncertain}
              onReorder={async (task, beforeId) => !!(await mutate({ action: "reorderBacklog", workspaceId: data.workspace.id, backlogRevision: data.workspace.backlogRevision, id: task.id, beforeId }, "Orden del backlog guardado."))}
              tasks={data.tasks.filter((task) => !task.sprintId || task.status === "backlog")}
              sprint={isFinishedSprint(activeSprint) ? null : activeSprint}
              members={data.members}
              onOpenTask={openTask}
              onNewTask={() => openNewTask("backlog")}
              onAddToSprint={(task) => void mutate(
                { action: "updateTask", workspaceId: data.workspace.id, id: task.id, revision: task.revision, sprintId: activeSprint?.id, status: "todo" },
                `${task.code} se añadió al sprint.`,
              )}
            />
          )}
          {view === "daily" && <DailyView key={`${data.workspace.id}:${activeSprint?.id ?? "none"}`} actorId={user.id} workspaceId={data.workspace.id} sprint={activeSprint} sprints={data.sprints} tasks={data.tasks} date={route.day ?? localDay()} busy={busy || uncertain} onDate={(day) => void update({ day }, "replace")} onSprint={setSelectedSprintId} onOpenTask={openTask} onMutate={async (payload, message, options) => !!(await mutate({ ...payload, workspaceId: data.workspace.id }, message, options))} />}
          {view === "review" && <ReviewView key={`${data.workspace.id}:${activeSprint?.id ?? "none"}`} actorId={user.id} workspace={data.workspace} sprint={activeSprint} sprints={data.sprints} tasks={data.tasks} busy={busy} pending={uncertain} error={error} onRetry={uncertain ? () => void retryChange() : undefined} onSprint={setSelectedSprintId} onBoard={() => navigateToView("board")} onSettings={() => navigateToView("settings")} onOpenTask={(taskId) => void update({ task: taskId })} onMutate={async (payload, message, options) => !!(await mutate({ ...payload, workspaceId: data.workspace.id }, message, options))} />}
          {view === "retro" && <RetroView key={`${data.workspace.id}:${activeSprint?.id ?? "none"}`} actorId={user.id} workspace={data.workspace} sprint={activeSprint} sprints={data.sprints} members={data.members} busy={busy} pending={uncertain} error={error} onRetry={uncertain ? () => void retryChange() : undefined} onSprint={setSelectedSprintId} onBoard={() => navigateToView("board")} onMutate={async (payload, message, options) => !!(await mutate({ ...payload, workspaceId: data.workspace.id }, message, options))} />}
          {view === "reports" && <ReportsView key={`${data.workspace.id}:${activeSprint?.id ?? "none"}`} workspace={data.workspace} sprint={activeSprint} sprints={data.sprints} busy={busy} syncToken={`${data.sprints.map((s) => `${s.id}:${s.status}:${s.revision}`).join("|")}:${data.workspace.backlogRevision}`} onSprint={setSelectedSprintId} onBoard={() => navigateToView("board")} />}
          {view === "summary" && activeSprint && <div className="content-pad" style={{ paddingBottom: 0, display: "flex", flexWrap: "wrap", gap: 12 }}><button className="secondary-button" onClick={() => navigateToView("review")}>Review e incremento</button><button className="secondary-button" onClick={() => navigateToView("retro")}>Retrospectiva</button><button className="secondary-button" onClick={() => navigateToView("reports")}>Informes históricos</button></div>}
          {view === "summary" && isFinishedSprint(activeSprint) && activeSprint ? <div className="content-pad content-narrow"><SprintArchive key={activeSprint.id} sprint={activeSprint} currentTasks={data.tasks} onOpenTask={openTask} /></div> : view === "summary" && (
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
              workspace={data.workspace}
              onInvite={() => { setError(""); setModal("invite"); }}
              onAccess={(member) => { setError(""); setSelectedMember(member); setModal("access"); }}
              onScrum={() => { setError(""); setModal("scrum"); }}
            />
          )}
          {view === "settings" && (
            <><SettingsView
              themePreference={themePreference}
              textSizePreference={textSizePreference}
              onThemeChange={changeThemePreference}
              onTextSizeChange={changeTextSizePreference}
            /><ScrumSettings workspace={data.workspace} members={data.members} onEdit={() => { setError(""); setModal("scrum"); }} /><ProjectData key={data.workspace.id} workspace={data.workspace} /></>
          )}
        </div>
    </AppShell>
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
  onPlanSprint,
  onStartSprint,
  workspace,
  onCloseSprint,
  onCancelSprint,
  onHistory,
  currentTasks,
  onReview,
  onRetro,
  onReports,
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
  onPlanSprint: () => void;
  onStartSprint: () => void;
  workspace: Workspace;
  onCloseSprint: () => void;
  onCancelSprint: () => void;
  onHistory: () => void;
  currentTasks: ScrumTask[];
  onReview: () => void;
  onRetro: () => void;
  onReports: () => void;
}) {
  if (!sprint) {
    return <div className="content-pad"><EmptyState title="Todavía no hay un sprint" body="Crea tu primer sprint para comenzar a trabajar." action={<button className="primary-button" onClick={onNewSprint} type="button">+ Crear sprint</button>} /></div>;
  }

  const daysLeft = Math.max(0, Math.ceil((new Date(`${sprint.endDate}T23:59:59`).getTime() - APP_NOW) / 86_400_000));

  return (
    <div className={boardStyles.board}>
      <SprintOverview sprint={sprint} sprints={sprints} selectedSprintId={selectedSprintId} onSprintChange={onSprintChange} onNewSprint={onNewSprint} daysLeft={daysLeft} donePoints={donePoints} totalPoints={totalPoints} progress={progress} />
      <SprintPlanStatus sprint={sprint} currentActive={sprints.find((item) => item.status === "active")} onPlan={onPlanSprint} onStart={onStartSprint} />
      <SprintLifecycleActions sprint={sprint} workspace={workspace} onClose={onCloseSprint} onCancel={onCancelSprint} onHistory={onHistory} onReview={onReview} onRetro={onRetro} onReports={onReports} />
      {isFinishedSprint(sprint) ? <SprintArchive key={sprint.id} sprint={sprint} currentTasks={currentTasks} onOpenTask={onOpenTask} /> : <>
      <BoardToolbar search={search} onSearch={onSearch} priorityFilter={priorityFilter} onPriorityFilter={onPriorityFilter} assigneeFilter={assigneeFilter} onAssigneeFilter={onAssigneeFilter} members={members} count={tasks.length} />

      <section className="kanban" aria-label="Tablero Scrum">
        {statusMeta.map((column) => {
          const columnTasks = tasks.filter((task) => task.status === column.id);
          const points = columnTasks.reduce((sum, task) => sum + (task.points ?? 0), 0);
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
                <span>{points} pts{columnTasks.some((task) => task.points === null) && ` · ${columnTasks.filter((task) => task.points === null).length} sin estimar`}</span>
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
      </>}
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
      {task.impediment && <span className="blocked-badge" title={`Seguimiento: ${task.impediment.ownerName}`}><span aria-hidden="true">◈</span> Bloqueada</span>}
      {task.description && <p>{task.description}</p>}
      <div className="task-card-footer">
        <span className="story-points" aria-label={task.points === null ? "Sin estimar" : `${task.points} puntos`} title={task.points === null ? "Sin estimar" : `${task.points} puntos`}>{task.points ?? "—"}</span>
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onMove(event.target.value as TaskStatus)}
          aria-label={`Mover ${task.code}`}
        >
          {statusMeta.map((status) => <option key={status.id} value={status.id} disabled={status.id === "done" && !!task.impediment}>{status.label}</option>)}
        </select>
        {task.assigneeName ? (
          <Avatar size="small" member={{ name: task.assigneeName, avatarColor: task.assigneeColor ?? "#8791a5" }} />
        ) : <span className="avatar avatar-small avatar-empty" title="Sin asignar">?</span>}
      </div>
    </article>
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
        <article><span>Progreso</span><strong>{progress}%</strong><div className="mini-progress"><i style={{ width: `${progress}%` }} /></div><small>{donePoints} de {totalPoints} puntos{tasks.some((task) => task.points === null) && ` · ${tasks.filter((task) => task.points === null).length} tareas sin estimar`}</small></article>
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

function TeamView({ members, tasks, workspace, onInvite, onAccess, onScrum }: { members: Member[]; tasks: ScrumTask[]; workspace: Workspace; onInvite: () => void; onAccess: (member: Member) => void; onScrum: () => void }) {
  const totalPoints = tasks.reduce((sum, task) => sum + (task.points ?? 0), 0);
  return (
    <div className="content-pad content-narrow">
      <section className="section-intro">
        <div><span className="section-kicker">{members.length} {members.length === 1 ? "persona" : "personas"}</span><h2>Tu equipo Scrum</h2><p>Revisa responsabilidades y distribuye el trabajo del sprint.</p></div>
        {canManageProject(workspace.role) && <button className="primary-button" onClick={onInvite}>+ Invitar integrante</button>}
      </section>
      <section className="team-layout">
        <div className="team-list">
          {members.map((member) => {
            const assigned = tasks.filter((task) => task.assigneeId === member.id && task.status !== "done");
            const points = assigned.reduce((sum, task) => sum + (task.points ?? 0), 0);
            const percentage = totalPoints ? Math.min(100, Math.round((points / totalPoints) * 100 * members.length)) : 0;
            return (
              <article className="member-card" key={member.id} aria-label={member.name}>
                <Avatar size="large" member={member} />
                <div className="member-info"><strong>{member.name}</strong><span>{member.email}</span><small>{accessLabels[member.role]}</small>
                  <div className={governanceStyles.roles}>{member.scrumRoles.length ? member.scrumRoles.map((role) => <span className={governanceStyles.badge} key={role}>{scrumLabels[role]}</span>) : <span>Sin responsabilidad Scrum asignada</span>}</div>
                  {canManageAccess(workspace.role) && member.role !== "owner" && <button className={`secondary-button ${governanceStyles.accessButton}`} onClick={() => onAccess(member)} aria-label={`Editar acceso de ${member.name}`}>Editar acceso</button>}
                </div>
                <div className="member-work"><span><strong>{assigned.length}</strong> tareas activas</span><span><strong>{points}</strong> puntos</span><div className="mini-progress"><i style={{ width: `${percentage}%` }} /></div></div>
              </article>
            );
          })}
        </div>
        <aside className="invite-card">
          <span className="invite-symbol" aria-hidden="true">◇</span><span>Responsabilidades y acceso</span><h3>Un equipo, acuerdos claros</h3><p>Product Owner, Scrum Master y Developers son responsabilidades Scrum; no permisos administrativos.</p>
          {canManageProject(workspace.role) ? <><button className="secondary-button" onClick={onScrum}>Editar responsabilidades Scrum</button><p>{workspace.inviteEnabled ? "Invitación activa" : "Invitaciones desactivadas"}</p><button className="secondary-button" onClick={onInvite}>Gestionar invitación</button></> : <p>El propietario y los administradores gestionan los acuerdos y las invitaciones. Solo el propietario cambia el acceso.</p>}
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

function WorkspaceModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (mode: "create" | "join", value: string) => Promise<void> }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [value, setValue] = useState("");
  return (
    <ModalShell title="Otro proyecto" subtitle="Crea un espacio nuevo o únete al tablero de tu equipo." onClose={onClose}>
      <div className="segmented"><button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setValue(""); }}>Crear proyecto</button><button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setValue(""); }}>Unirme con código</button></div>
      <form className="simple-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(mode, value); }}><label className="field"><span>{mode === "create" ? "Nombre del proyecto" : "Código de invitación"}</span><input data-initial-focus value={value} onChange={(event) => setValue(event.target.value)} placeholder={mode === "create" ? "Ej. Aplicación de tutorías" : "Ej. A1B2C3D4"} maxLength={mode === "create" ? 80 : 20} pattern={mode === "join" ? "[A-Za-z0-9]{8,20}" : undefined} required /></label><div className="modal-actions"><span className="modal-action-spacer" /><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || !value.trim()}>{busy ? "Guardando…" : mode === "create" ? "Crear proyecto" : "Unirme"}</button></div></form>
    </ModalShell>
  );
}
