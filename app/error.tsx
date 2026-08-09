"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="state-page">
      <div className="state-card">
        <span className="brand-mark">S</span>
        <h1>Algo no salió como esperábamos</h1>
        <p>Tu información sigue guardada. Vuelve a intentarlo o regresa en unos minutos.</p>
        <button className="primary-button" onClick={reset}>Intentar de nuevo</button>
      </div>
    </main>
  );
}
