import type { NavigationProblem } from "../lib/navigation";

const messages: Record<NavigationProblem, [string, string]> = {
  invalid: ["Este enlace no es válido", "El enlace necesita un proyecto y unos identificadores válidos. Pide al equipo que lo comparta de nuevo."],
  workspace: ["Proyecto no disponible", "El proyecto no existe o tu cuenta no tiene acceso. Pide una invitación al equipo o elige uno de tus proyectos."],
  sprint: ["Sprint no disponible", "Este sprint no existe en el proyecto del enlace o ya no está disponible."],
  task: ["Tarea no disponible", "Esta tarea no existe en el proyecto del enlace o ya fue eliminada."],
  session: ["Tu sesión ha terminado", "Inicia sesión de nuevo para continuar en este mismo enlace."],
  network: ["No pudimos abrir tu espacio", "Comprueba tu conexión e inténtalo de nuevo. No hemos abierto otro proyecto."],
};
export function NavigationError({ problem, onRetry, onHome, onProject }: {
  problem: NavigationProblem; onRetry: () => void; onHome: () => void; onProject?: () => void;
}) {
  const [title, message] = messages[problem];
  return <main className="fatal-state">
    <div className="brand-lockup brand-lockup-large"><span className="brand-mark">S</span><span>Sprintia</span></div>
    <h1>{title}</h1><p role="alert">{message}</p>
    <div className="navigation-recovery">
      {problem === "session" ? <button className="primary-button" onClick={() => window.location.reload()}>Iniciar sesión</button>
        : <>
          {problem === "network" && <button className="primary-button" onClick={onRetry}>Intentar de nuevo</button>}
          {onProject && <button className="secondary-button" onClick={onProject}>Volver al proyecto</button>}
          <button className="secondary-button" onClick={onHome}>Mis proyectos</button>
        </>}
    </div>
  </main>;
}
