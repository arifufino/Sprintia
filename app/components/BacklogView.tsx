"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Member, ScrumTask, Sprint } from "../lib/types";
import styles from "./BacklogView.module.css";

const priorityLabels = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
export function BacklogView({ tasks, sprint, members, busy, onOpenTask, onNewTask, onAddToSprint, onReorder }: {
  tasks: ScrumTask[]; sprint: Sprint | null; members: Member[]; busy: boolean;
  onOpenTask: (task: ScrumTask) => void; onNewTask: () => void; onAddToSprint: (task: ScrumTask) => void;
  onReorder: (task: ScrumTask, beforeId: string | null) => Promise<boolean>;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [moving, setMoving] = useState(false);
  const pending = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    list.current?.querySelectorAll<HTMLElement>("[data-task-id]").forEach((row) => {
      const id = row.dataset.taskId!;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      next.set(id, top);
      if (previous !== undefined && previous !== top && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    positions.current = next;
  }, [tasks]);
  const move = async (task: ScrumTask, beforeId: string | null) => {
    if (busy || pending.current || task.id === beforeId) return;
    pending.current = true; setMoving(true); setDragging(null); setTarget(null);
    const ok = await onReorder(task, beforeId);
    setNotice(ok ? `${task.code}: orden guardado para todo el equipo.` : "No se pudo guardar el orden. Revisa la lista actual y vuelve a intentarlo.");
    pending.current = false; setMoving(false);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-reorder-id="${CSS.escape(task.id)}"]`)?.focus({ preventScroll: true }));
  };
  const step = (task: ScrumTask, index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= tasks.length) return;
    void move(task, direction === -1 ? tasks[index - 1].id : tasks[index + 2]?.id ?? null);
  };
  return <div className="content-pad content-narrow">
    <section className="section-intro">
      <div><span className="section-kicker">Ideas por priorizar</span><h2>Backlog del producto</h2><p>Ordena las próximas historias y llévalas al sprint cuando estén listas.</p></div>
      <button className="primary-button" onClick={onNewTask}>+ Añadir al backlog</button>
    </section>
    <div className={`backlog-summary ${styles.summary}`}><span><strong>{tasks.length}</strong> elementos pendientes</span><span><strong>{tasks.reduce((sum, task) => sum + (task.points ?? 0), 0)}</strong> puntos estimados</span><span><strong>{tasks.filter((task) => task.points === null).length}</strong> sin estimar</span><span><strong>{members.length}</strong> integrantes disponibles</span></div>
    <p className={styles.help} id="backlog-order-help">Arrastra el asa para priorizar, usa sus flechas ↑ ↓ o los botones de posición. El orden se comparte con el equipo.</p>
    <p className={styles.notice} role="status" aria-live="polite">{moving ? "Guardando orden…" : notice}</p>
    <ol className={styles.list} ref={list} aria-label="Backlog ordenado" aria-busy={moving}>
      {tasks.map((task, index) => <li key={task.id} className={`${styles.row} ${target === task.id ? styles.target : ""}`} data-task-id={task.id}
        onDragOver={(event) => { if (dragging && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setTarget(task.id); } }}
        onDrop={(event) => { event.preventDefault(); const source = tasks.find((item) => item.id === dragging); if (source) void move(source, task.id); }}>
        <div className={styles.order}>
          <button className={styles.handle} type="button" data-reorder-id={task.id} aria-label={`Reordenar ${task.code}`} aria-describedby="backlog-order-help" disabled={busy || moving}
            draggable={!busy && !moving} onDragStart={(event) => { setDragging(task.id); event.dataTransfer.setData("text/backlog-task", task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragging(null); setTarget(null); }}
            onKeyDown={(event) => { if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); if (event.key === "Home") void move(task, tasks[0].id); else if (event.key === "End") void move(task, null); else step(task, index, event.key === "ArrowUp" ? -1 : 1); } }}><span aria-hidden="true">⠿</span><small>{index + 1}</small></button>
          <div className={styles.arrows}><button type="button" disabled={busy || moving || index === 0} aria-label={`Subir ${task.code}`} onClick={() => step(task, index, -1)}>↑</button><button type="button" disabled={busy || moving || index === tasks.length - 1} aria-label={`Bajar ${task.code}`} onClick={() => step(task, index, 1)}>↓</button></div>
        </div>
        <button type="button" className={styles.story} onClick={() => onOpenTask(task)} aria-label={`${task.code}: ${task.title}`}><span>{task.code}{task.impediment ? " · Bloqueada" : ""}</span><strong>{task.title}</strong><small>{task.description || "Sin descripción"}</small></button>
        <div className={styles.metadata}><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span>{task.points === null ? "Sin estimar" : `${task.points} pts`}</span><span>{task.assigneeName ?? "Sin asignar"}</span>{task.checklist.length > 0 && <span>Checklist {task.checklist.filter((item) => item.done).length}/{task.checklist.length}</span>}</div>
        <button className={`secondary-button small-button ${styles.add}`} disabled={!sprint || busy || moving} onClick={() => onAddToSprint(task)}>Añadir al sprint</button>
      </li>)}
    </ol>
    {dragging && <div className={styles.dropEnd} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const source = tasks.find((item) => item.id === dragging); if (source) void move(source, null); }}>Mover al final del backlog</div>}
    {tasks.length === 0 && <div className="empty-state"><strong>Backlog despejado</strong><p>Todas las ideas ya están en un sprint. Añade una nueva cuando surja.</p><button className="secondary-button" onClick={onNewTask}>Crear tarea</button></div>}
  </div>;
}
