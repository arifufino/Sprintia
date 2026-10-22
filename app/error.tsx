"use client";

import { useEffect } from "react";
import { logFailure } from "../lib/safe-log";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logFailure("page.failed");
  }, [error]);

  return (
    <main className="state-page">
      <div className="state-card">
        <span className="brand-mark">S</span>
        <h1>Algo no salió como esperábamos</h1>
        <p>No pudimos cargar esta vista. Vuelve a intentarlo; los cambios que no hayas guardado podrían no haberse conservado.</p>
        <button className="primary-button" onClick={reset}>Intentar de nuevo</button>
      </div>
    </main>
  );
}
