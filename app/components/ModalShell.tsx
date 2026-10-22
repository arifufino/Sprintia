"use client";

import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useExitMotion, useOverlayLayer, type Disclosure } from "./overlay";

export const DialogLifecycle = createContext<{ state: Pick<Disclosure<string>, "closing" | "finish" | "origin">; busy: boolean; error: string; onRetry?: () => void } | null>(null);

export function ModalShell({ title, subtitle, onClose, children, wide = false, headerActions }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; headerActions?: ReactNode;
}) {
  const lifecycle = useContext(DialogLifecycle);
  if (!lifecycle) throw new Error("ModalShell requires DialogLifecycle");
  const { state, busy, error } = lifecycle;
  const ref = useRef<HTMLDivElement>(null);
  const subtitleId = useId();
  const close = () => { if (!busy) onClose(); };
  useExitMotion(ref, state.closing, state.finish);
  useOverlayLayer({ ref, modal: true, origin: state.origin, onClose: close });
  useLayoutEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>("[role='dialog']")?.focus({ preventScroll: true });
  }, [busy]);
  const pressedBackdrop = useRef(false);
  return (
    <div ref={ref} className="modal-backdrop" data-motion={state.closing ? "closing" : "open"} role="presentation"
      onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (pressedBackdrop.current && event.target === event.currentTarget) close(); pressedBackdrop.current = false; }}>
      <section className={`modal-card${wide ? " modal-wide" : ""}`} data-overlay-surface role="dialog" aria-modal="true" aria-label={title} aria-describedby={subtitle ? subtitleId : undefined} aria-busy={busy} tabIndex={-1}>
        <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p id={subtitleId}>{subtitle}</p>}</div>
          <div className="modal-heading-controls">{headerActions}<button className="icon-button" onClick={close} disabled={busy || state.closing} aria-label="Cerrar ventana"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12 M18 6 6 18" /></svg></button></div>
        </div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {lifecycle.onRetry && <button className="secondary-button" type="button" disabled={busy || state.closing} onClick={lifecycle.onRetry}>Reintentar cambio pendiente</button>}
        <fieldset className="dialog-fields" disabled={busy || state.closing || !!lifecycle.onRetry}>{children}</fieldset>
      </section>
    </div>
  );
}
