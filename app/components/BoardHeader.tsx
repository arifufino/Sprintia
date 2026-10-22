import type { CSSProperties } from "react";
import type { Member, Sprint, TaskPriority } from "../lib/types";
import styles from "./BoardLayout.module.css";

export function SprintOverview({ sprint, sprints, selectedSprintId, onSprintChange, onNewSprint, daysLeft, donePoints, totalPoints, progress }: {
  sprint: Sprint; sprints: Sprint[]; selectedSprintId: string; onSprintChange: (id: string) => void;
  onNewSprint: () => void; daysLeft: number; donePoints: number; totalPoints: number; progress: number;
}) {
  return <section className={styles.overview} aria-label="Resumen del sprint">
    <div className={styles.sprintDetails}>
      <label className={styles.sprintPicker}><span className={styles.label}>Sprint</span><select aria-label="Sprint" value={selectedSprintId} onChange={(event) => onSprintChange(event.target.value)}>{sprints.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "planned" ? " · Planificado" : item.status === "completed" ? " · Completado" : item.status === "cancelled" ? " · Cancelado" : ""}</option>)}</select></label>
      <div className={styles.goal}><span className={styles.label}>Objetivo</span><strong>{sprint.goal || "Sin objetivo definido"}</strong></div>
      <button className={styles.addSprint} onClick={onNewSprint} type="button">+ Sprint</button>
    </div>
    <div className={styles.metrics}>
      <div><strong>{sprint.status === "planned" ? Math.round((Date.parse(sprint.endDate) - Date.parse(sprint.startDate)) / 86400000) + 1 : sprint.status === "active" ? daysLeft : "—"}</strong><span className={styles.label}>{sprint.status === "planned" ? "Días previstos" : sprint.status === "active" ? "Días restantes" : "Finalizado"}</span></div>
      {(() => {
        const historical = sprint.status === "completed" || sprint.status === "cancelled";
        const total = historical ? sprint.outcome?.tasks.reduce((sum, task) => sum + (task.points ?? 0), 0) ?? 0 : totalPoints;
        const done = historical ? sprint.outcome?.tasks.filter((task) => !task.returnedToBacklog).reduce((sum, task) => sum + (task.points ?? 0), 0) ?? 0 : donePoints;
        const percent = historical ? total ? Math.round(done / total * 100) : 0 : progress;
        return <><div><strong>{historical && !sprint.outcome ? "—" : done}<small>/{historical && !sprint.outcome ? "—" : total}</small></strong><span className={styles.label}>Puntos listos</span></div><div className={styles.progress} role="img" aria-label={historical && !sprint.outcome ? "Sin instantánea histórica" : `${percent}% completado`} style={{ "--progress": `${Math.max(0, Math.min(100, percent)) * 3.6}deg` } as CSSProperties}><span>{historical && !sprint.outcome ? "—" : `${percent}%`}</span></div></>;
      })()}
    </div>
  </section>;
}

export function BoardToolbar({ search, onSearch, priorityFilter, onPriorityFilter, assigneeFilter, onAssigneeFilter, members, count }: {
  search: string; onSearch: (value: string) => void; priorityFilter: "all" | TaskPriority; onPriorityFilter: (value: "all" | TaskPriority) => void;
  assigneeFilter: string; onAssigneeFilter: (value: string) => void; members: Member[]; count: number;
}) {
  return <section className={styles.toolbar} aria-label="Filtros del tablero">
    <label className={styles.search}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por título o código…" aria-label="Buscar tareas" /></label>
    <select value={priorityFilter} onChange={(event) => onPriorityFilter(event.target.value as "all" | TaskPriority)} aria-label="Filtrar por prioridad"><option value="all">Todas las prioridades</option><option value="urgent">Urgente</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select>
    <select value={assigneeFilter} onChange={(event) => onAssigneeFilter(event.target.value)} aria-label="Filtrar por responsable"><option value="all">Todo el equipo</option><option value="none">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
    <span className={styles.count} aria-live="polite">{count} {count === 1 ? "tarea" : "tareas"}</span>
  </section>;
}
