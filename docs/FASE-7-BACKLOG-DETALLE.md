# Fase 7 — Backlog y detalle de tarea

Estado: **COMPLETADA**, validada localmente el 19 de octubre de 2026. Implementación iniciada el 18 de octubre.

## Orden compartido

El backlog muestra la posición de cada elemento. Se puede arrastrar el asa, usar sus teclas ↑/↓, Inicio/Fin o pulsar los botones Subir/Bajar. El guardado se anuncia y el foco vuelve al asa de la misma tarea. El cambio de posición tiene una transición breve de 180 ms; se omite con movimiento reducido. No hay carga artificial ni reordenación visual presentada como confirmada antes de guardar.

`reorderBacklog` recibe `workspaceId`, `id`, `beforeId` (o `null` para el final), `backlogRevision` y el `mutationId` de fase 6. El servidor verifica membresía y que ambas tareas pertenezcan al backlog autorizado. La versión del orden vive en el proyecto, separada de la revisión del contenido de cada tarea. Una lista antigua recibe 409 y se actualiza sin sobrescribir la prioridad elegida por otra persona.

Crear, eliminar, incorporar o retirar un elemento del backlog incrementa la misma versión dentro de la transacción. Así, una creación o transferencia concurrente no desaparece al reordenar. Las nuevas tareas y las devueltas al backlog se añaden al final; el servidor no acepta posiciones numéricas arbitrarias del cliente. La lectura usa `sortOrder`, `createdAt` e identificador para resolver empates antiguos de forma determinista.

Un cambio de orden normaliza las posiciones actuales con una escritura por tarea y registra **un único evento** `backlog.reordered` con la lista anterior/posterior. Posiciones, versión, evento y recibo son atómicos e idempotentes. El requisito de replica set de fase 6 se conserva. Para un backlog universitario la operación es sencilla; no se ha hecho una prueba de carga de miles de elementos. Antes de esa escala conviene evaluar rangos fraccionarios o una estrategia equivalente.

## Detalle y editor breve

- `acceptanceCriteria`: hasta 20 resultados verificables propios de la tarea, de hasta 240 caracteres cada uno. No modifica la Definition of Done común.
- `checklist`: hasta 30 pasos, con identificador estable, texto de hasta 240 caracteres y marca `done`. Completar los pasos no cambia el estado de la tarea.
- `points`: número permitido o `null` para **Sin estimar**. Las tareas nuevas de la interfaz y las creadas sin estimación explícita ya no reciben 3 puntos por defecto. Las estimaciones existentes se conservan; sumas y porcentajes solo incluyen puntos estimados y se identifica el trabajo sin estimar.
- Descripción de hasta 1.200 caracteres: texto sencillo con botones para párrafos, listas, listas numeradas y enlaces. La vista previa interpreta solo ese subconjunto, sin HTML, imágenes, scripts ni componentes embebidos. Los enlaces solo admiten HTTP/HTTPS sin credenciales y abren con `noopener noreferrer`.

Los bloques de criterios y checklist se despliegan al necesitarlos para mantener un formulario compacto. `TaskModal`, `TaskEditor` y `BacklogView` quedan extraídos del componente principal con estilos propios, conservando los controles, temas, fuentes, animaciones de salida y gestión de foco compartidos. No se añaden dependencias.

Los datos anteriores se proyectan con arrays vacíos y versión de orden 0; no hay una reescritura masiva ni se inventa historial. La validación de campos ocurre en servidor. Los arrays se comparan por contenido para que guardar datos iguales no aumente revisiones ni genere eventos. Se mantienen el límite global de 32 KiB por solicitud, los permisos, las actualizaciones parciales y los conflictos de fase 6.

## Borradores y resultados inciertos

Los borradores se guardan en `sessionStorage`, separados por usuario, proyecto y tarea (un borrador nuevo por proyecto). Sobreviven al cierre del diálogo, a la navegación interna y a la recarga de **esa pestaña**, pero no se publican al equipo. No es almacenamiento permanente entre dispositivos ni una promesa de recuperación después de cerrar la pestaña o borrar sus datos.

