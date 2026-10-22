"use client";

import { useState } from "react";
import type { ScrumTask, Sprint, Workspace } from "../lib/types";
import { canManageProject } from "../lib/permissions";
import { ModalShell } from "./ModalShell";
import { TaskDescription } from "./TaskEditor";
import styles from "./SprintLifecycle.module.css";

export const isFinishedSprint = (sprint?: Sprint | null) => sprint?.status === "completed" || sprint?.status === "cancelled";
const statuses = { backlog: "Backlog", todo: "Por hacer", progress: "En curso", review: "En revisión", done: "Terminado" };
const dateTime = (value: string) => new Date(value).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });

export function SprintLifecycleActions({ sprint, workspace, onClose, onCancel, onHistory, onReview, onRetro, onReports }: { sprint: Sprint; workspace: Workspace; onClose: () => void; onCancel: () => void; onHistory: () => void; onReview: () => void; onRetro: () => void; onReports: () => void }) {
  return <div className={styles.actions} aria-label="Ciclo del sprint">
    <div><button className="secondary-button small-button" onClick={onHistory}><span aria-hidden="true">↶</span> Historial de sprints</button><button className="secondary-button small-button" onClick={onReports}>Informe del sprint</button></div>
    <div><button className="secondary-button small-button" onClick={onReview}>Review e incremento</button><button className="secondary-button small-button" onClick={onRetro}>Retrospectiva</button>{sprint.status === "active" && <button className="secondary-button" onClick={onClose}>Cerrar sprint</button>}
      {!isFinishedSprint(sprint) && canManageProject(workspace.role) && <button className="secondary-button small-button" onClick={onCancel}>Cancelar sprint</button>}</div>
  </div>;
}

export function EndSprintModal({ sprint, workspace, tasks, cancel, busy, onClose, onFinish }: {
  sprint: Sprint; workspace: Workspace; tasks: ScrumTask[]; cancel: boolean; busy: boolean; onClose: () => void;
  onFinish: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [baseline, setBaseline] = useState(() => ({ revision: sprint.revision, governanceRevision: workspace.governanceRevision }));
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const stale = sprint.revision !== baseline.revision || workspace.governanceRevision !== baseline.governanceRevision;
  const allowed = cancel ? canManageProject(workspace.role) && !isFinishedSprint(sprint) : sprint.status === "active";
  const work = tasks.filter((task) => task.sprintId === sprint.id);
  const unfinished = work.filter((task) => task.status !== "done");
  const done = work.filter((task) => task.status === "done");
  const title = cancel ? "Cancelar sprint" : "Cerrar sprint";
  return <ModalShell title={title} subtitle={cancel ? "Registra por qué se abandona el objetivo. Una cancelación se conserva separada de los sprints completados." : "Revisa el resultado con el equipo antes de finalizar este sprint."} onClose={onClose} wide>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!stale && allowed && reviewed) void onFinish({ ...baseline, summary, reason, reviewed }); }}>
      <div className={styles.intro} data-initial-focus tabIndex={-1}><span className={styles.badge}>{sprint.name}</span><h3>{sprint.goal || "Sin objetivo definido"}</h3><p>{sprint.startDate} — {sprint.endDate}</p></div>
      <div className={styles.metrics}><div><strong>{done.length}</strong><span>Terminadas</span></div><div><strong>{unfinished.length}</strong><span>Vuelven al backlog</span></div><div><strong>{work.filter((task) => task.points === null).length}</strong><span>Sin estimar</span></div></div>
      <section className={styles.notice} aria-label="Destino del trabajo"><strong>El equipo decide el siguiente paso</strong><p>Las tareas incompletas vuelven al final del backlog para revisarlas y reordenarlas. Las terminadas se conservan en este sprint. No se inicia otro sprint al confirmar.</p></section>
      <details className={styles.section} open={unfinished.length > 0}><summary>Revisar tareas que vuelven al backlog · {unfinished.length}</summary><ul className={styles.tasks}>{unfinished.map((task) => <li key={task.id}><strong>{task.code} · {task.title}</strong><span>{statuses[task.status]} · {task.points === null ? "Sin estimar" : `${task.points} pts`}</span></li>)}</ul>{!unfinished.length && <p>No hay trabajo pendiente.</p>}</details>
      <details className={styles.section}><summary>Trabajo terminado y Definition of Done · {done.length}</summary><ul className={styles.tasks}>{done.map((task) => <li key={task.id}><strong>{task.code} · {task.title}</strong></li>)}</ul><h4>Acuerdo común del equipo</h4>{workspace.definitionOfDone.length ? <ul>{workspace.definitionOfDone.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : <p>Aún no hay una Definition of Done configurada. El cierre no marcará tareas como terminadas.</p>}</details>
      {cancel ? <label className="field"><span>Motivo de cancelación</span><textarea data-initial-focus value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} required placeholder="¿Por qué el objetivo dejó de ser útil?" /></label> : <label className="field"><span>Resumen del resultado</span><textarea data-initial-focus value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} maxLength={2000} required placeholder="¿Qué se consiguió y qué quedó pendiente?" /></label>}
      {stale && <div className={styles.notice} role="status"><strong>El resumen cambió en otra sesión.</strong><p>Tu texto se conserva. Revisa las tareas y los acuerdos actuales antes de volver a confirmar.</p><button className="secondary-button" type="button" onClick={() => { setBaseline({ revision: sprint.revision, governanceRevision: workspace.governanceRevision }); setReviewed(false); }}>Revisar versión actual</button></div>}
      {!allowed && <p role="status">Este sprint ya no admite esta acción o tu acceso ha cambiado. Puedes cerrar esta ventana y consultar el historial.</p>}
      <label className={styles.review}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>He revisado el resultado, la Definition of Done y las tareas que volverán al backlog.</span></label>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Volver</button><button className="primary-button" type="submit" disabled={busy || stale || !allowed || !reviewed || !(cancel ? reason : summary).trim()}>{busy ? "Guardando…" : cancel ? "Confirmar cancelación" : "Confirmar cierre"}</button></div>
    </form>
  </ModalShell>;
}

