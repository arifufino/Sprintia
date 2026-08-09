export function SignInPage({ signInPath }: { signInPath: string }) {
  return (
    <main className="signin-page">
      <section className="signin-copy">
        <div className="brand-lockup brand-lockup-large"><span className="brand-mark">S</span><span>Sprintia</span></div>
        <span className="signin-badge">Scrum, sin complicaciones</span>
        <h1>Tu equipo, un sprint a la vez.</h1>
        <p>Organiza el proyecto de la universidad, reparte tareas y mira el progreso en un tablero que todos pueden compartir.</p>
        <a className="signin-button" href={signInPath}><span>Continuar con ChatGPT</span><strong>→</strong></a>
        <small>Inicio de sesión seguro. No necesitas configurar otra contraseña.</small>
        <div className="signin-features"><span><i>✓</i> Tablero colaborativo</span><span><i>✓</i> Sprints y backlog</span><span><i>✓</i> Progreso del equipo</span></div>
      </section>
      <section className="signin-preview" aria-label="Vista previa del tablero Sprintia">
        <div className="preview-glow preview-glow-one" /><div className="preview-glow preview-glow-two" />
        <div className="preview-window">
          <div className="preview-sidebar"><span className="preview-logo">S</span><i /><i /><i /><i /><span className="preview-avatar">AR</span></div>
          <div className="preview-main">
            <div className="preview-top"><div><small>SPRINT ACTIVO</small><strong>Tablero</strong></div><button>+ Nueva tarea</button></div>
            <div className="preview-progress"><div><small>Sprint 1</small><strong>Primera versión funcional</strong></div><span><b>62%</b><i /></span></div>
            <div className="preview-board">
              <PreviewColumn title="Por hacer" count="2" cards={["Preparar historias de usuario", "Revisar bibliografía"]} />
              <PreviewColumn title="En curso" count="2" cards={["Configurar el repositorio", "Implementar el acceso"]} accent />
              <PreviewColumn title="En revisión" count="1" cards={["Diseñar el prototipo"]} />
              <PreviewColumn title="Terminado" count="2" cards={["Definir el alcance", "Acordar entregables"]} done />
            </div>
          </div>
        </div>
        <div className="preview-float"><span>↗</span><div><strong>+18 puntos</strong><small>esta semana</small></div></div>
      </section>
    </main>
  );
}

function PreviewColumn({ title, count, cards, accent = false, done = false }: { title: string; count: string; cards: string[]; accent?: boolean; done?: boolean }) {
  return (
    <div className={`preview-column${accent ? " preview-accent" : ""}${done ? " preview-done" : ""}`}>
      <div><span /><strong>{title}</strong><small>{count}</small></div>
      {cards.map((card, index) => <article key={card}><small>UNI-0{index + 3}</small><strong>{card}</strong><footer><i>{index === 0 ? 5 : 3}</i><b>{index === 0 ? "AR" : "CM"}</b></footer></article>)}
    </div>
  );
}
