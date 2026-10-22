"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DailyNote, ScrumTask, Sprint } from "../lib/types";
import { clearTextDraft, readTextDraft, textDraftKey, writeTextDraft } from "../lib/collaboration-drafts";
import { TaskDescription } from "./TaskEditor";
import type { CollaborationMutation } from "./TaskCollaboration";
import styles from "./Collaboration.module.css";

export const localDay = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };

export function DailyView({ actorId, workspaceId, sprint, sprints, tasks, date, busy, onDate, onSprint, onOpenTask, onMutate }: { actorId: string; workspaceId: string; sprint: Sprint | null; sprints: Sprint[]; tasks: ScrumTask[]; date: string; busy: boolean; onDate: (date: string) => void; onSprint: (id: string) => void; onOpenTask: (task: ScrumTask) => void; onMutate: CollaborationMutation }) {
  const work = tasks.filter((task) => task.sprintId === sprint?.id);
  const blocked = work.filter((task) => task.impediment);
  const ongoing = work.filter((task) => task.status === "progress" || task.status === "review");
  const finished = sprint?.status === "completed" || sprint?.status === "cancelled";
  return <div className={styles.daily}>
    <section className={`${styles.panel} ${styles.dailyIntro}`} aria-label="Objetivo de la Daily"><div><span className={styles.kicker}>Inspeccionar y adaptar · Daily</span><h2>{sprint?.goal || "Elige un sprint para conversar sobre su objetivo"}</h2><p>¿Qué pone en riesgo el objetivo y qué ajustaremos hoy? Conversación del equipo, sin reportes individuales obligatorios.</p></div><label className="field"><span>Sprint</span><select aria-label="Sprint de la Daily" value={sprint?.id ?? ""} onChange={(event) => onSprint(event.target.value)}>{!sprint && <option value="">Elige un sprint</option>}{sprints.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status === "active" ? "Activo" : item.status === "planned" ? "Planificado" : item.status === "completed" ? "Completado" : "Cancelado"}</option>)}</select></label></section>
    {sprint && <>
      {sprint.status !== "active" && <p className={styles.notice}>{finished ? "Este sprint finalizó. Sus notas siguen disponibles para consulta; el resultado guardado se encuentra en el Tablero." : "Este sprint está planificado. Puedes revisar su trabajo; las notas de Daily estarán disponibles al iniciarlo."}</p>}
      {!finished && <div className={styles.metrics} aria-label="Estado del trabajo del sprint"><div><strong>{blocked.length}</strong><span>Bloqueos</span></div><div><strong>{ongoing.length}</strong><span>En curso / revisión</span></div><div><strong>{work.filter((task) => task.status === "done").length}</strong><span>Terminadas</span></div></div>}
      <div className={styles.dailyGrid}>
        <section className={styles.collaboration} aria-label="Trabajo para conversar"><div className={styles.heading}><div><span className={styles.kicker}>Primero, despejar el camino</span><h3>Impedimentos del sprint</h3></div></div>
          {finished ? <p>Consulta la instantánea del Tablero para revisar los impedimentos que existían al finalizar.</p> : blocked.length ? <ul className={styles.blockedList}>{blocked.map((task) => <li key={task.id}><button onClick={() => onOpenTask(task)} aria-label={`Revisar bloqueo de ${task.code}`}><strong>{task.code} · {task.title}</strong><span className={styles.prose}>{task.impediment!.reason}</span><small>Seguimiento: {task.impediment!.ownerName}</small><span>Revisar y conversar <span aria-hidden="true">↗</span></span></button></li>)}</ul> : <p className={styles.notice}>No hay bloqueos abiertos en este sprint. Revisa el trabajo en curso y acuerda el siguiente paso.</p>}
          {!finished && <><div className={styles.heading}><h3>Trabajo en curso y revisión</h3><span className={styles.kicker}>Abrir para comentar o registrar un bloqueo</span></div><ul className={styles.blockedList}>{ongoing.map((task) => <li key={task.id}><button onClick={() => onOpenTask(task)} aria-label={`Conversar sobre ${task.code}`}><strong>{task.code} · {task.title}</strong><span>{task.status === "review" ? "En revisión" : "En curso"} · {task.assigneeName ?? "Sin asignar"}{task.impediment ? " · Bloqueada" : ""}</span></button></li>)}</ul>{!ongoing.length && <p>No hay trabajo en curso o revisión.</p>}</>}
        </section>
        <div className={styles.collaboration}><label className="field"><span>Fecha de la Daily</span><input type="date" required value={date} onChange={(event) => { if (event.target.value) onDate(event.target.value); }} /></label><DailyNoteEditor key={`${workspaceId}:${sprint.id}:${date}`} actorId={actorId} workspaceId={workspaceId} sprint={sprint} date={date} busy={busy} onMutate={onMutate} /></div>
      </div>
    </>}
  </div>;
}

