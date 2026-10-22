"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Sprint, Workspace } from "../lib/types";
import type { Measure, ReportChange, SprintReport } from "../lib/reports";
import shared from "./Collaboration.module.css";
import styles from "./ReportsView.module.css";

const date = (value: string) => new Date(value).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });
const day = (value: string) => new Date(value).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
const labels = { added: "Entrada al alcance", removed: "Retirada del alcance", completed: "Pasó a terminado", reopened: "Reabierta", estimate: "Reestimación", status: "Cambio de estado" };
const statuses = { active: "Activo", planned: "Planificado", completed: "Completado", cancelled: "Cancelado" };
type Unit = "tasks" | "points";
const amount = (measure: Measure | null | undefined, unit: Unit) => measure ? measure[unit] : "—";

export function ReportsView({ workspace, sprint, sprints, busy, syncToken, onSprint, onBoard }: { workspace: Workspace; sprint: Sprint | null; sprints: Sprint[]; busy: boolean; syncToken: string; onSprint: (id: string) => void; onBoard: () => void }) {
  const [data, setData] = useState<SprintReport | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [changes, setChanges] = useState<ReportChange[]>([]), [unit, setUnit] = useState<Unit>("tasks");
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const load = useCallback(async (before?: number) => {
    if (!sprint) return;
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ workspace: workspace.id, sprint: sprint.id }); if (before) params.set("before", String(before));
      const response = await fetch(`/api/reports?${params}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) { if ([401, 404].includes(response.status) && request === sequence.current) { setData(null); setChanges([]); } throw new Error("No pudimos calcular el informe. Revisa tu conexión o acceso al proyecto."); }
      const next = await response.json() as SprintReport;
      if (request !== sequence.current) return;
      setData(next); setChanges((previous) => before ? [...new Map([...previous, ...next.changes.rows].map((c) => [c.sequence, c])).values()].sort((a, b) => b.sequence - a.sequence) : next.changes.rows);
    } catch (cause) { if (!abort.signal.aborted && request === sequence.current) setError(cause instanceof Error ? cause.message : "No pudimos cargar el informe."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [workspace.id, sprint?.id]);
  useEffect(() => { if (!busy) void load(); return () => { ++sequence.current; controller.current?.abort(); }; }, [load, busy, syncToken]);
  const knownPoints = unit === "points", historical = !!sprint && ["completed", "cancelled"].includes(sprint.status);
  const rows = data?.trend.rows ?? [], max = Math.max(1, ...rows.filter((r) => r.status === "completed").map((r) => r.final?.done[unit] ?? 0));
  return <div className={`${shared.daily} ${styles.data}`}>
    <section className={`${shared.panel} ${shared.dailyIntro}`} aria-label="Contexto del informe"><div><span className={shared.kicker}>Historial real · decisiones del equipo</span><h2>Entender el recorrido, no medir a las personas</h2><p>El trabajo retirado no cuenta como completado. Las estimaciones iniciales se conservan y los periodos sin datos se señalan expresamente.</p><button className="secondary-button small-button" onClick={onBoard}>Volver al Tablero</button></div><label className="field"><span>Sprint del informe</span><select aria-label="Sprint del informe" value={sprint?.id ?? ""} onChange={(event) => onSprint(event.target.value)}>{!sprint && <option value="">Elige un sprint</option>}{sprints.map((item) => <option key={item.id} value={item.id}>{item.name} · {statuses[item.status]}</option>)}</select></label></section>
    {sprint && <>
      <div className={shared.heading}><span role="status">{loading ? "Calculando con el historial…" : data ? `Datos hasta ${date(data.asOf)}` : "Aún sin informe"}</span><button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load()}>Actualizar informe</button></div>
      {error && <p className={shared.notice} role="alert">{error}</p>}
      {data && <>
        <section className={shared.notice} aria-label="Cobertura de los datos"><strong>{data.coverage === "complete" ? "Serie desde el inicio registrado" : "Evolución no disponible con certeza"}</strong><p>{data.reason}</p>{data.initialAt && <small>Inicio registrado: {date(data.initialAt)}</small>}</section>
        <div className={shared.heading}><h3>{historical ? "Resultado conservado al finalizar" : "Estado observado del sprint"}</h3><label className="field"><span>Unidad del informe</span><select aria-label="Unidad del informe" value={unit} onChange={(event) => setUnit(event.target.value as Unit)}><option value="tasks">Tareas</option><option value="points">Puntos estimados conocidos</option></select></label></div>
        {knownPoints && <p className={shared.notice}>Los puntos suman solo estimaciones conocidas. Sin estimar no equivale a cero ni se convierte en una cuota. {data.current?.scope.unestimated ?? "—"} tareas sin estimar en el alcance observado.</p>}
        <div className={styles.metrics}>{[{ label: "Alcance inicial", value: data.initial?.scope }, { label: historical ? "Alcance al finalizar" : "Alcance observado", value: data.current?.scope }, { label: "Terminado", value: data.current?.done }, { label: "Pendiente", value: data.current?.pending }].map((item) => <article className={styles.metric} key={item.label}><span>{item.label}</span><strong>{amount(item.value, unit)}</strong><small>{item.value ? `${item.value.unestimated} sin estimar` : "Sin datos conservados"}</small></article>)}</div>
        <section className={shared.panel} aria-label="Evolución del sprint"><div className={shared.heading}><h3>Pendiente, terminado y alcance</h3><span className={shared.badge}>{knownPoints ? "Puntos conocidos" : "Tareas"}</span></div><p>Terminado es un estado de trabajo, no una certificación de la Definition of Done. La devolución al backlog al cerrar no hace desaparecer el pendiente de este gráfico.</p>
          {data.samples.length ? <TimelineChart data={data} unit={unit} /> : <p className={shared.notice}>Sin una serie completa no dibujamos una curva, ni rellenamos el pasado con ceros. El resultado observado anterior sigue siendo consultable.</p>}
        </section>
        <section className={shared.panel} aria-label="Cambios de alcance y estimación"><h3>Qué cambió en el alcance</h3>
          {data.coverage === "complete" ? <><div className={styles.metrics}><Metric label="Entradas al alcance" value={data.deltas.added} unit={unit} /><Metric label="Retiradas del alcance" value={data.deltas.removed} unit={unit} /><article className={styles.metric}><span>Reestimaciones</span><strong>{data.deltas.reestimated}</strong><small>{data.deltas.knownPointsDelta >= 0 ? "+" : ""}{data.deltas.knownPointsDelta} puntos conocidos netos, sin añadir tareas</small></article><article className={styles.metric}><span>Reaperturas</span><strong>{data.deltas.reopened}</strong><small>Transiciones, no personas ni tareas únicas</small></article></div><p>Entradas y retiradas se valoran con la estimación que tenían en ese momento. Una tarea que entra ya terminada es una entrada, no una finalización nueva.</p></> : <p>No se calculan totales históricos completos con cobertura insuficiente. La lista muestra únicamente los cambios medibles disponibles.</p>}
          <p>{data.coverage === "limit" ? "Consulta limitada: no se presentan totales históricos como completos." : `${data.changes.total} cambios medibles en este recorrido.`} Actualizar vuelve a la primera página.</p>
          {changes.length ? <ol className={shared.timeline}>{changes.map((change) => <li key={change.sequence}><div><strong>{change.code}</strong><time dateTime={change.at}>{date(change.at)}</time></div><p>{change.kinds.map((k) => labels[k]).join(" · ")}{change.deleted && " · tarea eliminada"}</p>{change.kinds.includes("estimate") && <p>Estimación: {change.beforePoints ?? "Sin estimar"} → {change.afterPoints ?? "Sin estimar"}</p>}{change.kinds.includes("removed") && <small>Retirar trabajo reduce el alcance; no lo convierte en terminado.</small>}</li>)}</ol> : <p>No hay cambios medibles para mostrar. Esto no demuestra que no hubiera cambios en periodos sin instrumentación.</p>}
          {data.changes.nextBefore && <button className="secondary-button small-button" disabled={loading || busy} onClick={() => void load(data.changes.nextBefore!)}>Ver cambios anteriores</button>}
        </section>
        <section className={shared.panel} aria-label="Tendencias de sprints finalizados"><h3>Resultados de sprints finalizados</h3><p>Se muestran {rows.length} de {data.trend.total} finalizados, como máximo los últimos {data.trend.limit}. Usa el selector para consultar sprints anteriores. Compara contexto y alcance, no clasifiques personas ni conviertas los puntos en objetivos de rendimiento.</p><p>Los cancelados se distinguen y no forman parte de las barras comparativas de completados.</p>
          {rows.length ? <ul className={styles.trend}>{rows.map((row) => <li key={row.id}><div className={shared.heading}><h4>{row.name}</h4><span className={shared.badge}>{statuses[row.status]}</span></div><small>{row.endedAt ? date(row.endedAt) : "Sin fecha de cierre conservada"}</small>{row.final ? <><p>Inicial: {amount(row.initial?.scope, unit)} · Alcance al finalizar: {amount(row.final.scope, unit)} · Terminado: {amount(row.final.done, unit)} · Devuelto al backlog: {amount(row.returned, unit)}</p>{row.status === "completed" && <div className={styles.bar} aria-label={`${row.name}: ${row.final.done[unit]} ${knownPoints ? "puntos conocidos" : "tareas"} terminados`}><span style={{ width: `${row.final.done[unit] / max * 100}%` }} /></div>}{knownPoints && <small>Sin estimar al finalizar: {row.final.scope.unestimated}</small>}</> : <p>No se conservó un resultado de cierre. No se inventa un valor cero.</p>}<button className="secondary-button small-button" disabled={busy || row.id === sprint.id} onClick={() => onSprint(row.id)}>Ver informe de {row.name}</button></li>)}</ul> : <p>Todavía no hay sprints finalizados. Las tendencias aparecerán cuando existan resultados reales.</p>}
        </section>
      </>}
    </>}
  </div>;
}
function Metric({ label, value, unit }: { label: string; value: Measure; unit: Unit }) { return <article className={styles.metric}><span>{label}</span><strong>{value[unit]}</strong><small>{value.unestimated} sin estimar</small></article>; }
function TimelineChart({ data, unit }: { data: SprintReport; unit: Unit }) {
  const values = data.samples, keys = ["scope", "pending", "done"] as const;
  const max = Math.max(1, ...values.flatMap((sample) => keys.map((key) => sample.totals[key][unit])));
  const first = Date.parse(values[0].at), duration = Date.parse(values.at(-1)!.at) - first;
  const x = (index: number) => values.length === 1 ? 500 : duration ? 10 + (Date.parse(values[index].at) - first) / duration * 980 : 10 + index / (values.length - 1) * 980;
  const y = (value: number) => 230 - value / max * 220;
  return <><div className={styles.legend}><span><i className={`${styles.swatch} ${styles.scope}`} />Alcance</span><span><i className={`${styles.swatch} ${styles.pending}`} />Pendiente</span><span><i className={styles.swatch} />Terminado</span></div><div className={styles.chart}><div className={styles.axis} aria-hidden="true"><span>{max}</span><span>0</span></div><div className={styles.plot}><svg viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-label={`Evolución en ${unit === "tasks" ? "tareas" : "puntos conocidos"}; datos exactos en la tabla siguiente`}><title>Pendiente, terminado y alcance en los cortes registrados</title>{[10, 120, 230].map((row) => <line key={row} x1="0" x2="1000" y1={row} y2={row} />)}{keys.map((key) => <path key={key} className={key === "scope" ? styles.scopeLine : key === "pending" ? styles.pendingLine : undefined} d={values.map((sample, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(sample.totals[key][unit])}`).join(" ")} />)}{values.length === 1 && keys.map((key) => <circle key={key} cx="500" cy={y(values[0].totals[key][unit])} r="4" />)}</svg><div className={styles.xAxis}><span>{day(values[0].at)}</span><span>{day(values.at(-1)!.at)}</span></div></div></div><p>{values.length === 1 ? "Solo hay un corte registrado; aún no hay evolución temporal." : `Valores al corte, cada ${data.intervalDays} ${data.intervalDays === 1 ? "día" : "días"}, más inicio y último dato. Las líneas unen observaciones; no predicen un ritmo de trabajo.`}</p><details><summary>Ver datos del gráfico</summary><div className={styles.table} tabIndex={0} role="region" aria-label="Tabla de datos del gráfico"><table><caption>Unidad: {unit === "tasks" ? "tareas" : "puntos conocidos"} · horas de Ecuador</caption><thead><tr><th scope="col">Corte</th><th scope="col">Alcance</th><th scope="col">Pendiente</th><th scope="col">Terminado</th><th scope="col">Sin estimar en alcance</th></tr></thead><tbody>{values.map((sample, i) => <tr key={i}><th scope="row">{date(sample.at)}</th><td>{sample.totals.scope[unit]}</td><td>{sample.totals.pending[unit]}</td><td>{sample.totals.done[unit]}</td><td>{sample.totals.scope.unestimated}</td></tr>)}</tbody></table></div></details></>;
}
