"use client";

import { useId, useState } from "react";
import type { ScrumTask, Sprint } from "../lib/types";
import { ModalShell } from "./ModalShell";
import styles from "./SprintPlanning.module.css";

type PlanFields = { name: string; goal: string; startDate: string; endDate: string; availability: string; capacityHours: string };
function fields(sprint?: Sprint, nextNumber = 1): PlanFields {
  const now = Date.now();
  return { name: sprint?.name ?? `Sprint ${nextNumber}`, goal: sprint?.goal ?? "", startDate: sprint?.startDate ?? new Date(now).toISOString().slice(0, 10),
    endDate: sprint?.endDate ?? new Date(now + 13 * 86400000).toISOString().slice(0, 10), availability: sprint?.availability ?? "", capacityHours: sprint?.capacityHours?.toString() ?? "" };
}

export function SprintPlanModal({ sprint, tasks, nextNumber, busy, onClose, onSave }: {
  sprint?: Sprint; tasks: ScrumTask[]; nextNumber: number; busy: boolean; onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  // A live refresh never replaces the user's edits or the versions they saw.
  const [baseline, setBaseline] = useState(sprint);
  const [candidates, setCandidates] = useState(() => tasks.filter((task) => !task.sprintId || task.sprintId === sprint?.id));
  const [selected, setSelected] = useState(() => new Set(tasks.filter((task) => sprint && task.sprintId === sprint.id).map((task) => task.id)));
  const [form, setForm] = useState(() => fields(sprint, nextNumber));
  const [search, setSearch] = useState("");
  const goalId = useId();
  const changes = candidates.filter((task) => selected.has(task.id) !== (task.sprintId === baseline?.id)).map((task) => ({ id: task.id, revision: task.revision, selected: selected.has(task.id) }));
  const stale = !!baseline && (sprint?.revision !== baseline.revision || sprint?.status !== "planned"
    || changes.some((change) => tasks.find((task) => task.id === change.id)?.revision !== change.revision));
  const selectedTasks = candidates.filter((task) => selected.has(task.id));
  const loadCurrent = () => {
    setBaseline(sprint); setForm(fields(sprint, nextNumber));
    setCandidates(tasks.filter((task) => !task.sprintId || task.sprintId === sprint?.id));
    setSelected(new Set(tasks.filter((task) => sprint && task.sprintId === sprint.id).map((task) => task.id)));
  };
  return <ModalShell title={baseline ? "Planificar sprint" : "Crear sprint"} subtitle="Prepara el trabajo con tu equipo. Crear o guardar un plan no inicia el sprint." onClose={onClose} wide={!!baseline}>
    <form className={`simple-form ${styles.form}`} onSubmit={(event) => { event.preventDefault(); if (!stale) void onSave({ ...form, capacityHours: form.capacityHours === "" ? null : Number(form.capacityHours), ...(baseline ? { id: baseline.id, revision: baseline.revision, taskChanges: changes } : {}) }); }}>
      {stale && !busy && <div className={styles.notice} role="status"><strong>El plan cambió en otra sesión.</strong><p>Tu formulario sigue aquí. Copia lo que necesites; cargar la versión actual reemplazará tus cambios sin guardar.</p></div>}
      {stale && <button className="secondary-button" type="button" onClick={loadCurrent}>Cargar versión actual y descartar mi formulario</button>}
      <label className="field"><span>Nombre</span><input data-initial-focus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required /></label>
      <div className="field"><label htmlFor={goalId}>Objetivo</label><textarea id={goalId} aria-describedby={`${goalId}-hint`} value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} rows={3} placeholder="¿Qué resultado concreto entregará el equipo?" maxLength={300} /><small id={`${goalId}-hint`}>Necesario para iniciar; puedes definirlo después de crear el plan.</small></div>
      <div className="form-row"><label className="field"><span>Inicio</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label><label className="field"><span>Fin</span><input type="date" value={form.endDate} min={form.startDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required /></label></div>
      <details className={styles.availability}><summary>Disponibilidad del equipo · opcional</summary>
        <label className="field"><span>Contexto de disponibilidad</span><textarea value={form.availability} onChange={(event) => setForm({ ...form, availability: event.target.value })} rows={3} maxLength={1000} placeholder="Vacaciones, exámenes, dedicación parcial o dependencias…" /></label>
        <label className="field"><span>Horas disponibles del equipo</span><input type="number" min={0} max={10000} step="any" inputMode="decimal" value={form.capacityHours} onChange={(event) => setForm({ ...form, capacityHours: event.target.value })} placeholder="Sin definir" /></label>
        <p>Orientación colectiva, no cuota individual. Los puntos no se convierten en horas ni son obligatorios.</p>
      </details>
      {baseline && <section className={styles.work} aria-label="Selección de trabajo">
        <div><h3>Trabajo previsto</h3><p>Selecciona del backlog. Al quitar una tarea del plan, vuelve al final del backlog.</p></div>
        <p className={styles.totals} role="status">{selectedTasks.length} tareas · {selectedTasks.reduce((sum, task) => sum + (task.points ?? 0), 0)} puntos estimados · {selectedTasks.filter((task) => task.points === null).length} sin estimar</p>
        <label className="field"><span>Buscar en la selección</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Título o código" /></label>
        <ul className={styles.tasks}>
          {candidates.filter((task) => `${task.code} ${task.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((task) => <li key={task.id}><label>
            <input type="checkbox" checked={selected.has(task.id)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(task.id); else next.delete(task.id); setSelected(next); }} />
            <span><strong>{task.code} · {task.title}</strong><small>{task.points === null ? "Sin estimar" : `${task.points} pts`} · {task.sprintId ? "En este plan" : "Backlog"}</small></span>
          </label></li>)}
        </ul>
        {!candidates.length && <p>No hay tareas disponibles. Añade tareas al backlog o a este sprint desde el tablero.</p>}
        {changes.length > 100 && <p role="alert">Guarda como máximo 100 cambios de selección a la vez.</p>}
      </section>}
      <div className="modal-actions"><span className="modal-action-spacer" /><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || stale || !form.name.trim() || changes.length > 100}>{busy ? "Guardando…" : baseline ? "Guardar planificación" : "Crear sprint"}</button></div>
    </form>
  </ModalShell>;
}

export function SprintPlanStatus({ sprint, currentActive, onPlan, onStart }: { sprint: Sprint; currentActive?: Sprint; onPlan: () => void; onStart: () => void }) {
  if (sprint.status !== "planned") return null;
  return <section className={styles.status} aria-label="Planificación del sprint">
    <div><span className={styles.badge}>Planificado</span><h2>Prepara el siguiente incremento</h2><p>{sprint.startDate} — {sprint.endDate}{sprint.capacityHours !== null ? ` · ${sprint.capacityHours} h disponibles en el equipo` : " · Disponibilidad sin definir"}</p>
      {currentActive && <p>«{currentActive.name}» está activo. Puedes preparar este plan e iniciarlo cuando el equipo finalice el sprint actual.</p>}
    </div>
    <div className={styles.actions}><button className="secondary-button" onClick={onPlan}>Planificar sprint</button><button className="primary-button" onClick={onStart} disabled={!!currentActive}>Iniciar sprint</button></div>
  </section>;
}

export function StartSprintModal({ sprint, tasks, currentActive, busy, onClose, onStart }: { sprint: Sprint; tasks: ScrumTask[]; currentActive?: Sprint; busy: boolean; onClose: () => void; onStart: (revision: number) => Promise<void> }) {
  const [revision] = useState(sprint.revision);
  const stale = sprint.revision !== revision || sprint.status !== "planned";
  const work = tasks.filter((task) => task.sprintId === sprint.id && task.status !== "backlog");
  const blocked = stale || !!currentActive || !sprint.goal.trim() || !work.length;
  return <ModalShell title="Iniciar sprint" subtitle="Confirma el plan acordado. Solo puede haber un sprint activo por proyecto." onClose={onClose}>
    <div className={styles.confirm}><h3>{sprint.name}</h3><p>{sprint.goal || "Falta definir el objetivo."}</p><dl><dt>Periodo planificado</dt><dd>{sprint.startDate} — {sprint.endDate}</dd><dt>Trabajo seleccionado</dt><dd>{work.length} tareas · {work.reduce((sum, task) => sum + (task.points ?? 0), 0)} puntos · {work.filter((task) => task.points === null).length} sin estimar</dd><dt>Disponibilidad total</dt><dd>{sprint.capacityHours === null ? "Sin definir" : `${sprint.capacityHours} h de equipo`}</dd></dl>
      {sprint.availability && <p>{sprint.availability}</p>}
      <p>Los puntos y la disponibilidad orientan la conversación; no limitan el inicio. La fecha real de inicio se registra al confirmar.</p>
      {blocked && <p className={styles.notice} role="status">{stale ? "El plan cambió. Cierra y vuelve a revisar antes de iniciar." : currentActive ? `«${currentActive.name}» ya está activo.` : "Define un objetivo y selecciona al menos una tarea desde Planificar sprint."}</p>}
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || blocked} onClick={() => void onStart(revision)}>{busy ? "Iniciando…" : "Confirmar inicio"}</button></div>
    </div>
  </ModalShell>;
}