function DailyNoteEditor({ actorId, workspaceId, sprint, date, busy, onMutate }: { actorId: string; workspaceId: string; sprint: Sprint; date: string; busy: boolean; onMutate: CollaborationMutation }) {
  const key = textDraftKey("daily", actorId, workspaceId, `${sprint.id}:${date}`);
  const inputId = useId();
  const [form, setForm] = useState(() => readTextDraft(key));
  const [note, setNote] = useState<DailyNote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const sequence = useRef(0); const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setLoading(true); setError("");
    try {
      const response = await fetch(`/api/daily?${new URLSearchParams({ workspace: workspaceId, sprint: sprint.id, date })}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) { if ([401, 404].includes(response.status)) setNote(null); throw new Error("No pudimos cargar las notas de esta fecha. Comprueba tu conexión o acceso."); }
      const data = await response.json() as DailyNote; if (request !== sequence.current) return;
      setNote(data); setForm(readTextDraft(key));
    } catch (cause) { if (!abort.signal.aborted && request === sequence.current) setError(cause instanceof Error ? cause.message : "No pudimos cargar las notas."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [date, key, sprint.id, workspaceId]);
  useEffect(() => { if (!busy) void load(); return () => { ++sequence.current; controller.current?.abort(); }; }, [load, sprint.dailyRevision, busy]);
  const readOnly = sprint.status !== "active";
  const stale = !!form && !!note && form.revision !== note.revision;
  const text = form?.text ?? note?.text ?? "";
  return <section className={styles.note} aria-label="Acuerdos de Daily"><div><span className={styles.kicker}>Opcional · compartido con el equipo</span><h3>Acuerdos y próximos pasos</h3><p>Guarda solo lo útil para adaptar el plan. No es un control de asistencia ni de productividad individual.</p></div>
    {error && <p className={styles.notice} role="alert">{error}<button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load()}>Reintentar notas</button></p>}
    {loading && !note && <p role="status">Cargando acuerdos…</p>}
    {readOnly ? <><TaskDescription value={note?.text || "No hay notas compartidas para esta fecha."} />{form && <details><summary>Mi borrador sin guardar · solo lectura</summary><p className={styles.prose}>{form.text}</p><p>Puedes copiarlo. El sprint ya no admite cambios.</p></details>}</> : <form className={styles.commentForm} onSubmit={async (event) => { event.preventDefault(); if (!note || stale || busy || !form) return; const saved = await onMutate({ action: "saveDailyNote", sprintId: sprint.id, date, text, revision: form.revision }, "Acuerdos de Daily compartidos.", { textDraftKey: key }); if (saved) { setForm(null); await load(); } }}>
      <div className="field"><label htmlFor={inputId}>Notas del equipo</label><textarea id={inputId} value={text} disabled={!note} rows={6} maxLength={2000} placeholder="Decisiones, ajustes del plan o próximos pasos acordados…" onChange={(event) => { const next = { text: event.target.value, revision: form?.revision ?? note?.revision ?? 0 }; setForm(next); setStorageFailed(!writeTextDraft(key, next)); }} /></div>
      <small>{storageFailed ? "No se pudo guardar el borrador en esta pestaña. Mantén esta ventana o copia tus notas." : "Borrador en esta pestaña · aún no compartido"}</small>
      {stale && <div className={styles.notice} role="status"><strong>Las notas cambiaron en otra sesión.</strong><p>Tu borrador sigue aquí. Cópialo antes de cargar la versión actual.</p><details><summary>Ver notas compartidas actuales</summary><TaskDescription value={note?.text ?? ""} /></details></div>}
      <div className={styles.actions}><button type="button" className="secondary-button" disabled={!note || busy} onClick={() => { clearTextDraft(key); setForm(null); }}>{stale ? "Cargar notas actuales y descartar mi borrador" : "Descartar borrador de notas"}</button><button type="submit" className="primary-button" disabled={!note || !form || stale || busy}>Guardar acuerdos</button></div>
    </form>}
    {note?.updatedAt && <small>Último cambio: {new Date(note.updatedAt).toLocaleString("es-EC")} · {note.updatedByName}</small>}
    <button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load()}>Actualizar notas</button>
  </section>;
}
