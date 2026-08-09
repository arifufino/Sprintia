export default function Loading() {
  return (
    <main className="state-page" aria-live="polite" aria-busy="true">
      <div className="state-card">
        <span className="brand-mark state-pulse">S</span>
        <h1>Preparando tu tablero</h1>
        <p>Estamos sincronizando el sprint con tu equipo.</p>
      </div>
    </main>
  );
}