export function SprintHistoryModal({ sprints, onClose, onSelect }: { sprints: Sprint[]; onClose: () => void; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const history = sprints.filter(isFinishedSprint).sort((a, b) => (b.outcome?.endedAt ?? b.endDate).localeCompare(a.outcome?.endedAt ?? a.endDate));
  const filtered = history.filter((sprint) => (filter === "all" || sprint.status === filter) && `${sprint.name} ${sprint.outcome?.plan.goal ?? sprint.goal}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <ModalShell title="Historial de sprints" subtitle="Resultados guardados al cerrar o cancelar. El trabajo devuelto puede seguir evolucionando en el backlog." onClose={onClose} wide>
    <div className={styles.form}><div className="form-row"><label className="field"><span>Buscar sprint</span><input data-initial-focus type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre u objetivo" /></label><label className="field"><span>Resultado</span><select aria-label="Resultado" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos</option><option value="completed">Completados</option><option value="cancelled">Cancelados</option></select></label></div>
      <ul className={styles.history}>{filtered.map((sprint) => <li key={sprint.id}><button type="button" onClick={() => onSelect(sprint.id)} aria-label={`Ver historial de ${sprint.name}`}><span className={styles.badge}>{sprint.status === "cancelled" ? "Cancelado" : "Completado"}</span><strong>{sprint.name}</strong><span>{sprint.outcome ? dateTime(sprint.outcome.endedAt) : `${sprint.startDate} — ${sprint.endDate}`}</span><p>{sprint.outcome?.reason || sprint.outcome?.summary || "Registro anterior a las instantáneas de cierre."}</p><span>Ver resultado <span aria-hidden="true">↗</span></span></button></li>)}</ul>
      {!filtered.length && <p className={styles.notice}>{history.length ? "No hay sprints que coincidan con el filtro." : "Todavía no hay sprints finalizados. Al cerrar o cancelar uno, aparecerá aquí."}</p>}
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Listo</button></div>
    </div>
  </ModalShell>;
}

export function SprintArchive({ sprint, currentTasks, onOpenTask }: { sprint: Sprint; currentTasks?: ScrumTask[]; onOpenTask?: (task: ScrumTask) => void }) {
  const outcome = sprint.outcome;
  const [filter, setFilter] = useState("all");
  const work = outcome?.tasks ?? [];
  const returned = work.filter((task) => task.returnedToBacklog);
  return <section className={styles.archive} aria-label="Resultado histórico del sprint">
    <div className={styles.intro}><span className={styles.badge}>{sprint.status === "cancelled" ? "Cancelado" : "Completado"}</span><h2>{outcome?.plan.name ?? sprint.name}</h2><p>{outcome?.plan.goal ?? sprint.goal}</p></div>
    {!outcome ? <p className={styles.notice}>Este sprint es anterior al registro de instantáneas. No hay un resumen de cierre verificable; no se reconstruye con las tareas actuales.</p> : <>
      <p className={styles.byline}>{sprint.status === "cancelled" ? "Cancelado" : "Cerrado"} el {dateTime(outcome.endedAt)} por {outcome.actorName}</p>
      <div className={styles.metrics}><div><strong>{work.length - returned.length}</strong><span>Terminadas al finalizar</span></div><div><strong>{returned.length}</strong><span>Devueltas al backlog</span></div><div><strong>{work.filter((task) => !task.returnedToBacklog).reduce((sum, task) => sum + (task.points ?? 0), 0)}</strong><span>Puntos terminados</span></div></div>
      <section className={styles.section}><h3>{sprint.status === "cancelled" ? "Motivo de cancelación" : "Resultado del sprint"}</h3><p className={styles.prose}>{outcome.reason || outcome.summary}</p></section>
      <details className={styles.section}><summary>Plan y acuerdos al finalizar</summary><p>{outcome.plan.startDate} — {outcome.plan.endDate}</p><p>Inicio real: {outcome.plan.startedAt ? dateTime(outcome.plan.startedAt) : "No registrado"}</p><p>Disponibilidad: {outcome.plan.capacityHours === null ? "Sin definir" : `${outcome.plan.capacityHours} h del equipo`}</p>{outcome.plan.availability && <p className={styles.prose}>{outcome.plan.availability}</p>}<h4>Objetivo del producto</h4><p>{outcome.productGoal || "Sin definir"}</p><h4>Definition of Done</h4>{outcome.definitionOfDone.length ? <ul>{outcome.definitionOfDone.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : <p>No estaba configurada.</p>}</details>
      <label className="field"><span>Mostrar trabajo histórico</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todo el alcance al finalizar</option><option value="done">Terminado</option><option value="returned">Devuelto al backlog</option></select></label>
      <ul className={styles.tasks}>{work.filter((task) => filter === "all" || (filter === "returned" ? task.returnedToBacklog : !task.returnedToBacklog)).map((task) => <li key={task.id}><details>
        <summary><strong>{task.code} · {task.title}</strong><span>{statuses[task.status]} · {task.returnedToBacklog ? "Devuelta al backlog" : "Conservada en el sprint"}</span></summary>
        <p>{task.points === null ? "Sin estimar" : `${task.points} pts`} · {task.assigneeName ?? "Sin asignar"}</p>
        {task.description && <TaskDescription value={task.description} />}
        {task.impediment && <section><h4>Impedimento al finalizar</h4><p>{task.impediment.reason}</p><p>Seguimiento: {task.impediment.ownerName}</p></section>}
        {task.acceptanceCriteria.length > 0 && <><h4>Criterios de aceptación</h4><ul>{task.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></>}
        {task.checklist.length > 0 && <><h4>Checklist al finalizar</h4><ul>{task.checklist.map((item) => <li key={item.id}>{item.done ? "✓" : "○"} {item.text}</li>)}</ul></>}
        {onOpenTask && currentTasks?.some((current) => current.id === task.id) && <button className="secondary-button small-button" onClick={() => onOpenTask(currentTasks.find((current) => current.id === task.id)!)}>Ver tarea y conversación actuales</button>}
      </details></li>)}</ul>
      <p className={styles.byline}>Instantánea de solo lectura. Las ediciones posteriores del backlog no cambian este resultado.</p>
    </>}
  </section>;
}
