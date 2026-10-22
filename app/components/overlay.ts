"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Retain content until the actual exit motion finishes; repeated closes are harmless. */
export function useDisclosure<T>() {
  const [value, setValue] = useState<T | null>(null);
  const [closing, setClosing] = useState(false);
  const origin = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const exiting = useRef(false);
  const afterExit = useRef<(() => void) | undefined>(undefined);
  const handoffFrame = useRef<number | null>(null);
  useLayoutEffect(() => () => { if (handoffFrame.current !== null) cancelAnimationFrame(handoffFrame.current); }, []);
  const open = useCallback((next: T) => {
    if (active.current) return;
    origin.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    active.current = true;
    exiting.current = false;
    setClosing(false);
    setValue(next);
  }, []);
  const close = useCallback((after?: () => void) => {
    if (!active.current || exiting.current) return;
    exiting.current = true;
    afterExit.current = after;
    setClosing(true);
  }, []);
  const finish = useCallback(() => {
    if (!exiting.current) return;
    active.current = false;
    exiting.current = false;
    setValue(null);
    setClosing(false);
    const next = afterExit.current;
    afterExit.current = undefined;
    // Allow cleanup (inert, scroll and focus) before handing off to another layer.
    if (next) handoffFrame.current = requestAnimationFrame(() => { handoffFrame.current = null; next(); });
  }, []);
  return { value, closing, origin, open, close, finish };
}

export type Disclosure<T> = ReturnType<typeof useDisclosure<T>>;

export function useExitMotion(ref: RefObject<HTMLElement | null>, closing: boolean, onExited: () => void) {
  useLayoutEffect(() => {
    if (!closing) return;
    let cancelled = false;
    const finish = () => { if (!cancelled) onExited(); };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = reduced.matches ? [] : (ref.current?.getAnimations({ subtree: true }) ?? [])
      .filter((animation) => animation.effect instanceof KeyframeEffect
        && (animation.effect.target === ref.current || (animation.effect.target instanceof Element && animation.effect.target.hasAttribute("data-overlay-surface"))));
    // No timer tied to a guessed CSS duration. Disabled/cancelled animations also settle.
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
    const preferenceChanged = () => { if (reduced.matches) finish(); };
    reduced.addEventListener("change", preferenceChanged);
    return () => { cancelled = true; reduced.removeEventListener("change", preferenceChanged); };
  }, [closing, onExited, ref]);
}

type Layer = { element: HTMLElement; modal: boolean };
const layers: Layer[] = [];
const focusable = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
function available(element: HTMLElement | null): element is HTMLElement {
  return !!element?.isConnected && !element.closest("[inert]") && !!element.getClientRects().length
    && getComputedStyle(element).visibility !== "hidden";
}
function controls(element: HTMLElement) {
  return Array.from(element.querySelectorAll<HTMLElement>(focusable)).filter(available);
}

/** Stack-aware Escape, modal focus containment and restoration, shared by every overlay. */
export function useOverlayLayer({ ref, active = true, modal, origin, onClose }: {
  ref: RefObject<HTMLElement | null>; active?: boolean; modal: boolean;
  origin: RefObject<HTMLElement | null>; onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const layer = { element, modal };
    layers.push(layer);
    const returnTo = origin.current;
    const inertElements: { element: HTMLElement; previous: boolean }[] = [];
    const overflow = document.body.style.overflow;
    if (modal) {
      document.body.style.overflow = "hidden";
      let branch: HTMLElement = element;
      while (branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.hasAttribute("data-overlay-backdrop") || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
          inertElements.push({ element: sibling, previous: sibling.inert });
          sibling.inert = true;
        }
        branch = branch.parentElement;
        if (branch === document.body) break;
      }
    }
    const focusFirst = () => {
      const preferred = Array.from(element.querySelectorAll<HTMLElement>("[data-initial-focus]:not(:disabled)")).find(available);
      (preferred ?? controls(element)[0] ?? element.querySelector<HTMLElement>("[role='dialog']") ?? element).focus({ preventScroll: true });
    };
    focusFirst();
    const keyboard = (event: KeyboardEvent) => {
      if (layers.at(-1) !== layer) return;
      if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab" || !modal) return;
      const items = controls(element);
      const first = items[0];
      const last = items.at(-1);
      if (!items.length) { event.preventDefault(); focusFirst(); return; }
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const containFocus = (event: FocusEvent) => {
      if (modal && layers.at(-1) === layer && !element.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener("keydown", keyboard);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("focusin", containFocus);
      const wasTop = layers.at(-1) === layer;
      layers.splice(layers.indexOf(layer), 1);
      inertElements.forEach(({ element: item, previous }) => { item.inert = previous; });
      if (modal) document.body.style.overflow = overflow;
      queueMicrotask(() => {
        if (!wasTop || layers.some((item) => item.modal || item.element === element)) return;
        // Do not steal focus when the user left a non-modal panel themselves.
        if (!modal && document.activeElement !== document.body && !element.contains(document.activeElement)) return;
        const fallback = Array.from(document.querySelectorAll<HTMLElement>("[data-overlay-return]")).find(available);
        (available(returnTo) ? returnTo : fallback)?.focus({ preventScroll: true });
      });
    };
  }, [active, modal, origin, ref]);
}
