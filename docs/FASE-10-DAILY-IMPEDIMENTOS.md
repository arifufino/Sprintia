# Fase 10 — Daily, impedimentos y conversación por tarea

Estado: COMPLETADA y validada localmente. Fecha: 21 de octubre de 2026.

## Recorrido

1. **Daily** reúne el objetivo del sprint, sus bloqueos abiertos y el trabajo en curso o revisión. Se puede elegir otro sprint y una fecha; ambos quedan en el enlace. No es un registro individual de asistencia ni un formulario obligatorio de ayer/hoy.
2. Desde una tarea, la pestaña **Conversación e impedimentos** permite registrar qué impide avanzar y elegir a un integrante para darle seguimiento. Un bloqueo no cambia por sí solo la columna, estimación ni responsable de ejecución de la tarea.
3. El bloqueo se distingue en el tablero y backlog y aparece con su motivo y responsable en Daily. Cualquier miembro puede actualizar su seguimiento o resolverlo, indicando cómo se resolvió. Su historial permanece aunque se abra otro bloqueo más adelante.
4. La conversación de cada tarea conserva comentarios y eventos de sus impedimentos. Se puede actualizar y cargar mensajes anteriores sin depender de las últimas 12 actividades del proyecto.
5. **Acuerdos y próximos pasos** permite guardar notas opcionales compartidas por sprint y fecha. Si otra sesión cambia esas notas, el borrador se conserva y hay que revisar la versión actual antes de volver a guardar.

Todos los miembros del proyecto tienen estos permisos de colaboración. Las responsabilidades Scrum no conceden acceso administrativo ni autorizan a consultar otro proyecto.

## Reglas de trabajo y ciclo de sprint

- Solo puede existir un impedimento abierto por tarea. Su motivo y la explicación de resolución tienen un máximo de 1.000 caracteres; el responsable de seguimiento debe pertenecer al proyecto.
- Una tarea bloqueada no puede marcarse terminada. Se resuelve primero el impedimento de forma explícita. Para bloquear una tarea ya terminada, primero se reabre cambiando su estado; no hay cambios automáticos de estado.
- La tarea conserva su bloqueo y conversación al moverse entre backlog y sprints. Registrar o resolver un bloqueo no reordena el backlog.
- Las notas compartidas se pueden modificar únicamente en un sprint activo. Las de sprints finalizados y planificados son consultables, pero no editables.
- El cierre o cancelación congela también el impedimento existente en cada tarea histórica. Las tareas devueltas al backlog conservan su conversación y bloqueo actuales; resolverlos después no modifica la instantánea de cierre.
- Una tarea retenida en un sprint finalizado queda en solo lectura, también para comentar y cambiar impedimentos. Desde el resultado histórico se puede abrir la tarea y conversación actuales si todavía existen. La conversación no se copia completa dentro de la instantánea.

## Datos, autorización y concurrencia

- Los campos de tarea `impediment` y `discussionRevision` y el contador `Sprint.dailyRevision` son aditivos. Los documentos anteriores se leen con `null` o cero; no se inventan bloqueos, notas ni mensajes históricos ni se reescriben registros al consultarlos.
- Nuevas colecciones: `task_updates` para comentarios y eventos de impedimentos, y `daily_notes` para acuerdos por proyecto/sprint/fecha. Hay índices de paginación y un índice único para cada nota diaria.
- `GET /api/discussion` y `GET /api/daily` requieren sesión y membresía. Validan identificadores, parámetros duplicados y fechas reales. Recursos ausentes o ajenos responden igual; las respuestas son `no-store` y nunca mutan datos.
- La conversación entrega hasta 50 entradas por página, ordenadas por fecha e identificador. Un cursor solo es válido en su propio proyecto y tarea. La interfaz conserva páginas ya leídas y permite recuperar un salto de más de 50 mensajes nuevos, sin duplicar ni omitir entradas.
- `changeImpediment`, `addTaskComment` y `saveDailyNote` pasan por el mismo despachador transaccional, autorización y recibos idempotentes de fase 6. El cambio, evento de auditoría y recibo se confirman juntos o se revierten juntos. Un reintento vuelve a comprobar acceso.
- Un cambio de impedimento exige la versión de contenido de la tarea, incrementa esa versión y la del sprint y añade una entrada de conversación. Un cierre basado en contenido anterior no puede ocultar ese cambio.
- Un comentario incrementa solo el contador de conversación de la tarea, no su versión de contenido. Dos comentarios concurrentes pueden guardarse sin sobrescribirse ni invalidar un borrador de descripción. La escritura del documento de tarea y un contador separado en el sprint serializan comentarios frente a eliminación y cierre.
- Las notas tienen su propia versión. Dos guardados basados en la misma versión no se pisan: el segundo recibe un conflicto. El contador `dailyRevision` del sprint activa el refresco sin invalidar innecesariamente su formulario de planificación o cierre. También actúa como barrera transaccional frente al cierre.
- Eliminar una tarea elimina su conversación actual en la misma transacción. La confirmación lo indica expresamente; el registro general de auditoría se conserva.

