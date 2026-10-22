"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReviewEntry, ReviewEvidence, ReviewTask, ScrumTask, Sprint, SprintReview, Workspace } from "../lib/types";
import { clearReviewDraft, readReviewDraft, reviewDraftKey, writeReviewDraft } from "../lib/review-drafts";
import type { CollaborationMutation } from "./TaskCollaboration";
import { TaskDescription } from "./TaskEditor";
import { DialogLifecycle, ModalShell } from "./ModalShell";
import { useDisclosure } from "./overlay";
import shared from "./Collaboration.module.css";
import styles from "./ReviewView.module.css";

type IncrementDraft = { revision: number; sprintRevision: number; governanceRevision: number; summary: string; taskIds: string[]; evidence: ReviewEvidence[] };
type EntryDraft = { kind: "feedback" | "decision"; text: string };
type DecisionDraft = { title: string; description: string };
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const validVersion = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const validIncrement = (v: unknown): v is IncrementDraft => isRecord(v) && [v.revision, v.sprintRevision, v.governanceRevision].every(validVersion) && validText(v.summary, 2000) && Array.isArray(v.taskIds) && v.taskIds.length <= 200 && v.taskIds.every((id) => validText(id, 128)) && Array.isArray(v.evidence) && v.evidence.length <= 10 && v.evidence.every((e) => isRecord(e) && validText(e.label, 100) && validText(e.url, 2048));
const validEntry = (v: unknown): v is EntryDraft => isRecord(v) && ["feedback", "decision"].includes(String(v.kind)) && validText(v.text, 2000);
const validDecision = (v: unknown): v is DecisionDraft => isRecord(v) && validText(v.title, 160) && validText(v.description, 1200);
const time = (date: string) => new Date(date).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });

