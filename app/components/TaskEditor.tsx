"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import styles from "./TaskDetail.module.css";

export function safeLink(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const links = /\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  let start = 0;
  for (const match of text.matchAll(links)) {
    result.push(text.slice(start, match.index));
    const href = safeLink(match[2]);
    result.push(href ? <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">{match[1]}</a> : match[0]);
    start = match.index! + match[0].length;
  }
  result.push(text.slice(start));
  return result;
}
export function TaskDescription({ value }: { value: string }) {
  return <div className={styles.preview}>{value.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split("\n");
    if (lines.every((line) => /^[-*] /.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.slice(2))}</li>)}</ul>;
    if (lines.every((line) => /^\d+\. /.test(line))) return <ol key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\d+\. /, ""))}</li>)}</ol>;
    return <p key={index}>{inline(block)}</p>;
  })}</div>;
}

export function TaskEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const insert = (text: string, start = ref.current?.selectionStart ?? value.length, end = ref.current?.selectionEnd ?? value.length) => {
    const next = value.slice(0, start) + text + value.slice(end);
    if (next.length > 1200) { setNotice("La descripción admite hasta 1200 caracteres."); return; }
    onChange(next); setNotice("");
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(start + text.length, start + text.length); });
  };
  const list = (numbered: boolean) => {
    const start = value.lastIndexOf("\n", Math.max(0, (ref.current?.selectionStart ?? 0) - 1)) + 1;
    const selectionEnd = ref.current?.selectionEnd ?? start;
    const newline = value.indexOf("\n", selectionEnd);
    const end = newline < 0 ? value.length : newline;
    insert(value.slice(start, end).split("\n").map((line, i) => `${numbered ? `${i + 1}.` : "-"} ${line.replace(/^(?:[-*]|\d+\.) /, "")}`).join("\n"), start, end);
  };
  return <div className={`field field-full ${styles.editor}`}>
    <label htmlFor={id}>Descripción</label>
    <div className={styles.toolbar} role="group" aria-label="Formato de descripción">
      <button type="button" onClick={() => insert("\n\n")}>Párrafo</button>
      <button type="button" onClick={() => list(false)}>Lista</button>
      <button type="button" onClick={() => list(true)}>Lista numerada</button>
      <button type="button" aria-expanded={linkOpen} onClick={() => {
        selection.current = { start: ref.current?.selectionStart ?? value.length, end: ref.current?.selectionEnd ?? value.length };
        setLabel(value.slice(selection.current.start, selection.current.end)); setLinkOpen(!linkOpen);
      }}>Enlace</button>
    </div>
    {linkOpen && <div className={styles.linkFields}>
      <label>Texto del enlace<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} /></label>
      <label>Dirección del enlace<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" type="url" maxLength={500} /></label>
      <button className="secondary-button" type="button" disabled={!safeLink(url) || !label.trim() || /[\[\]\n]/.test(label)} onClick={() => { insert(`[${label.trim()}](${safeLink(url)!.replaceAll(")", "%29").replaceAll("(", "%28")})`, selection.current.start, selection.current.end); setLinkOpen(false); setUrl(""); }}>Insertar enlace</button>
    </div>}
    <textarea id={id} ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Contexto, pasos o enlaces útiles…" rows={3} maxLength={1200} aria-describedby={`${id}-help`} />
    <small id={`${id}-help`}>Texto simple con párrafos, listas y enlaces · {value.length}/1200</small>
    {notice && <p role="status">{notice}</p>}
    <details><summary>Vista previa de descripción</summary>{value ? <TaskDescription value={value} /> : <p>La descripción aparecerá aquí.</p>}</details>
  </div>;
}
