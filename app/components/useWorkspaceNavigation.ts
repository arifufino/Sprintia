"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapData } from "../lib/types";
import { defaultNavigation, navigationUrl, parseNavigation, resolveNavigation, type NavigationProblem, type NavigationState } from "../lib/navigation";

type State = { route: NavigationState; data: BootstrapData | null; problem?: NavigationProblem; loading: boolean; syncFailed?: boolean; etag?: string; lastSyncedAt?: number };
type HistoryMode = "push" | "replace" | "none";

export function useWorkspaceNavigation() {
  const [state, setState] = useState<State>({ route: defaultNavigation, data: null, loading: true });
  const current = useRef(state);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const beforeHistoryChange = useRef<(() => Promise<void>) | null>(null);
  const [historyChanging, setHistoryChanging] = useState(false);
  const historyId = useRef(0);
  const historyPending = useRef(false);
  const syncPaused = useRef(false);
  const [online, setOnline] = useState(true);
  const commit = useCallback((next: State) => { current.current = next; setState(next); }, []);
  const write = useCallback((route: NavigationState, mode: HistoryMode, taskParent?: string) => {
    const url = navigationUrl(route);
    if (mode === "none" || historyPending.current) return;
    const same = window.location.pathname + window.location.search === url;
    const method = mode === "push" && !same ? "pushState" : "replaceState";
    window.history[method]({ ...window.history.state, sprintiaTaskParent: taskParent ?? null }, "", url);
  }, []);

  const go = useCallback(async (route: NavigationState, mode: HistoryMode = "push", force = false, retainDialog = false) => {
    if (historyPending.current) return;
    const previous = current.current;
    const parent = route.task && !previous.route.task && previous.route.workspace === route.workspace
      ? navigationUrl(previous.route) : mode !== "push" && route.task ? window.history.state?.sprintiaTaskParent : undefined;
    const id = ++requestId.current;
    controller.current?.abort();
    controller.current = null;
    if (!retainDialog) write(route, mode, parent);
    if (!force && previous.data && route.workspace === previous.data.workspace.id) {
      const resolved = resolveNavigation(route, previous.data);
      commit({ ...previous, ...resolved, data: resolved.problem ? null : previous.data, loading: false });
      if (!resolved.problem) write(resolved.route, "replace", parent);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const sameWorkspace = !!previous.data && route.workspace === previous.data.workspace.id;
    // A successful create/join keeps its dialog and origin mounted until the target is authorized.
    commit(retainDialog && previous.data ? { ...previous, loading: true } : { route, data: sameWorkspace ? previous.data : null, loading: true });
    const networkFailure = () => {
      if (sameWorkspace && previous.data) commit({ ...previous, loading: false, syncFailed: true });
      else {
        if (retainDialog) write(route, mode);
        commit({ route, data: null, loading: false, problem: "network" });
      }
    };
    try {
      const query = route.workspace ? `?workspace=${encodeURIComponent(route.workspace)}` : "";
      const response = await fetch(`/api/bootstrap${query}`, { cache: "no-store", signal: abort.signal,
        headers: sameWorkspace && previous.etag ? { "If-None-Match": previous.etag } : undefined });
      if (id !== requestId.current) return;
      if (response.status === 304 && sameWorkspace && previous.data) {
        commit({ ...previous, route, loading: false, syncFailed: false, lastSyncedAt: Date.now() });
        return;
      }
      if (!response.ok) {
        if (response.status !== 401 && response.status !== 404) { networkFailure(); return; }
        if (retainDialog) write(route, mode);
        commit({ route, data: null, loading: false, problem: response.status === 401 ? "session" : response.status === 404 ? "workspace" : "network" });
        return;
      }
      const payload = await response.json() as BootstrapData;
      if (id !== requestId.current) return;
      const resolved = resolveNavigation(route, payload);
      // A task deleted remotely must not erase an already-open editor's draft.
      const preserveDraft = sameWorkspace && previous.route.task === route.task && resolved.problem === "task";
      commit({ ...(preserveDraft ? { route } : resolved), data: resolved.problem && !preserveDraft ? null : payload, loading: false,
        etag: response.headers.get("ETag") ?? undefined, lastSyncedAt: Date.now() });
      if (!resolved.problem) write(resolved.route, retainDialog && mode !== "none" ? mode : "replace", parent);
    } catch {
      if (id === requestId.current && !abort.signal.aborted) networkFailure();
    }
  }, [commit, write]);

  useEffect(() => {
    let disposed = false;
    const read = async (fromHistory = false) => {
      const id = ++historyId.current;
      const parsed = parseNavigation(new URLSearchParams(window.location.search));
      if (fromHistory) {
        historyPending.current = true;
        ++requestId.current;
        controller.current?.abort();
        setHistoryChanging(true);
        await beforeHistoryChange.current?.();
      }
      if (disposed || id !== historyId.current) return;
      historyPending.current = false;
      setHistoryChanging(false);
      if (parsed.problem) {
        ++requestId.current;
        controller.current?.abort();
        commit({ ...parsed, data: null, loading: false });
      } else await go(parsed.route, "none", fromHistory);
    };
    void read();
    const pop = () => { void read(true); };
    window.addEventListener("popstate", pop);
    return () => { disposed = true; ++requestId.current; controller.current?.abort(); window.removeEventListener("popstate", pop); };
  }, [commit, go]);

  const refresh = useCallback(async (patch?: Partial<NavigationState>) => {
    await go({ ...current.current.route, ...patch }, patch ? "replace" : "none", true);
  }, [go]);
  useEffect(() => {
    const check = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && !syncPaused.current && document.visibilityState === "visible" && current.current.data && !current.current.loading && !historyPending.current) void refresh();
    };
    const offline = () => setOnline(false);
    setOnline(navigator.onLine);
    const timer = window.setInterval(check, 25_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refresh]);

  const pauseSync = useCallback((paused: boolean) => {
    syncPaused.current = paused;
    if (paused) {
      ++requestId.current;
      controller.current?.abort();
      commit({ ...current.current, loading: false, etag: undefined });
    }
  }, [commit]);

  const setData = useCallback((update: (previous: BootstrapData | null) => BootstrapData | null) => {
    commit({ ...current.current, data: update(current.current.data) });
  }, [commit]);
  const update = useCallback((patch: Partial<NavigationState>, mode: HistoryMode = "push") => go({ ...current.current.route, ...patch }, mode), [go]);
  const closeTask = useCallback(() => {
    if (!current.current.route.task || historyPending.current) return;
    const route = { ...current.current.route, task: undefined };
    const parent = window.history.state?.sprintiaTaskParent;
    if (parent && parent === navigationUrl(route)) window.history.back();
    else void go(route, "replace");
  }, [go]);

  return { ...state, online, pauseSync, current, setData, go, update, refresh, closeTask, beforeHistoryChange, historyChanging };
}
