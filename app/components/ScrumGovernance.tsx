"use client";

import { useState } from "react";
import type { Member, ScrumConfiguration, Workspace } from "../lib/types";
import { accessLabels, canManageAccess, canManageProject } from "../lib/permissions";
import { ModalShell } from "./ModalShell";
import styles from "./ScrumGovernance.module.css";

export function ScrumSettings({ workspace, members, onEdit }: { workspace: Workspace; members: Member[]; onEdit: () => void }) {
  const person = (id: string | null) => members.find((member) => member.id === id)?.name ?? "Sin asignar";
  return <section className={`content-pad content-narrow ${styles.settings}`} aria-labelledby="scrum-settings-title">
    <div className={styles.heading}>
      <div><span className="section-kicker">Acuerdos del proyecto</span><h2 id="scrum-settings-title">Configuración Scrum</h2><p>Compartida con todo el equipo de {workspace.name}.</p></div>
      {canManageProject(workspace.role) ? <button className="secondary-button" onClick={onEdit}>Editar configuración Scrum</button> : <span className={styles.badge}>Solo lectura</span>}
    </div>
    <div className={styles.grid}>
      <article className={styles.card}><h3>Objetivo del producto</h3><p className={styles.prose}>{workspace.productGoal || "Todavía no se ha definido un objetivo compartido."}</p>
        <h3>Definition of Done</h3><p className={styles.hint}>El acuerdo de calidad común para considerar terminado un incremento.</p>
        {workspace.definitionOfDone.length ? <ul className={styles.criteria}>{workspace.definitionOfDone.map((item) => <li key={item}>{item}</li>)}</ul> : <p className={styles.hint}>Sin criterios definidos. Acordadlos antes de evaluar el trabajo terminado.</p>}
      </article>
      <article className={styles.card}><h3>Responsabilidades Scrum</h3>
        <dl className={styles.responsibilities}><div><dt>Product Owner</dt><dd>{person(workspace.productOwnerId)}</dd></div><div><dt>Scrum Master</dt><dd>{person(workspace.scrumMasterId)}</dd></div><div><dt>Developers</dt><dd>{workspace.developerIds.length ? workspace.developerIds.map(person).join(", ") : "Sin asignar"}</dd></div></dl>
        <p className={styles.hint}>Estas responsabilidades no conceden permisos administrativos. El propietario no es Scrum Master automáticamente.</p>
      </article>
    </div>
  </section>;
}

export function ScrumConfigurationModal({ workspace, members, onClose, onSave }: {
  workspace: Workspace; members: Member[]; onClose: () => void; onSave: (configuration: ScrumConfiguration) => Promise<void>;
}) {
  // Snapshot the revision with the draft: background refresh must never silently overwrite either.
  const [form, setForm] = useState<ScrumConfiguration>(() => ({
    productGoal: workspace.productGoal, definitionOfDone: workspace.definitionOfDone,
    productOwnerId: workspace.productOwnerId, scrumMasterId: workspace.scrumMasterId,
    developerIds: workspace.developerIds, governanceRevision: workspace.governanceRevision,
  }));
  const [criteria, setCriteria] = useState(workspace.definitionOfDone.join("\n"));
  const [validation, setValidation] = useState("");
  const editable = canManageProject(workspace.role);
  const lines = criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return <ModalShell title="Configuración Scrum" subtitle="Define los acuerdos de este proyecto. No cambia el acceso de las personas." onClose={onClose} wide>
    <form className={`simple-form ${styles.form}`} onSubmit={(event) => {
      event.preventDefault();
      if (lines.length > 20 || lines.some((line) => line.length > 300) || new Set(lines).size !== lines.length) {
        setValidation("Usa hasta 20 criterios distintos, de un máximo de 300 caracteres cada uno."); return;
      }
      setValidation(""); void onSave({ ...form, definitionOfDone: lines });
    }}>
      {!editable && <p role="status">Tu acceso cambió. Solo el propietario o un administrador pueden guardar esta configuración.</p>}
      {validation && <p role="alert" className="dialog-error">{validation}</p>}
      <fieldset className={styles.fields} disabled={!editable}>
        <label className="field"><span>Objetivo del producto</span><textarea data-initial-focus rows={3} maxLength={1000} value={form.productGoal} onChange={(event) => setForm({ ...form, productGoal: event.target.value })} placeholder="¿Qué resultado a largo plazo queremos conseguir?" /></label>
        <label className="field"><span>Definition of Done</span><textarea rows={4} maxLength={6020} value={criteria} onChange={(event) => setCriteria(event.target.value)} aria-describedby="dod-hint" placeholder={"Pruebas acordadas superadas\nDocumentación actualizada"} /></label>
        <p id="dod-hint" className={styles.hint}>Un criterio por línea · hasta 20 · 300 caracteres por criterio. No son los criterios de aceptación de una tarea.</p>
        <div className="form-row">
          <label className="field"><span>Product Owner</span><select value={form.productOwnerId ?? ""} onChange={(event) => setForm({ ...form, productOwnerId: event.target.value || null })}><option value="">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label className="field"><span>Scrum Master</span><select value={form.scrumMasterId ?? ""} onChange={(event) => setForm({ ...form, scrumMasterId: event.target.value || null })}><option value="">Sin asignar</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        </div>
        <fieldset className={styles.developers}><legend>Developers</legend><p className={styles.hint}>Quienes construyen el incremento. Una persona puede combinar esta responsabilidad con otra.</p>
          {members.map((member) => <label key={member.id} className={styles.check}><input type="checkbox" checked={form.developerIds.includes(member.id)} onChange={(event) => setForm({ ...form, developerIds: event.target.checked ? [...form.developerIds, member.id] : form.developerIds.filter((id) => id !== member.id) })} /><span>{member.name}</span></label>)}
        </fieldset>
      </fieldset>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={!editable}>Guardar configuración</button></div>
    </form>
  </ModalShell>;
}