Se conserva la base original junto a los valores editados. Al recuperar un borrador antiguo, una edición remota sigue mostrando el conflicto: se puede comparar/copiar y cargar expresamente la versión actual. Descartar borrador es una acción explícita. Un guardado confirmado del editor o su eliminación retira el borrador; mover la tarjeta o añadirla a un sprint no lo borra.

La intención de crear/editar/eliminar una tarea también se guarda antes de enviar, con la clave idempotente original. Tras una recarga, un resultado sin confirmar exige pulsar **Reintentar cambio pendiente**: no se reenvía automáticamente. Si el servidor ya lo había guardado, devuelve el recibo sin duplicar la tarea. Un rechazo definitivo libera la intención, pero mantiene el borrador. No se conserva una cola de todas las acciones ni se modifica la recuperación de sprints, permisos o invitaciones en esta fase.

Si el almacenamiento está bloqueado o lleno, el borrador sigue en memoria al cerrar y reabrir el diálogo, aparece una advertencia y se avisa antes de abandonar la página. Forzar una recarga en ese caso puede perderlo: hay que copiarlo o mantener la ventana abierta. Los datos corruptos de almacenamiento se ignoran. Los borradores no contienen credenciales; las intenciones solo abarcan tareas y su contenido. En un dispositivo compartido conviene cerrar la pestaña al terminar. Una tarea eliminada remotamente permite copiar el formulario mientras está abierto; no se incorpora aún un explorador de borradores huérfanos.

## Validación

Casos nuevos en `tests/e2e/backlog-detail.spec.ts`, con MongoDB temporal y usuarios ficticios. Incluyen permisos, versiones concurrentes, rollback del orden si falla el evento, reintentos, teclado/ratón, borradores después de recargar, aislamiento de usuario/proyecto, almacenamiento bloqueado, conflicto al recuperar, seguridad de enlaces y ausencia de HTML interpretado.

Se revisan el backlog y el detalle a 320, 390 y 1.107 px con texto Muy grande y ambos temas, sin desbordamiento horizontal ni texto visible menor de 12 px. Las capturas nuevas usan prefijo `phase-7-`; las anteriores se conservan. Solo se sustituyen las referencias activas de backlog, nueva tarea y conflicto, donde la interfaz cambia intencionadamente. No se relajan tolerancias ni se ocultan controles del producto.

La ejecución final de `npm test` aprobó **6 controles estructurales y 170 casos de navegador/API/imagen**: 0 fallos, omisiones, casos inestables o reintentos. Playwright registró 482,38 segundos. Incluye 21 casos nuevos de fase 7 (7 de servidor/datos y 14 de interfaz/recuperación/imagen). Las 26 comparaciones visuales activas se comprobaron sin regenerarlas en esa ejecución; se conservaron las referencias de las fases anteriores y se añadieron 10 con prefijo `phase-7-`.

Durante la validación se corrigió un selector ambiguo de una prueba: ahora busca el aviso de error dentro del contenido principal, sin confundirlo con el anunciador de rutas de Next.js. También se comprobó que mover una tarjeta no borre un borrador pendiente. La revisión visual llevó a ordenar las métricas en dos columnas en móvil y corregir el espaciado del resumen. No se ocultaron errores ni se omitieron pruebas.

`npm run build` (Next.js 16.3/Turbopack), `tsc --noEmit` independiente y `git diff --check` terminaron correctamente. La compilación usó variables ficticias y una base no operativa. No se ejecutó ESLint en esta fase. El runner retiró `.test-runtime.json` y detuvo sus servicios; el puerto 4317 quedó libre.

Alcance local: sin commit, push ni despliegue. No se modifican Aula Estrella ni servicios o datos productivos. El aviso de dependencias de fase 1 sigue siendo un requisito antes de publicar. La siguiente entrega es la fase 8: planificación e inicio explícito de sprint.
