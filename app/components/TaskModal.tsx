"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Member, ScrumTask, Sprint, TaskPriority, TaskStatus } from "../lib/types";
import { clearDraft, draftStorageFailed, readDraft, sameValue, taskDraftKey, taskFields, taskValues, writeDraft } from "../lib/task-drafts";
import { ModalShell } from "./ModalShell";
import { TaskDescription, TaskEditor } from "./TaskEditor";
import { isFinishedSprint } from "./SprintLifecycle";
import { TaskCollaboration, type CollaborationMutation } from "./TaskCollaboration";
import collaborationStyles from "./Collaboration.module.css";
import styles from "./TaskDetail.module.css";

const statuses: Record<TaskStatus, string> = { backlog: "Backlog", todo: "Por hacer", progress: "En curso", review: "En revisión", done: "Terminado" };
const priorities: Record<TaskPriority, string> = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const labels = { title: "Título", description: "Descripción", acceptanceCriteria: "Criterios de aceptación", checklist: "Checklist", status: "Estado", priority: "Prioridad", points: "Puntos", assigneeId: "Responsable", sprintId: "Sprint" };

export function TaskModal({ actorId, task, latestTask, acknowledged, members, sprints, busy, onClose, onSave, onDelete, onCopyLink, onCollaborate, onReviewSource }: {
  actorId: string; task: ScrumTask; latestTask: ScrumTask | null; acknowledged: boolean;
  members: Member[]; sprints: Sprint[]; busy: boolean; onClose: () => void;
  onSave: (task: ScrumTask, patch: Partial<ScrumTask>) => Promise<void>;
  onDelete?: (revision: number) => Promise<void>; onCopyLink: () => Promise<void>;
  onCollaborate: CollaborationMutation;
  onReviewSource?: (sprintId: string) => void;
}) {
  const draftKey = taskDraftKey(actorId, task.workspaceId, task.id);
  const [draft] = useState(() => readDraft(draftKey));
  const [form, setForm] = useState<ScrumTask>(() => ({ ...task, ...draft?.form }));
  const [baseline, setBaseline] = useState<ScrumTask>(() => ({ ...task, ...draft?.baseline }));
  const [draftNotice, setDraftNotice] = useState(draftStorageFailed(draftKey) ? "No se pudo guardar el borrador en esta pestaña. Mantén esta ventana abierta o copia tu trabajo." : draft ? "Borrador recuperado de esta pestaña." : "");
  const [storageFailed, setStorageFailed] = useState(draftStorageFailed(draftKey));
  const [copyNotice, setCopyNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pane, setPane] = useState<"details" | "collaboration">("details");
  const changedElsewhere = !acknowledged && !!task.id && (!latestTask || latestTask.revision !== baseline.revision);
  const patch = Object.fromEntries(taskFields.filter((key) => !sameValue(form[key], baseline[key])).map((key) => [key, form[key]]));
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => {
    // Collaboration can change task metadata while its untouched detail form
    // stays mounted. Never replace an actual unsaved task draft.
    if (pane === "collaboration" && !dirty && latestTask && latestTask.revision !== baseline.revision) { setForm(latestTask); setBaseline(latestTask); }
  }, [pane, dirty, latestTask, baseline.revision]);
  const change = (next: ScrumTask) => {
    setForm(next);
    if (taskFields.every((key) => sameValue(next[key], baseline[key]))) { clearDraft(draftKey); setDraftNotice(""); return; }
    const saved = writeDraft(draftKey, { version: 1, form: taskValues(next), baseline: taskValues(baseline) });
    setStorageFailed(!saved);
    setDraftNotice(saved ? "Borrador guardado en esta pestaña · aún no compartido." : "No se pudo guardar el borrador en esta pestaña. Mantén esta ventana abierta o copia tu trabajo.");
  };
  const update = <K extends keyof ScrumTask>(key: K, value: ScrumTask[K]) => change({ ...form, [key]: value });
  const reset = (next: ScrumTask) => { clearDraft(draftKey); setForm(next); setBaseline(next); setDraftNotice(""); setStorageFailed(false); setConfirmDelete(false); };
  useEffect(() => {
    if (!storageFailed || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [storageFailed, dirty]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (!changedElsewhere) void onSave(form, patch); };
  const current = latestTask ?? task;
  const origin = current.reviewSource && <section className="task-conflict"><strong>Origen: decisión de la Review · {current.reviewSource.sprintName}</strong><p>La decisión original se conserva aunque cambie este elemento.</p>{onReviewSource && <button type="button" disabled={busy} className="secondary-button small-button" onClick={() => onReviewSource(current.reviewSource!.sprintId)}>Ver Review de origen</button>}</section>;
  if (current.sprintId && isFinishedSprint(sprints.find((sprint) => sprint.id === current.sprintId))) return <ModalShell title={task.code} subtitle="Tarea conservada en un sprint finalizado · solo lectura." onClose={onClose} wide>
    <div className="simple-form">{origin}<h3>{current.title}</h3><TaskDescription value={current.description} /><p>{statuses[current.status]} · {current.points === null ? "Sin estimar" : `${current.points} pts`} · {current.assigneeName ?? "Sin asignar"}</p>
      {current.acceptanceCriteria.length > 0 && <><h4>Criterios de aceptación</h4><ul>{current.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></>}
      {current.checklist.length > 0 && <><h4>Checklist</h4><ul>{current.checklist.map((item) => <li key={item.id}>{item.done ? "✓" : "○"} {item.text}</li>)}</ul></>}
      {(dirty || draft) && <section className="task-conflict"><strong>Tu borrador se conserva</strong><p>El sprint finalizó mientras había cambios sin guardar. Puedes copiarlos antes de salir.</p><details><summary>Ver borrador sin guardar</summary><h4>{form.title}</h4><TaskDescription value={form.description} /><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(patch, null, 2)}</pre></details><button className="secondary-button" onClick={async () => { try { await navigator.clipboard.writeText(`${form.title}\n\n${form.description}\n\n${JSON.stringify(patch, null, 2)}`); setCopyNotice("Borrador copiado."); } catch { setCopyNotice("Selecciona y copia el texto del borrador."); } }}>Copiar borrador</button>{copyNotice && <p role="status">{copyNotice}</p>}</section>}
      <div className="modal-actions"><button className="secondary-button" onClick={() => void onCopyLink()}>Copiar enlace de tarea</button><button className="primary-button" onClick={onClose}>Listo</button></div>
      <TaskCollaboration actorId={actorId} task={current} members={members} busy={busy} readOnly onMutate={onCollaborate} />
    </div>
  </ModalShell>;
  return <ModalShell title={task.id ? task.code : "Nueva tarea"} subtitle={task.id ? "Actualiza la información y guarda los cambios." : "Añade una tarea clara y fácil de completar."} onClose={onClose} wide
    headerActions={task.id ? <button className="icon-button" type="button" aria-label="Copiar enlace de tarea" title="Copiar enlace de tarea" disabled={busy} onClick={() => void onCopyLink()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(0 1)" /></svg></button> : undefined}>
    {origin}
    {task.id && <nav className={collaborationStyles.tabs} aria-label="Secciones de la tarea"><button type="button" className="secondary-button small-button" aria-pressed={pane === "details"} onClick={() => setPane("details")}>Detalle</button><button type="button" className="secondary-button small-button" aria-pressed={pane === "collaboration"} onClick={() => setPane("collaboration")}>Conversación e impedimentos</button></nav>}
    {task.id && pane === "collaboration" && <TaskCollaboration actorId={actorId} task={current} members={members} busy={busy} readOnly={!latestTask} onMutate={onCollaborate} />}
    <form className="task-form" onSubmit={submit} hidden={pane !== "details"} style={pane !== "details" ? { display: "none" } : undefined}>
      {current.impediment && <section className={`task-conflict field-full`}><strong>Bloqueada · seguimiento: {current.impediment.ownerName}</strong><p>{current.impediment.reason}</p><button type="button" className="secondary-button small-button" onClick={() => setPane("collaboration")}>Ver bloqueo y conversación</button></section>}
      {changedElsewhere && <section className="task-conflict field-full" aria-label="Conflicto de tarea">
        <strong>{latestTask ? "Esta tarea cambió en otra sesión" : "Esta tarea ya no está disponible"}</strong>
        <p>Tu borrador sigue en el formulario. Cópialo antes de cargar la versión actual.</p>
        {latestTask && <details><summary>Comparar con la versión actual</summary><dl>{taskFields.filter((key) => !sameValue(latestTask[key], baseline[key])).map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{key === "status" ? statuses[latestTask.status] : key === "priority" ? priorities[latestTask.priority] : key === "assigneeId" ? latestTask.assigneeName ?? "Sin asignar" : key === "sprintId" ? sprints.find((item) => item.id === latestTask.sprintId)?.name ?? "Backlog" : key === "acceptanceCriteria" ? latestTask.acceptanceCriteria.join("\n") || "Sin criterios" : key === "checklist" ? latestTask.checklist.map((item) => `${item.done ? "✓" : "○"} ${item.text}`).join("\n") || "Sin pasos" : String(latestTask[key] ?? "Sin estimar")}</dd></div>)}</dl></details>}
        <div className="conflict-actions"><button type="button" className="secondary-button" onClick={async () => {
          try { await navigator.clipboard.writeText(`${form.title}\n\n${form.description}\n\n${JSON.stringify(patch, null, 2)}`); setCopyNotice("Borrador copiado."); }
          catch { setCopyNotice("No se pudo copiar. Selecciona y copia el texto del formulario."); }
        }}>Copiar borrador</button>
        {latestTask && <button type="button" className="secondary-button" onClick={() => reset(latestTask)}>Cargar versión actual</button>}</div>
        {copyNotice && <p role="status">{copyNotice}</p>}
      </section>}
      <label className="field field-full"><span>Título</span><input data-initial-focus value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Ej. Preparar encuesta para usuarios" maxLength={160} required /></label>
      <TaskEditor value={form.description} onChange={(value) => update("description", value)} />
      <details className={`field-full ${styles.section}`}>
        <summary>Criterios de aceptación · {form.acceptanceCriteria.length}</summary>
        <p>Resultados verificables propios de esta tarea. No sustituyen la Definition of Done común del equipo.</p>
        <ol className={styles.items}>{form.acceptanceCriteria.map((criterion, index) => <li key={index} className={styles.item}>
          <input type="text" aria-label={`Criterio de aceptación ${index + 1}`} value={criterion} maxLength={240} required onChange={(e) => update("acceptanceCriteria", form.acceptanceCriteria.map((value, i) => i === index ? e.target.value : value))} />
          <button className="icon-button" type="button" aria-label={`Quitar criterio ${index + 1}`} onClick={() => update("acceptanceCriteria", form.acceptanceCriteria.filter((_, i) => i !== index))}>×</button>
        </li>)}</ol>
        <button className="secondary-button small-button" type="button" disabled={form.acceptanceCriteria.length >= 20} onClick={() => update("acceptanceCriteria", [...form.acceptanceCriteria, ""])}>+ Añadir criterio</button>
      </details>
      <details className={`field-full ${styles.section}`}>
        <summary>Checklist · {form.checklist.filter((item) => item.done).length}/{form.checklist.length}</summary>
        <p>Pasos de trabajo opcionales. Marcarlos no cambia el estado de la tarea.</p>
        <ul className={styles.items}>{form.checklist.map((item, index) => <li key={item.id} className={styles.item}>
          <input type="checkbox" aria-label={`Completar paso ${index + 1}`} checked={item.done} onChange={(e) => update("checklist", form.checklist.map((value) => value.id === item.id ? { ...value, done: e.target.checked } : value))} />
          <input type="text" aria-label={`Paso ${index + 1}`} value={item.text} maxLength={240} required onChange={(e) => update("checklist", form.checklist.map((value) => value.id === item.id ? { ...value, text: e.target.value } : value))} />
          <button className="icon-button" type="button" aria-label={`Quitar paso ${index + 1}`} onClick={() => update("checklist", form.checklist.filter((value) => value.id !== item.id))}>×</button>
        </li>)}</ul>
        <button className="secondary-button small-button" type="button" disabled={form.checklist.length >= 30} onClick={() => update("checklist", [...form.checklist, { id: crypto.randomUUID(), text: "", done: false }])}>+ Añadir paso</button>
      </details>
      <label className="field"><span>Estado</span><select value={form.status} onChange={(event) => { const status = event.target.value as TaskStatus; change({ ...form, status, sprintId: status === "backlog" ? null : form.sprintId }); }}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value} disabled={value === "done" && !!current.impediment}>{label}</option>)}</select></label>
      <label className="field"><span>Prioridad</span><select value={form.priority} onChange={(event) => update("priority", event.target.value as TaskPriority)}>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>Puntos</span><select value={form.points ?? ""} onChange={(event) => update("points", event.target.value === "" ? null : Number(event.target.value))}><option value="">Sin estimar</option>{[1, 2, 3, 5, 8, 13].map((point) => <option key={point} value={point}>{point} {point === 1 ? "punto" : "puntos"}</option>)}</select></label>
      <label className="field"><span>Responsable</span><select value={form.assigneeId ?? ""} onChange={(event) => update("assigneeId", event.target.value || null)}><option value="">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="field field-full"><span>Sprint</span><select value={form.sprintId ?? ""} onChange={(event) => { const sprintId = event.target.value || null; change({ ...form, sprintId, status: sprintId ? (form.status === "backlog" ? "todo" : form.status) : "backlog" }); }}><option value="">Backlog del producto</option>{sprints.filter((sprint) => !isFinishedSprint(sprint)).map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status === "active" ? "Activo" : "Planeado"}</option>)}</select></label>
      {draftNotice && <div className={`field-full ${styles.draft}`}><span role="status">{draftNotice}</span>{dirty && <button type="button" onClick={() => reset(latestTask ?? task)}>Descartar borrador</button>}</div>}
      <div className="modal-actions field-full">
        {onDelete && (confirmDelete ? <span className="delete-confirm">¿Eliminar tarea y conversación? <button type="button" onClick={() => void onDelete(form.revision)} disabled={busy || changedElsewhere}>Sí, eliminar</button><button type="button" onClick={() => setConfirmDelete(false)}>No</button></span> : <button className="danger-link" type="button" disabled={changedElsewhere} onClick={() => setConfirmDelete(true)}>Eliminar tarea</button>)}
        <span className="modal-action-spacer" />
        <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" type="submit" disabled={busy || changedElsewhere || !form.title.trim()}>{busy ? "Guardando…" : task.id ? "Guardar cambios" : "Crear tarea"}</button>
      </div>
    </form>
  </ModalShell>;
}