export function ReviewView({ actorId, workspace, sprint, sprints, tasks, busy, pending, error, onRetry, onSprint, onBoard, onSettings, onOpenTask, onMutate }: {
  actorId: string; workspace: Workspace; sprint: Sprint | null; sprints: Sprint[]; tasks: ScrumTask[]; busy: boolean; pending: boolean; error: string; onRetry?: () => void; onSprint: (id: string) => void; onBoard: () => void; onSettings: () => void; onOpenTask: (id: string) => void; onMutate: CollaborationMutation;
}) {
  const [data, setData] = useState<SprintReview | null>(null);
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState("");
  const [entries, setEntries] = useState<ReviewEntry[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const loaded = useRef<ReviewEntry[]>([]), older = useRef(false), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const focusedRefresh = useRef<string | undefined>(undefined);
  const entryKey = reviewDraftKey(actorId, workspace.id, sprint?.id ?? "", "entry");
  const [entryForm, setEntryForm] = useState<EntryDraft>(() => readReviewDraft(entryKey, validEntry) ?? { kind: "feedback", text: "" });
  const [storageFailed, setStorageFailed] = useState(false);
  const dialog = useDisclosure<"increment" | ReviewEntry>();
  const inputId = useId();
  const load = useCallback(async (before?: string, entryId?: string) => {
    if (!sprint) return;
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setLoading(true); setLoadError("");
    try {
      const params = new URLSearchParams({ workspace: workspace.id, sprint: sprint.id }); if (before) params.set("before", before); if (entryId) params.set("entry", entryId);
      const response = await fetch(`/api/review?${params}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) {
        if ([401, 404].includes(response.status) && request === sequence.current) { setData(null); setEntries([]); loaded.current = []; setCursor(null); older.current = false; }
        throw new Error("No pudimos cargar la Review. Comprueba tu conexión o acceso.");
      }
      const next = await response.json() as SprintReview; if (request !== sequence.current) return;
      const previous = loaded.current, ids = new Set(previous.map((entry) => entry.id));
      const gap = !before && !entryId && previous.length > 0 && next.entries.length > 0 && !next.entries.some((entry) => ids.has(entry.id));
      const merged = [...new Map([...previous, ...next.entries].map((entry) => [entry.id, entry])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      loaded.current = merged; setEntries(merged); setData(next);
      if (before) older.current = true;
      if (!entryId && (before || !older.current || gap)) setCursor(next.nextCursor);
      if (entryId && focusedRefresh.current === entryId) focusedRefresh.current = undefined;
      setEntryForm(readReviewDraft(entryKey, validEntry) ?? { kind: "feedback", text: "" });
    } catch (cause) { if (!abort.signal.aborted && request === sequence.current) setLoadError(cause instanceof Error ? cause.message : "No pudimos cargar la Review."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [entryKey, sprint?.id, workspace.id]);
  useEffect(() => { if (!busy) void load(undefined, focusedRefresh.current); return () => { ++sequence.current; controller.current?.abort(); }; }, [load, busy, sprint?.reviewRevision]);
  const writable = !!sprint && ["active", "completed"].includes(sprint.status);
  const canRecord = writable && (sprint?.status === "active" || !!sprint?.outcome);
  const dod = sprint?.status === "completed" ? sprint.outcome?.definitionOfDone ?? [] : workspace.definitionOfDone;
  const candidates: ReviewTask[] = sprint?.status === "completed" ? sprint.outcome?.tasks.filter((task) => task.status === "done" && !task.returnedToBacklog && !task.impediment) ?? [] : tasks.filter((task) => task.sprintId === sprint?.id && task.status === "done" && !task.impediment);
  const increment = data?.increment;
  const selectedDecision = typeof dialog.value === "object" && dialog.value ? dialog.value : null;
  const currentDecision = selectedDecision ? entries.find((entry) => entry.id === selectedDecision.id) ?? selectedDecision : null;
  return <div className={shared.daily}>
    <section className={`${shared.panel} ${shared.dailyIntro}`} aria-label="Contexto de la Review"><div><span className={shared.kicker}>Inspeccionar el resultado · adaptar el producto</span><h2>{sprint?.goal || "Elige un sprint para revisar su resultado"}</h2><p>Demuestra lo conseguido, recoge feedback y decide el siguiente paso. No es una aprobación obligatoria para entregar software.</p><button className="secondary-button small-button" onClick={onBoard}>Volver al Tablero</button></div><label className="field"><span>Sprint de la Review</span><select aria-label="Sprint de la Review" value={sprint?.id ?? ""} onChange={(event) => onSprint(event.target.value)}>{!sprint && <option value="">Elige un sprint</option>}{sprints.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status === "active" ? "Activo" : item.status === "completed" ? "Completado" : item.status === "planned" ? "Planificado" : "Cancelado"}</option>)}</select></label></section>
    {sprint && <>
      {!writable && <p className={shared.notice}>{sprint.status === "planned" ? "La Review estará disponible al iniciar el sprint. Puedes consultar lo que ya se haya registrado." : "Sprint cancelado. Se conserva la Review anterior para consulta, sin certificar un nuevo incremento."}</p>}
      {sprint.status === "completed" && !sprint.outcome && <p className={shared.notice}>Este sprint antiguo no conserva una instantánea de cierre. Puedes recoger feedback, pero no inventar ni certificar su trabajo histórico.</p>}
      {loadError && <p className={shared.notice} role="alert">{loadError}</p>}
      <div className={shared.heading}><span role="status">{loading ? "Comprobando Review…" : "Resultado y conversación del equipo"}</span><button className="secondary-button small-button" disabled={busy || loading} onClick={() => void load()}>Actualizar Review</button></div>
      <div className={styles.columns}>
        <section className={shared.panel} aria-label="Incremento registrado"><div className={shared.heading}><div><span className={shared.kicker}>Valor demostrado</span><h3>Incremento y evidencias</h3></div>{canRecord && <button className="secondary-button small-button" disabled={!data || busy || pending} onClick={() => dialog.open("increment")}>{increment ? "Actualizar incremento" : "Registrar resultado"}</button>}</div>
          {increment ? <><TaskDescription value={increment.summary} /><p className={shared.kicker}>Registrado por {increment.actorName} · {time(increment.recordedAt)} · {increment.sourceStatus === "active" ? "durante el sprint" : "con la instantánea de cierre"}</p><h4>{increment.tasks.length ? `${increment.tasks.length} ${increment.tasks.length === 1 ? "elemento verificado" : "elementos verificados"} por el equipo` : "Sin trabajo certificado como incremento"}</h4><p>Registro en el momento de la revisión. No cambia automáticamente si después se modifica una tarea.</p><ul className={styles.tasks}>{increment.tasks.map((task) => <li key={task.id}><details><summary>{task.code} · {task.title}</summary><TaskDescription value={task.description} />{!!task.acceptanceCriteria.length && <ul>{task.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>}{tasks.some((item) => item.id === task.id) && <button className="secondary-button small-button" onClick={() => onOpenTask(task.id)}>Ver tarea actual</button>}</details></li>)}</ul>
          <details><summary>Definition of Done al registrar</summary>{increment.definitionOfDone.length ? <ul>{increment.definitionOfDone.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : <p>No había criterios compartidos; no se certificó trabajo.</p>}<p>Objetivo del producto: {increment.productGoal || "No definido"}</p></details>
          <h4>Evidencias de demostración</h4>{increment.evidence.length ? <ul className={styles.links}>{increment.evidence.map((link, index) => <li key={index}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} <span aria-hidden="true">↗</span></a></li>)}</ul> : <p>No se añadieron enlaces. Puedes demostrar el resultado sin adjuntar archivos.</p>}</> : <p>Aún no hay un resultado registrado. Marcar una tarea como terminada no certifica por sí solo la Definition of Done.</p>}
        </section>
        <section className={shared.discussion} aria-label="Feedback y decisiones"><div><span className={shared.kicker}>Aprender con quienes usan el producto</span><h3>Feedback y decisiones</h3><p>Recoge lo observado y separa las decisiones que el equipo quiere llevar al backlog.</p></div>
          {writable ? <form className={shared.commentForm} onSubmit={async (event) => { event.preventDefault(); if (!entryForm.text.trim() || busy || pending) return; const saved = await onMutate({ action: "addReviewEntry", sprintId: sprint.id, ...entryForm }, "Feedback de la Review compartido.", { reviewDraftKey: entryKey }); if (saved) { setEntryForm({ kind: "feedback", text: "" }); await load(); } }}>
            <label className="field"><span>Tipo de aportación</span><select aria-label="Tipo de aportación" value={entryForm.kind} onChange={(event) => { const next = { ...entryForm, kind: event.target.value as EntryDraft["kind"] }; setEntryForm(next); setStorageFailed(!writeReviewDraft(entryKey, next)); }}><option value="feedback">Feedback</option><option value="decision">Decisión o acuerdo</option></select></label>
            <div className="field"><label htmlFor={inputId}>Aportación a la Review</label><textarea id={inputId} rows={4} maxLength={2000} value={entryForm.text} onChange={(event) => { const next = { ...entryForm, text: event.target.value }; setEntryForm(next); setStorageFailed(!writeReviewDraft(entryKey, next)); }} placeholder="Qué observamos y qué decidimos mejorar…" /></div><small>{storageFailed ? "Borrador solo en memoria. Copia tu texto antes de cerrar." : "Borrador en esta pestaña · aún no compartido"}</small><button className="primary-button" disabled={!data || busy || pending || !entryForm.text.trim()}>Compartir aportación</button>
          </form> : entryForm.text ? <div className={shared.notice}><strong>Tu aportación sin enviar se conserva</strong><TaskDescription value={entryForm.text} /></div> : null}
          {cursor && <button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load(cursor)}>Cargar aportaciones anteriores</button>}
          <ol className={shared.timeline}>{entries.map((entry) => <li key={entry.id}><div><strong>{entry.actorName}</strong><span className={shared.kicker}>{entry.kind === "feedback" ? "Feedback" : "Decisión"}</span><time dateTime={entry.createdAt}>{time(entry.createdAt)}</time></div><TaskDescription value={entry.text} />{entry.backlogTask ? <div className={styles.reference}><span>Backlog: {entry.backlogTask.code} · {entry.backlogTask.title}</span>{tasks.some((task) => task.id === entry.backlogTask!.id) ? <button className="secondary-button small-button" onClick={() => onOpenTask(entry.backlogTask!.id)}>Abrir elemento del backlog</button> : <small>El elemento ya no está disponible; conservamos su referencia.</small>}</div> : entry.kind === "decision" && writable && <button className="secondary-button small-button" disabled={busy || pending} onClick={async () => { await load(undefined, entry.id); dialog.open(entry); }}>Crear elemento del backlog</button>}</li>)}</ol>
          {!entries.length && !loading && <p>Todavía no hay aportaciones en esta Review.</p>}
        </section>
      </div>
      {dialog.value && data && createPortal(<DialogLifecycle.Provider value={{ state: dialog, busy, error: error || loadError, onRetry }}><ModalShell title={dialog.value === "increment" ? "Registrar resultado de la Review" : "Decisión al backlog"} subtitle={dialog.value === "increment" ? "Selecciona solo trabajo que el equipo ha verificado. No hay aprobación automática." : "Confirma el nuevo elemento. Se creará sin estimación, responsable ni sprint."} wide onClose={() => dialog.close()}>
        {dialog.value === "increment" ? <IncrementForm key={`${sprint.id}:increment`} actorId={actorId} workspace={workspace} sprint={sprint} review={data} candidates={candidates} dod={dod} allowed={canRecord} busy={busy || pending} onClose={() => dialog.close()} onSettings={() => dialog.close(onSettings)} onSave={async (payload, key) => { const saved = await onMutate(payload, "Resultado y evidencias de la Review guardados.", { reviewDraftKey: key }); if (saved) { await load(); dialog.close(); } }} /> : currentDecision && <DecisionForm key={currentDecision.id} actorId={actorId} workspaceId={workspace.id} sprint={sprint} entry={currentDecision} allowed={writable} busy={busy || pending} onClose={() => dialog.close()} onSave={async (payload, key) => { focusedRefresh.current = currentDecision.id; const saved = await onMutate(payload, "Decisión convertida en un elemento del backlog.", { reviewDraftKey: key }); if (saved) { await load(undefined, currentDecision.id); dialog.close(); } }} />}
      </ModalShell></DialogLifecycle.Provider>, document.body)}
    </>}
  </div>;
}

function IncrementForm({ actorId, workspace, sprint, review, candidates, dod, allowed, busy, onClose, onSettings, onSave }: { actorId: string; workspace: Workspace; sprint: Sprint; review: SprintReview; candidates: ReviewTask[]; dod: string[]; allowed: boolean; busy: boolean; onClose: () => void; onSettings: () => void; onSave: (payload: Record<string, unknown>, key: string) => Promise<void> }) {
  const key = reviewDraftKey(actorId, workspace.id, sprint.id, "increment");
  const initial = (): IncrementDraft => ({ revision: review.revision, sprintRevision: sprint.revision, governanceRevision: workspace.governanceRevision, summary: review.increment?.summary ?? "", taskIds: review.increment?.tasks.map((task) => task.id) ?? [], evidence: review.increment?.evidence ?? [] });
  const [form, setForm] = useState(() => readReviewDraft(key, validIncrement) ?? initial());
  const [verified, setVerified] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const fieldId = useId();
  const stale = form.revision !== review.revision || form.sprintRevision !== sprint.revision || (sprint.status === "active" && form.governanceRevision !== workspace.governanceRevision);
  const unavailable = form.taskIds.some((id) => !candidates.some((task) => task.id === id));
  const change = (next: IncrementDraft) => { setForm(next); setStorageFailed(!writeReviewDraft(key, next)); setVerified(false); };
  useEffect(() => { if (!readReviewDraft(key, validIncrement)) { setForm(initial()); setVerified(false); } }, [review.revision]);
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!allowed || stale || unavailable || !verified || busy) return; void onSave({ action: "saveSprintReview", sprintId: sprint.id, ...form, verified }, key); }}>
    <div className="field"><label htmlFor={`${fieldId}-summary`}>Resultado conseguido</label><textarea data-initial-focus id={`${fieldId}-summary`} rows={4} maxLength={2000} required value={form.summary} onChange={(event) => change({ ...form, summary: event.target.value })} readOnly={!allowed} /></div>
    <fieldset className={styles.selection}><legend>Trabajo que cumple la Definition of Done</legend><p>Solo se ofrece trabajo terminado y sin bloqueos. Seleccionarlo no mueve tarjetas ni cambia criterios o checklist.</p>{!dod.length && <div className={shared.notice}>No hay Definition of Done registrada. Puedes guardar el resultado sin certificar tareas.{sprint.status === "active" && <button className="secondary-button small-button" type="button" onClick={onSettings}>Configurar acuerdos del equipo</button>}</div>}
      {candidates.map((task) => <label key={task.id} className={styles.check}><input type="checkbox" disabled={!allowed || (!form.taskIds.includes(task.id) && (!dod.length || form.taskIds.length >= 200))} checked={form.taskIds.includes(task.id)} onChange={(event) => change({ ...form, taskIds: event.target.checked ? [...form.taskIds, task.id] : form.taskIds.filter((id) => id !== task.id) })} /><span>{task.code} · {task.title}</span></label>)}{!candidates.length && <p>No hay trabajo elegible. Registra con honestidad el resultado, aunque no haya incremento.</p>}
      {unavailable && <p role="status">Hay tareas seleccionadas que ya no son elegibles. Revisa la selección con la versión actual.</p>}
      <details><summary>Ver acuerdos aplicables</summary><ul>{dod.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul></details>
    </fieldset>
    <fieldset className={styles.selection}><legend>Enlaces de demostración · opcionales</legend>{form.evidence.map((link, index) => <div key={index} className={styles.evidence}><label className="field"><span>Nombre de evidencia {index + 1}</span><input value={link.label} maxLength={100} required onChange={(event) => change({ ...form, evidence: form.evidence.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /></label><label className="field"><span>Enlace de evidencia {index + 1}</span><input type="url" value={link.url} maxLength={2048} required placeholder="https://…" onChange={(event) => change({ ...form, evidence: form.evidence.map((item, i) => i === index ? { ...item, url: event.target.value } : item) })} /></label><button type="button" className="secondary-button small-button" onClick={() => change({ ...form, evidence: form.evidence.filter((_, i) => i !== index) })}>Quitar evidencia {index + 1}</button></div>)}<button type="button" className="secondary-button small-button" disabled={!allowed || form.evidence.length >= 10} onClick={() => change({ ...form, evidence: [...form.evidence, { label: "", url: "" }] })}>Añadir evidencia</button></fieldset>
    {stale && <section className={shared.notice} role="status"><strong>El incremento, las tareas o los acuerdos cambiaron.</strong><p>Tu borrador sigue aquí. Compara el registro actual antes de volver a confirmar.</p><details><summary>Ver resultado compartido actual</summary><TaskDescription value={review.increment?.summary ?? "Aún no registrado"} /></details><button type="button" className="secondary-button" onClick={() => { change({ ...form, revision: review.revision, sprintRevision: sprint.revision, governanceRevision: workspace.governanceRevision, taskIds: form.taskIds.filter((id) => candidates.some((task) => task.id === id)) }); }}>Revisar versión actual de la Review</button></section>}
    {!allowed && <p className={shared.notice}>Este sprint ya no admite el registro. Puedes copiar tu borrador antes de salir.</p>}
    <label className={styles.check}><input type="checkbox" checked={verified} disabled={!allowed || stale} onChange={(event) => setVerified(event.target.checked)} /><span>Confirmo la revisión del resultado y la Definition of Done aplicable.</span></label>
    <small>{storageFailed ? "Borrador solo en memoria. Copia el contenido antes de cerrar." : "Borrador en esta pestaña · no se comparte hasta guardar"}</small>
    <div className={shared.actions}><button className="secondary-button" type="button" onClick={onClose}>Volver sin guardar</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { clearReviewDraft(key); setForm(initial()); setVerified(false); }}>Descartar borrador de Review</button><button className="primary-button" disabled={busy || !allowed || stale || unavailable || !verified || !form.summary.trim()}>Guardar resultado</button></div>
  </form>;
}

function DecisionForm({ actorId, workspaceId, sprint, entry, allowed, busy, onClose, onSave }: { actorId: string; workspaceId: string; sprint: Sprint; entry: ReviewEntry; allowed: boolean; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>, key: string) => Promise<void> }) {
  const key = reviewDraftKey(actorId, workspaceId, sprint.id, `decision:${entry.id}`);
  const [form, setForm] = useState(() => readReviewDraft(key, validDecision) ?? { title: entry.text.slice(0, 160), description: entry.text.slice(0, 1200) });
  const [failed, setFailed] = useState(false), inputId = useId();
  const change = (next: DecisionDraft) => { setForm(next); setFailed(!writeReviewDraft(key, next)); };
  return entry.backlogTask ? <p role="status">Esta decisión ya tiene un elemento: {entry.backlogTask.code}. No se creará otro.</p> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!allowed || busy) return; void onSave({ action: "convertReviewDecision", sprintId: sprint.id, entryId: entry.id, ...form }, key); }}><TaskDescription value={entry.text} /><div className="field"><label htmlFor={`${inputId}-title`}>Título del elemento</label><input data-initial-focus id={`${inputId}-title`} value={form.title} required maxLength={160} onChange={(event) => change({ ...form, title: event.target.value })} /></div><div className="field"><label htmlFor={`${inputId}-description`}>Descripción del elemento</label><textarea id={`${inputId}-description`} rows={4} value={form.description} maxLength={1200} onChange={(event) => change({ ...form, description: event.target.value })} /></div><p>La decisión se conserva en la Review y el nuevo elemento guarda su origen. Crear el elemento no lo inicia ni lo estima.</p>{!allowed && <p role="status">El sprint cambió. Tu borrador sigue disponible para copiarlo.</p>}<small>{failed ? "Borrador solo en memoria. Copia tu texto antes de cerrar." : "Borrador en esta pestaña"}</small><div className={shared.actions}><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || !allowed || !form.title.trim()}>Crear en el backlog</button></div></form>;
}
