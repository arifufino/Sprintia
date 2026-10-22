"use client";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../lib/types";
import { canManageProject } from "../lib/permissions";
import styles from "./ProjectData.module.css";
export function ProjectData({ workspace }: { workspace: Workspace }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const active = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  async function download() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(`/api/export?workspace=${encodeURIComponent(workspace.id)}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? "No pudimos exportar el proyecto."); }
      const blob = await response.blob();
      if (!active.current || abort.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `sprintia-${workspace.id}.json`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setSaved(true);
    } catch (failure) { if (active.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "No pudimos descargar los datos."); }
    finally { controller.current = null; if (active.current) setBusy(false); }
  }
  return <section className={`content-pad content-narrow ${styles.section}`} aria-labelledby="project-data-title">
    <div className={styles.card}>
      <div className={styles.heading}><span className={styles.icon} aria-hidden="true">↧</span><div><span className="section-kicker">Datos del proyecto</span><h2 id="project-data-title">Tu trabajo, también fuera de Sprintia</h2></div></div>
      <p>Descarga {workspace.name} en JSON: acuerdos, tareas, sprints y resultados de las ceremonias. Incluye nombres y contenido privado del equipo, pero no correos de perfil ni credenciales.</p>
      <div className={styles.note}><strong>Exportación no es copia de seguridad</strong><p>Este archivo sirve para consultar y conservar el contenido. No restaura cuentas, auditoría ni todas las revisiones históricas. Las copias operativas se gestionan por separado.</p></div>
      {canManageProject(workspace.role) ? <button className="secondary-button" disabled={busy} onClick={() => void download()}>{busy ? "Preparando archivo…" : "Descargar proyecto · JSON"}</button> : <p>Solo el propietario o un administrador puede descargar el proyecto completo.</p>}
      {error && <p role="alert" className={styles.error}>{error} Puedes volver a intentarlo.</p>}
      {saved && <p role="status">Archivo preparado para descargar. Guárdalo en un lugar privado.</p>}
    </div>
  </section>;
}