## Borradores, movimiento y diseño

- Comentarios y notas sin enviar se conservan en la misma pestaña, separados por usuario, proyecto y tarea o sprint/fecha. No se comparten como datos del equipo hasta confirmar el guardado.
- Un error o conflicto conserva el texto. Si el sprint finaliza remotamente, el borrador sigue disponible para copiarlo en solo lectura. Las notas obsoletas muestran la versión compartida y una acción explícita para descartar el borrador; no se sustituyen silenciosamente.
- Ante una respuesta perdida se conserva la intención original y su clave de idempotencia; el usuario puede recuperarla tras recargar. Solo una confirmación válida limpia el borrador correspondiente. Reintentar una colaboración no cierra la conversación abierta.
- Si el navegador bloquea el almacenamiento, se conserva un borrador en memoria y se advierte antes de abandonar la página. No se promete recuperación después de cerrar esa pestaña.
- La fecha de Daily usa el día local del navegador; el parámetro `day=YYYY-MM-DD` permite compartir una fecha concreta. La fecha de las notas no reconstruye un tablero histórico: los bloqueos y tareas mostrados son los actuales del sprint. Para el estado congelado al finalizar se consulta el Tablero histórico.
- Se mantiene el neumorfismo de fase 9, ambos temas, Grande predeterminado, mínimo de 12 px, foco visible y navegación móvil de seis apartados. Las etiquetas se ajustan a 320 px sin invadir el botón contiguo.
- Los formularios de impedimentos usan entrada/salida real antes de desmontar, foco inicial y restauración al control disponible. Se respeta movimiento reducido. No se añaden cargas artificiales.

## Validación

- 6 controles estructurales aprobados.
- Regresión completa de 240 casos: 237 aprobados en la primera pasada. Hubo dos diferencias visuales por el ajuste de etiquetas de Daily en móvil y un fallo en el gesto de arrastre, iniciado antes de que terminaran las animaciones de los contenedores. Se revisaron las imágenes y se ajustó la precondición del gesto para esperar fuentes y movimiento real, sin pausas fijas ni sustituirlo por eventos sintéticos.
- Pasada final: **57/57 pruebas aprobadas**, incluidas las **27 nuevas de fase 10**, el arrastre y **44 comparaciones visuales sin regeneración**. Cero fallos, omisiones, casos inestables o reintentos en esta pasada; no quedan fallos pendientes de la regresión completa.
- Repetición independiente del arrastre nativo: **3/3 aprobadas**, conservando las comprobaciones en base de datos y después de recargar.
- Compilación de producción, TypeScript independiente, sintaxis del lanzador y `git diff --check` aprobados.
- Capturas revisadas en ambos temas: Daily, conversación, formularios y vistas anteriores; texto Muy grande, navegación de seis apartados y ventanas de 320, 390 y 1.107 px. Las referencias se guardan en `tests/e2e/__screenshots__/phase-10/`, conservando las de fases anteriores.
- Vista previa independiente comprobada en Chromium: HTTP 200 para proyecto, conversación y notas; identidad ficticia, un sprint activo y otro planificado, un impedimento y una conversación de ejemplo. Apertura y salida del formulario de resolución con foco correcto, cero errores de navegador, cero guardados durante la comprobación y datos de tareas intactos. Petición de origen externo rechazada con 403.
- El runner retiró sus servicios y su archivo temporal de credenciales. La vista previa independiente se deja iniciada para la revisión del usuario.

Las pruebas nuevas cubren acceso, validaciones, versiones, escrituras concurrentes, reversión transaccional, paginación con fechas iguales y más de una página de mensajes nuevos, cierre e inmutabilidad, borradores, respuestas perdidas, foco, movimiento reducido y distribución adaptable.

Vista previa: `http://127.0.0.1:4317/?workspace=ws_starter_local_preview&view=daily&sprint=sp_starter_local_preview`. Datos temporales de ejemplo, descartados al detener el lanzador.

## Límites de esta entrega

- Sin edición o eliminación individual de comentarios, menciones, notificaciones ni presencia en tiempo real. Se mantiene el refresco periódico de la aplicación y se ofrecen controles de actualización explícita.
- Las notas no son una métrica de rendimiento ni una agenda con zona horaria compartida. No se exige registrar una Daily para continuar trabajando.
- Sin nuevas dependencias, servicios de pago, commit, push ni despliegue. No se modifican Aula Estrella, Google, Vercel ni MongoDB productivo. El aviso de dependencias de fase 1 sigue pendiente antes de publicar.
- La siguiente fase es **11: Review e incremento**; no se inicia automáticamente en esta entrega.
