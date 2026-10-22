"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { DiscussionPage, Member, ScrumTask, TaskUpdate } from "../lib/types";
import { readTextDraft, textDraftKey, writeTextDraft } from "../lib/collaboration-drafts";
import type { PendingChange } from "../lib/task-drafts";
import { TaskDescription } from "./TaskEditor";
import { useDisclosure, useExitMotion } from "./overlay";
import styles from "./Collaboration.module.css";

export type CollaborationMutation = (payload: Record<string, unknown>, message: string, options?: PendingChange["options"]) => Promise<boolean>;
const labels = { comment: "Comentario", "impediment.reported": "Bloqueo registrado", "impediment.updated": "Seguimiento actualizado", "impediment.resolved": "Bloqueo resuelto" };
const stamp = (date: string) => new Date(date).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });

export function TaskCollaboration({ actorId, task, members, busy, readOnly = false, onMutate }: { actorId: string; task: ScrumTask; members: Member[]; busy: boolean; readOnly?: boolean; onMutate: CollaborationMutation }) {
  const key = textDraftKey("comment", actorId, task.workspaceId, task.id);
  const inputId = useId();
  const [text, setText] = useState(() => readTextDraft(key)?.text ?? "");
  const [storageFailed, setStorageFailed] = useState(false);
  const [entries, setEntries] = useState<TaskUpdate[]>([]);
  const entriesRef = useRef<TaskUpdate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const olderLoaded = useRef(false);
  const load = useCallback(async (before?: string) => {
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ workspace: task.workspaceId, task: task.id }); if (before) params.set("before", before);
      const response = await fetch(`/api/discussion?${params}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) { if ([401, 404].includes(response.status) && request === sequence.current) { entriesRef.current = []; setEntries([]); setCursor(null); olderLoaded.current = false; } throw new Error("No pudimos cargar la conversación. Revisa tu conexión o acceso al proyecto."); }
      const data = await response.json() as DiscussionPage; if (request !== sequence.current) return;
      const previous = entriesRef.current;
      // A busy conversation can add more than one page between refreshes.
      // Keep loaded context, but offer the cursor covering the new gap.
      const previousIds = new Set(previous.map((entry) => entry.id));
      const gap = !before && previous.length > 0 && data.entries.length > 0 && !data.entries.some((entry) => previousIds.has(entry.id));
      const merged = [...new Map([...previous, ...data.entries].map((entry) => [entry.id, entry])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      entriesRef.current = merged; setEntries(merged);
      if (before) olderLoaded.current = true;
      if (before || !olderLoaded.current || gap) setCursor(data.nextCursor);
      setText(readTextDraft(key)?.text ?? "");
    } catch (cause) { if (!abort.signal.aborted && request === sequence.current) setError(cause instanceof Error ? cause.message : "No pudimos cargar la conversación."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [key, task.id, task.workspaceId]);
  useEffect(() => { if (!busy) void load(); return () => { ++sequence.current; controller.current?.abort(); }; }, [load, task.discussionRevision, busy]);
  const mode = useDisclosure<"report" | "update" | "resolve">();
  const formRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [baseline, setBaseline] = useState(task.revision);
  const [impedimentId, setImpedimentId] = useState(task.impediment?.id);
  const [reason, setReason] = useState("");
  const [ownerId, setOwnerId] = useState(actorId);
  const [resolution, setResolution] = useState("");
  const [notice, setNotice] = useState("");
  const finishForm = useCallback(() => { mode.finish(); requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>("[data-impediment-action]")?.focus()); }, [mode.finish]);
  useExitMotion(formRef, mode.closing, finishForm);
  useLayoutEffect(() => { if (mode.value && !mode.closing) formRef.current?.querySelector<HTMLElement>("textarea")?.focus(); }, [mode.value, mode.closing]);
  const begin = (operation: "report" | "update" | "resolve") => { setBaseline(task.revision); setImpedimentId(task.impediment?.id); setReason(task.impediment?.reason ?? ""); setOwnerId(task.impediment?.ownerId ?? actorId); setResolution(""); setNotice(""); mode.open(operation); };
  const stale = baseline !== task.revision || (mode.value !== "report" && impedimentId !== task.impediment?.id);
  const invalidOperation = mode.value === "report" ? !!task.impediment : !task.impediment;
  const canWrite = !readOnly && task.status !== "done";
  return <section className={styles.collaboration} aria-label="Conversación e impedimentos">
    <section ref={panelRef} className={styles.panel} aria-label="Impedimento actual"><div className={styles.heading}><div><span className={styles.kicker}>Seguimiento</span><h3>{task.impediment ? "Esta tarea está bloqueada" : "Sin impedimentos abiertos"}</h3></div><span className={styles.badge}>{task.impediment ? "Bloqueada" : "Disponible"}</span></div>
      {task.impediment ? <><p className={styles.prose}>{task.impediment.reason}</p><p>Seguimiento: <strong>{task.impediment.ownerName}</strong> · registrado por {task.impediment.createdByName}</p><small>{stamp(task.impediment.createdAt)}</small></> : <p>Registra qué impide avanzar y quién ayudará a darle seguimiento. El bloqueo no cambia la columna de trabajo.</p>}
      {!mode.value && !readOnly && <div className={styles.actions}>{task.impediment ? <><button data-impediment-action className="secondary-button small-button" disabled={busy} onClick={() => begin("update")}>Editar seguimiento</button><button data-impediment-action className="primary-button small-button" disabled={busy} onClick={() => begin("resolve")}>Resolver bloqueo</button></> : canWrite ? <button data-impediment-action className="secondary-button" disabled={busy} onClick={() => begin("report")}>Registrar bloqueo</button> : <p>La tarea está terminada. Cambia su estado antes de registrar un bloqueo.</p>}</div>}
      {mode.value && <div ref={formRef} className={styles.inline} data-motion={mode.closing ? "closing" : "open"}>
        <form onSubmit={async (event) => { event.preventDefault(); if (stale || readOnly) return; const saved = await onMutate({ action: "changeImpediment", id: task.id, revision: baseline, operation: mode.value, impedimentId, reason, ownerId, resolution }, mode.value === "resolve" ? "Bloqueo resuelto. Su historial permanece en la conversación." : "Seguimiento del bloqueo guardado."); if (saved) { mode.close(); setNotice("Cambio compartido con el equipo."); } }}>
          <fieldset className={styles.fields} disabled={busy || mode.closing || readOnly}>
            {mode.value === "resolve" ? <div className="field"><label htmlFor={`${inputId}-resolution`}>Cómo se resolvió</label><textarea id={`${inputId}-resolution`} value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={1000} rows={3} required /></div> : <><div className="field"><label htmlFor={`${inputId}-reason`}>Qué impide avanzar</label><textarea id={`${inputId}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={3} required /></div><label className="field"><span>Responsable de seguimiento</span><select aria-label="Responsable de seguimiento" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></>}
            {stale && !busy && !mode.closing && <div className={styles.notice} role="status">La tarea cambió. Tu texto se conserva.<button type="button" className="secondary-button small-button" onClick={() => { setBaseline(task.revision); setImpedimentId(task.impediment?.id); }}>Revisar versión actual del bloqueo</button></div>}
            {readOnly && <p>El sprint finalizó. Copia tu texto antes de salir.</p>}
            {invalidOperation && <p>El estado del bloqueo cambió. Vuelve sin guardar para elegir una acción disponible.</p>}
            <div className={styles.actions}><button type="button" className="secondary-button" onClick={() => mode.close()}>Volver sin guardar</button><button type="submit" className="primary-button" disabled={stale || invalidOperation || !(mode.value === "resolve" ? resolution : reason).trim() || (mode.value !== "resolve" && !ownerId)}>{mode.value === "resolve" ? "Confirmar resolución" : "Guardar bloqueo"}</button></div>
          </fieldset>
        </form>
      </div>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className={styles.discussion} aria-label="Historial y conversación"><div className={styles.heading}><div><span className={styles.kicker}>Contexto compartido</span><h3>Historial y conversación</h3></div><button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load()}>Actualizar conversación</button></div>
      {error && <p role="alert" className={styles.notice}>{error}<button className="secondary-button small-button" onClick={() => void load()}>Reintentar conversación</button></p>}
      {cursor && <button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load(cursor)}>Cargar mensajes anteriores</button>}
      <ol className={styles.timeline}>{entries.map((entry) => <li key={entry.id}><div><strong>{entry.actorName}</strong><span className={styles.kicker}>{labels[entry.kind]}</span><time dateTime={entry.createdAt}>{stamp(entry.createdAt)}</time></div><TaskDescription value={entry.text} />{entry.kind !== "comment" && <p>{entry.after ? `Seguimiento: ${entry.after.ownerName}` : `Bloqueo anterior: ${entry.before?.reason ?? "Sin detalle"}`}</p>}</li>)}</ol>
      {!entries.length && !loading && !error && <p>Aún no hay mensajes. Comparte contexto o una decisión útil para esta tarea.</p>}
      {loading && <p role="status">Comprobando conversación…</p>}
      {readOnly ? <><p className={styles.notice}>Conversación de solo lectura: el sprint finalizó o la tarea ya no está disponible.</p>{text && <div className="field"><label htmlFor={`${inputId}-draft`}>Mi comentario sin enviar · puedes copiarlo</label><textarea id={`${inputId}-draft`} readOnly value={text} rows={3} /></div>}</> : <form className={styles.commentForm} onSubmit={async (event) => { event.preventDefault(); if (!text.trim() || busy) return; const saved = await onMutate({ action: "addTaskComment", id: task.id, text }, "Comentario compartido.", { textDraftKey: key }); if (saved) { setText(""); await load(); } }}><div className="field"><label htmlFor={`${inputId}-comment`}>Nuevo comentario</label><textarea id={`${inputId}-comment`} value={text} onChange={(event) => { setText(event.target.value); setStorageFailed(!writeTextDraft(key, { text: event.target.value, revision: 0 })); }} rows={3} maxLength={2000} placeholder="Contexto, una pregunta o el siguiente paso…" /></div><small>{storageFailed ? "No se pudo guardar el borrador en la pestaña. Conserva esta ventana o copia tu texto." : "Borrador en esta pestaña · máximo 2000 caracteres"}</small><button className="primary-button" disabled={busy || !text.trim()} type="submit">Enviar comentario</button></form>}
    </section>
  </section>;
}
