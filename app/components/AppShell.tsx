"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { AppUser, Workspace } from "../lib/types";
import type { AppView } from "../lib/navigation";
import { accessLabels, canManageProject } from "../lib/permissions";
import styles from "./AppShell.module.css";
import { useDisclosure, useExitMotion, useOverlayLayer } from "./overlay";

export type View = AppView;
const WIDTH_KEY = "sprintia-sidebar-width";
const COLLAPSED_KEY = "sprintia-sidebar-collapsed";
const MIN_WIDTH = 220;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 264;
const navigation: { id: View; label: string; path: string }[] = [
  { id: "board", label: "Tablero", path: "M3 3h18v18H3z M9 3v18 M15 3v18" },
  { id: "backlog", label: "Backlog", path: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" },
  { id: "daily", label: "Daily", path: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2v-9.5A8.5 8.5 0 1 1 21 11.5Z M7 9h8 M7 13h5" },
  { id: "summary", label: "Resumen", path: "M4 20V4 M4 20h16 M8 15l4-5 4 2 5-7" },
  { id: "team", label: "Equipo", path: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" },
  { id: "settings", label: "Configuración", path: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6" },
];

function Icon({ path }: { path: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

function storedValue(key: string) {
  try { return typeof window === "undefined" ? null : window.localStorage.getItem(key); } catch { return null; }
}
function initialWidth() {
  const value = storedValue(WIDTH_KEY);
  const width = value === null || value.trim() === "" ? DEFAULT_WIDTH : Number(value);
  return Number.isFinite(width) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) : DEFAULT_WIDTH;
}
function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia("(max-width: 900px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function AppShell({ user, workspace, workspaces, memberCount, avatarColor, backlogCount, view, title, eyebrow, onNavigate, onWorkspace, onInvite, onCreateWorkspace, onNewTask, signOutAction, children, overlays }: {
  user: AppUser; workspace: Workspace; workspaces: Workspace[]; memberCount: number; avatarColor: string;
  backlogCount: number; view: View; title: string; eyebrow: string;
  onNavigate: (view: View) => void; onWorkspace: (id: string) => void; onInvite: () => void;
  onCreateWorkspace: () => void; onNewTask: () => void; signOutAction: () => Promise<void>;
  children: ReactNode; overlays: ReactNode;
}) {
  const [width, setWidth] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(() => storedValue(COLLAPSED_KEY) === "true");
  const menu = useDisclosure<boolean>();
  const [resizing, setResizing] = useState(false);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia("(max-width: 900px)").matches, () => false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const mobileClose = useRef<HTMLButtonElement>(null);
  const menuVisible = mobile && menu.value !== null;
  const closeMobileMenu = () => menu.close();
  useExitMotion(sidebarRef, menu.closing, menu.finish);
  useOverlayLayer({ ref: sidebarRef, active: menuVisible, modal: true, origin: menu.origin, onClose: closeMobileMenu });

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const closeOnModeChange = () => menu.close();
    query.addEventListener("change", closeOnModeChange);
    return () => query.removeEventListener("change", closeOnModeChange);
  }, [menu.close]);

  useEffect(() => {
    if (resizing) return;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch { /* Preferences remain usable when storage is unavailable. */ }
  }, [width, collapsed, resizing]);

  const afterMenu = (action: () => void) => { if (menuVisible) menu.close(action); else action(); };
  const navigate = (next: View) => afterMenu(() => onNavigate(next));
  const toggleCollapsed = (value: boolean) => {
    setCollapsed(value);
    requestAnimationFrame(() => (value ? reopenRef : collapseRef).current?.focus());
  };
  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""} ${menuVisible ? styles.mobileOpen : ""} ${resizing ? styles.resizing : ""}`} style={{ "--sidebar-width": `${width}px` } as CSSProperties}>
      <aside id="workspace-sidebar" ref={sidebarRef} className={styles.sidebar} data-motion={menuVisible ? menu.closing ? "closing" : "open" : undefined} aria-label="Barra lateral" inert={mobile ? !menuVisible : collapsed}>
        <div className={styles.sidebarInner}>
          <div className={styles.brandRow}>
            <div className={styles.brand}><span className={styles.brandMark}>S</span><span>Sprintia</span></div>
            <button ref={collapseRef} className={`icon-button ${styles.desktopControl}`} onClick={() => toggleCollapsed(true)} aria-label="Ocultar barra lateral" aria-expanded={!collapsed} aria-controls="workspace-sidebar"><Icon path="M3 4h18v16H3z M9 4v16 M16 9l-3 3 3 3" /></button>
            <button ref={mobileClose} className={`icon-button ${styles.mobileControl}`} onClick={closeMobileMenu} aria-label="Cerrar menú"><Icon path="m6 6 12 12 M18 6 6 18" /></button>
          </div>
          <div className={styles.sidebarScroll}>
            <label className={styles.workspacePicker}>
              <span className={styles.eyebrow}>Espacio de trabajo</span>
              <select value={workspace.id} onChange={(event) => { const id = event.target.value; afterMenu(() => onWorkspace(id)); }} aria-label="Cambiar espacio de trabajo">
                {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <nav className={styles.navigation} aria-label="Navegación principal">
              {navigation.map((item) => <button key={item.id} className={view === item.id ? styles.active : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon path={item.path} /><span>{item.label}</span>{item.id === "backlog" && <small>{backlogCount}</small>}</button>)}
            </nav>
            <section className={styles.project} aria-label="Proyecto actual">
              <span className={styles.eyebrow}>Proyecto actual</span>
              <strong title={workspace.name}>{workspace.name}</strong>
              <p>{memberCount} {memberCount === 1 ? "integrante" : "integrantes"}</p>
              {canManageProject(workspace.role) && <button className="secondary-button" onClick={() => afterMenu(onInvite)}>+ Invitar al equipo</button>}
            </section>
          </div>
          <footer className={styles.footer}>
            <button className={`secondary-button ${styles.workspaceAction}`} onClick={() => afterMenu(onCreateWorkspace)} aria-label="Crear o unirse a otro proyecto"><Icon path="M12 5v14 M5 12h14" /><span>Otro proyecto</span></button>
            <div className={styles.profile}>
              <span className={styles.avatar} style={{ backgroundColor: avatarColor }} aria-hidden="true">{initials}</span>
              <div className={styles.profileName}><strong title={user.name}>{user.name}</strong><small>{accessLabels[workspace.role]}</small></div>
              <form action={signOutAction}><button className="icon-button" type="submit" aria-label="Cerrar sesión"><Icon path="M9 4H4v16h5 M9 12h12 M17 8l4 4-4 4" /></button></form>
            </div>
          </footer>
        </div>
        <div className={styles.resizer} role="separator" tabIndex={0} aria-label="Ajustar ancho de la barra lateral" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} aria-valuetext={`${width} píxeles`}
          onPointerDown={(event) => { if (event.button !== 0) return; drag.current = { x: event.clientX, width }; setResizing(true); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
          onPointerMove={(event) => { if (drag.current) setWidth(Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.current.width + event.clientX - drag.current.x)))); }}
          onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 32 : 16;
            const next = event.key === "Home" ? MIN_WIDTH : event.key === "End" ? MAX_WIDTH : event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step : null;
            if (next !== null) { event.preventDefault(); setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next))); }
          }} />
      </aside>
      {menuVisible && <button className={styles.backdrop} data-overlay-backdrop data-motion={menu.closing ? "closing" : "open"} onClick={closeMobileMenu} aria-label="Cerrar menú lateral" tabIndex={-1} />}
      <main className={styles.main}>
        <header className={styles.topbar}>
          {collapsed && <button ref={reopenRef} className={`icon-button ${styles.desktopControl}`} aria-label="Mostrar barra lateral" aria-expanded="false" aria-controls="workspace-sidebar" onClick={() => toggleCollapsed(false)}><Icon path="M3 4h18v16H3z M9 4v16 M13 9l3 3-3 3" /></button>}
          <button ref={mobileTrigger} data-overlay-return className={`icon-button ${styles.mobileControl}`} onClick={() => menu.open(true)} aria-label="Abrir menú" aria-expanded={menuVisible} aria-controls="workspace-sidebar"><Icon path="M4 6h16 M4 12h16 M4 18h16" /></button>
          <div className={styles.heading}><span className={styles.eyebrow}>{eyebrow}</span><h1 data-overlay-return tabIndex={-1}>{title}</h1></div>
          {view !== "settings" && <div className={styles.actions}>{canManageProject(workspace.role) && <button className={`secondary-button ${styles.invite}`} onClick={onInvite}>Invitar</button>}<button className="primary-button" onClick={onNewTask}><span>+</span> Nueva tarea</button></div>}
        </header>
        {children}
      </main>
      <nav className={styles.mobileNav} aria-label="Navegación móvil">
        {navigation.map((item) => <button key={item.id} aria-current={view === item.id ? "page" : undefined} className={view === item.id ? styles.active : ""} onClick={() => navigate(item.id)}><Icon path={item.path} /><span>{item.id === "settings" ? "Ajustes" : item.label}</span></button>)}
      </nav>
      <div className={styles.overlays}>{overlays}</div>
    </div>
  );
}
