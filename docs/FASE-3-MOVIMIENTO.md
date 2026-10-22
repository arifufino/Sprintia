# Fase 3: movimiento y diálogos consistentes

Iniciada el 14 de octubre de 2026. Completada y validada el 15 de octubre de 2026.

## Resultado — COMPLETADA

- `npm test`: 6 controles estructurales y 81 pruebas de navegador/API/imagen aprobados, sin fallos, omisiones, resultados inestables ni reintentos. La ejecución final de navegador duró aproximadamente 273 segundos.
- Se conservaron las 53 pruebas previas y se añadieron 28 de movimiento, cierre, foco y persistencia. Las 15 referencias visuales se compararon sin regenerarlas; se revisaron las capturas de tareas, Copiloto y menú móvil.
- `npm run build`: compilación de producción correcta con Next.js/Turbopack y TypeScript, usando variables ficticias y una URI de MongoDB local sin servicio. No se usaron credenciales de producción.
- `npm run typecheck`: sin errores después de la compilación.
- `git diff --check`: sin errores; las advertencias LF/CRLF de Windows no son fallos del diff.
- El servidor de pruebas terminó y `.test-runtime.json` fue eliminado. No se hizo commit, push ni despliegue.

## Implementación

- `app/components/overlay.ts` concentra presencia, cierre y foco. El contenido permanece montado durante la salida y se retira cuando terminan sus animaciones reales mediante `Animation.finished`. No se sincroniza con temporizadores de 240/280 ms ni se añaden pantallas de carga.
- `app/styles/motion.css` define entrada de 260 ms, salida de 180 ms y una curva compartida. Los diálogos y el Copiloto usan desplazamiento/escala discretos; el menú móvil se desliza lateralmente. Las reglas anteriores de esos paneles se retiraron de la hoja global.
- `ModalShell.tsx` reutiliza el mismo ciclo para tareas, invitaciones, proyectos y sprints. X, Escape, Cancelar/Listo, fondo y guardado satisfactorio solicitan el mismo cierre. La eliminación confirmada también lo usa. Arrastrar desde el formulario hacia el fondo no se interpreta como clic exterior. Cada diálogo tiene un nombre accesible explícito idéntico a su título visible.
- Durante una escritura se deshabilitan el formulario y el cierre, se anuncia `aria-busy` y se evitan envíos duplicados. Si falla, se conserva el borrador y se presenta el error dentro del diálogo. Esta protección local no sustituye la gestión de concurrencia prevista para la fase 6.
- Los diálogos y el menú móvil bloquean el fondo con `inert`, contienen Tab/Mayús+Tab y bloquean el desplazamiento de la página mientras están presentes. Escape actúa solo sobre la capa superior. Al cerrar, el foco vuelve al control de origen; si desapareció, se usa un control visible o el título de la vista.
- Abrir una invitación u otro proyecto desde el menú móvil espera su salida y después entrega el foco al diálogo. Cambiar de tamaño de pantalla libera el bloqueo móvil.
- El Copiloto sigue siendo **no modal**: permite trabajar en el tablero y no desaparece por hacer clic fuera. Se cierra por su botón o Escape, mantiene el borrador y la conversación y no roba el foco si el usuario ya pasó a otro control.
- `prefers-reduced-motion` elimina las animaciones sin conservar una espera artificial. Cambiar esa preferencia durante una salida también permite finalizarla.
- Los selectores nativos de proyecto, sprint y filtros conservan el comportamiento accesible del navegador; no se sustituyeron por menús personalizados.

## Verificación

`tests/e2e/motion.spec.ts` cubre todas las rutas de cierre de los cuatro diálogos, Tab circular, fondo, cierres repetidos, reapertura, creación/edición/eliminación con persistencia, errores de escritura, protección frente a duplicados, Copiloto con un diálogo encima, traspaso desde el menú móvil y movimiento reducido.

Las pruebas pausan las animaciones reales de salida antes de comprobar que el contenido sigue montado y completan esas mismas animaciones. No dependen de pausas arbitrarias para asumir que la transición funcionó.

Se conserva la batería previa de distribución, permisos, acceso, persistencia e imágenes. El entorno usa Chromium, MongoDB temporal e identidades ficticias; no consulta la IA ni usa Google, MongoDB Atlas o Vercel productivos.

## Límites de esta entrega

Solo cambios locales de Sprintia. Sin commits, push, despliegue, servicios nuevos ni modificaciones en Aula Estrella. No se implementa la navegación por URL (fase 4). El aviso de dependencias registrado en la fase 1 continúa pendiente antes de publicar.