export function MemberAccessModal({ workspace, member, onClose, onSave }: {
  workspace: Workspace; member: Member; onClose: () => void; onSave: (role: "admin" | "member", expectedRole: string, accessRevision: number) => Promise<void>;
}) {
  const [expectedRole] = useState(member.role);
  const [accessRevision] = useState(member.accessRevision);
  const [role, setRole] = useState<"admin" | "member">(member.role === "admin" ? "admin" : "member");
  return <ModalShell title="Acceso al proyecto" subtitle={member.name} onClose={onClose}>
    <form className="simple-form" onSubmit={(event) => { event.preventDefault(); void onSave(role, expectedRole, accessRevision); }}>
      <p className={styles.hint}>Solo el propietario puede cambiar el acceso. Las responsabilidades Scrum se conservan.</p>
      <label className="field"><span>Nivel de acceso</span><select data-initial-focus value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")} disabled={!canManageAccess(workspace.role)}><option value="member">Miembro</option><option value="admin">Administrador</option></select></label>
      <div className={styles.notice}><strong>{accessLabels[role]}</strong><p>{role === "admin" ? "Podrá modificar los acuerdos Scrum y generar o revocar invitaciones, además de trabajar con tareas y sprints. No podrá cambiar permisos." : "Podrá consultar los acuerdos y trabajar con tareas y sprints. No podrá administrar invitaciones ni cambiar permisos."}</p></div>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={!canManageAccess(workspace.role) || member.role === "owner"}>Guardar acceso</button></div>
    </form>
  </ModalShell>;
}

export function InviteModal({ workspace, onClose, onManage }: {
  workspace: Workspace; onClose: () => void; onManage: (operation: "rotate" | "revoke", invitationRevision: number) => Promise<boolean>;
}) {
  const [feedback, setFeedback] = useState("");
  const [confirmation, setConfirmation] = useState<{ operation: "rotate" | "revoke"; revision: number } | null>(null);
  const code = workspace.inviteCode;
  const link = typeof window === "undefined" || !code ? "" : `${window.location.origin}/?join=${code}`;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setFeedback("Copiado al portapapeles."); }
    catch { setFeedback("No se pudo copiar. Puedes seleccionar y copiar el enlace manualmente."); }
  };
  return <ModalShell title="Invitar al equipo" subtitle={`Comparte el acceso a “${workspace.name}”.`} onClose={onClose}>
    <div className="invite-modal-body">
      {!canManageProject(workspace.role) ? <p>Solo el propietario o un administrador pueden gestionar invitaciones.</p> : <>
        <div className="invite-note"><span aria-hidden="true">i</span><p>Cualquier persona con una cuenta de Google y este enlace podrá unirse como miembro. No recibe responsabilidades Scrum automáticamente.</p></div>
        {code ? <>
          <label className="field"><span>Código de invitación</span><div className="copy-field"><code>{code}</code><button type="button" onClick={() => void copy(code)}>Copiar código</button></div></label>
          <label className="field"><span>Enlace directo</span><div className="copy-field copy-link"><input readOnly value={link} /><button type="button" onClick={() => void copy(link)}>Copiar enlace</button></div></label>
        </> : <div className={styles.notice}><strong>Invitaciones desactivadas</strong><p>Los enlaces anteriores ya no admiten nuevos integrantes. El equipo actual conserva su acceso.</p></div>}
        {feedback && <p className={styles.hint} role="status">{feedback}</p>}
        {!confirmation ? <div className={styles.actions}>
          <button className="secondary-button" onClick={() => setConfirmation({ operation: "rotate", revision: workspace.invitationRevision })}>{code ? "Renovar invitación" : "Crear nueva invitación"}</button>
          {code && <button className="secondary-button" onClick={() => setConfirmation({ operation: "revoke", revision: workspace.invitationRevision })}>Revocar invitación</button>}
        </div> : <section className={styles.notice} aria-label="Confirmar cambio de invitación">
          <strong>{confirmation.operation === "revoke" ? "¿Desactivar las invitaciones?" : "¿Generar una invitación nueva?"}</strong>
          <p>El enlace anterior dejará de funcionar. No se elimina ningún integrante ni su trabajo. Las admisiones ya aceptadas pueden terminar.</p>
          <div className={styles.actions}><button className="secondary-button" onClick={() => setConfirmation(null)}>Cancelar cambio</button><button className="primary-button" onClick={async () => { if (await onManage(confirmation.operation, confirmation.revision)) { setConfirmation(null); setFeedback(""); } }}>{confirmation.operation === "revoke" ? "Confirmar revocación" : "Confirmar nueva invitación"}</button></div>
        </section>}
      </>}
      <div className="modal-actions"><span className="modal-action-spacer" /><button className="primary-button" type="button" onClick={onClose}>Listo</button></div>
    </div>
  </ModalShell>;
}
