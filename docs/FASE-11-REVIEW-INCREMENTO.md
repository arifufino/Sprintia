# Fase 11 — Review e incremento

Estado: COMPLETADA y validada localmente. Fecha: 21 de octubre de 2026.

## Recorrido

1. **Review e incremento** se abre desde el Tablero del sprint o desde Resumen. Tiene enlace propio con `view=review&sprint=…`, selector de sprint y regreso al Tablero. No añade un séptimo botón a la navegación móvil.
2. **Registrar resultado** permite explicar lo conseguido, seleccionar trabajo terminado y sin impedimentos y añadir hasta diez enlaces de demostración. El equipo confirma expresamente que revisó el resultado y la Definition of Done aplicable. No es una validación automática de criterios ni una aprobación formal de software.
3. Si falta una Definition of Done, se puede describir el resultado sin certificar tareas. También se puede reconocer que no hubo incremento. No se inventan criterios ni se cambia una tarea para hacerla elegible.
4. **Feedback y decisiones** distingue observaciones de acuerdos. Cualquier miembro puede aportar contexto, incluso después de completar el sprint. No hace falta registrar un incremento antes de conversar.
5. Una decisión ofrece **Crear elemento del backlog**. Se revisan título y descripción antes de confirmar. Se crea una sola tarea, sin sprint, responsable ni estimación. La decisión conserva su referencia y la tarea permite volver a su Review de origen.

La Review no condiciona las entregas, el estado Terminado, el inicio o cierre del sprint. Ningún registro aprueba o completa trabajo automáticamente. Los permisos son los de membresía del proyecto, independientes de Product Owner, Scrum Master y Developer.

## Registro y ciclo del sprint

- En un sprint activo, los candidatos y acuerdos se obtienen del servidor. La versión del sprint detecta cambios de sus tareas y la de configuración protege la Definition of Done frente a ediciones simultáneas.
- En un sprint completado, el trabajo elegible y los acuerdos salen exclusivamente de la instantánea de cierre. Editar o eliminar después una tarea o cambiar los acuerdos del proyecto no modifica ese contexto.
- Un sprint completado antiguo sin instantánea admite feedback y decisiones, pero no permite inventar un incremento histórico. Los sprints planificados y cancelados son de consulta; una cancelación no borra una Review que ya existía.
- El resultado guarda copias de tareas, descripción, criterios, checklist, estimación, objetivo y Definition of Done revisados, con fecha, autor y origen activo/completado. Cambiar una tarea no actualiza silenciosamente ese registro.
- Actualizar el resultado es una operación explícita con revisión propia y nueva confirmación. Se conserva cada versión completa en `review_revisions`. La interfaz de esta entrega muestra la última versión, no un navegador de versiones anteriores.
- La instantánea de cierre del sprint permanece independiente e inmutable; guardar o actualizar la Review después no la reescribe.
- Feedback y decisiones se añaden sin editar ni borrar aportaciones anteriores. Eliminar una tarea creada desde una decisión conserva la referencia en la Review, indicándola como no disponible. Reintentar no recrea ese elemento eliminado.

## Datos, acceso y atomicidad

- Colecciones nuevas: `sprint_reviews` para el último resultado por proyecto/sprint, `review_revisions` para sus versiones completas y `review_entries` para aportaciones y referencias. Índices únicos impiden resultados o versiones duplicadas; fecha e identificador permiten paginar aportaciones con marcas temporales iguales.
- Los campos `Sprint.reviewRevision` y `ScrumTask.reviewSource` son aditivos. Los documentos anteriores se proyectan con cero o `null`, sin fabricar un registro de Review, migrar estados o atribuir responsabilidades.
- `GET /api/review` exige sesión, membresía y un sprint del proyecto. Rechaza parámetros duplicados, identificadores inválidos y cursores de otros contextos; recursos ajenos y ausentes son indistinguibles. Responde `no-store` y no escribe datos.
- Las aportaciones se entregan de 50 en 50. La interfaz fusiona entradas por identificador y conserva páginas ya cargadas; ofrece recuperar un salto de más de una página de nuevas aportaciones.
- Una consulta puntual de aportación actualiza la referencia de decisiones antiguas al abrirlas o convertirlas. Se autoriza en el mismo proyecto/sprint y no admite mezclar selección puntual con un cursor; no obliga a descartar las páginas ni el borrador de feedback ya cargados.
- `saveSprintReview`, `addReviewEntry` y `convertReviewDecision` usan el despachador transaccional, recibos idempotentes y autorización de fases anteriores. Datos, versiones, auditoría y recibo se confirman juntos o se revierten juntos.
- El resultado tiene su propia revisión. Dos sesiones no pueden sobrescribir la misma versión. Los comentarios no invalidan un borrador de resultado y las escrituras de Review no cambian la versión de contenido del sprint.
- Un contador separado del sprint activa el refresco y serializa estas escrituras con cierre/cancelación. El guardado de incremento también comparte una escritura del proyecto con la edición de acuerdos, para impedir verificar una Definition of Done obsoleta.
- La conversión bloquea el registro de decisión dentro de la transacción y reutiliza la creación normal de tareas. Dos usuarios que conviertan la misma decisión obtienen el mismo identificador, sin duplicar contador, orden ni tarea.
- El origen no se acepta desde las rutas generales de crear o editar tareas; solo lo escribe la conversión autorizada. Su evento atómico incluye la referencia. Recuperar un recibo vuelve a comprobar la membresía.
- Las versiones completas se guardan fuera del feed de actividad del bootstrap. El evento de guardado referencia revisión y cantidades; no repite todas las descripciones, criterios y checklists en cada refresco del proyecto.

## Diseño, borradores y límites

- Neumorfismo compartido, ambos temas, Grande predeterminado y texto mínimo de 12 px. Distribución en dos columnas cuando hay ancho suficiente y una columna en espacios reducidos.
- Los diálogos se montan fuera del contenedor de entrada animado, para mantener su posición respecto de la ventana. Usan el ciclo compartido de entrada/salida, Escape, cierre exterior, foco contenido y restauración; respetan movimiento reducido.
- Borradores privados en la misma pestaña, separados por usuario, proyecto, sprint y operación. Se conservan al cerrar el diálogo, recargar o recibir un conflicto; revisar una versión nueva no sobreescribe el texto y exige confirmar otra vez.
- Si un sprint deja de admitir cambios, el borrador sigue disponible para copiarlo. Si el almacenamiento falla, se conserva en memoria y se advierte antes de abandonar la página; no se promete recuperación tras cerrarla.
- Una respuesta perdida conserva la intención y clave originales. El reintento recupera el recibo sin duplicar resultado, aportación o elemento del backlog. Solo la confirmación limpia el borrador correspondiente.
- Resultado y aportaciones: hasta 2.000 caracteres. Trabajo seleccionado: hasta 200 tareas. Evidencias: hasta 10, nombre de 100 caracteres y URL de 2.048. Se mantiene el límite general del cuerpo de petición. La tarea creada mantiene los límites existentes de 160 caracteres de título y 1.200 de descripción.
- Solo enlaces `http` o `https`, sin credenciales incrustadas. Se abren bajo acción del usuario, con aislamiento de la ventana; el servidor no los descarga ni inspecciona. Sin carga de adjuntos en esta entrega.
- Sin convocatorias, asistentes obligatorios, votaciones ni aprobación de un Product Owner. Tampoco se implementa todavía la retrospectiva o un sistema de notificaciones.

## Validación

- 6 controles estructurales aprobados.
- Regresión completa inicial: **266/266 casos aprobados**, sin fallos, omisiones o reintentos. Incluye los flujos anteriores de acceso, permisos, backlog, sincronización, Daily, planificación, cierre, navegación y movimiento.
- Se añadieron tres comprobaciones de cierre: retirada explícita de certificación cuando desaparece la Definition of Done, borradores con almacenamiento bloqueado y conversión de una decisión antigua tras cargar más de una página nueva de aportaciones.
- Pasada final: **62/62 pruebas aprobadas**, incluidas las **29 nuevas de fase 11** y **50 comparaciones visuales sin regeneración**. Cero fallos, omisiones, casos inestables o reintentos. Las referencias de fases anteriores se conservan; las actuales están en `tests/e2e/__screenshots__/phase-11/`.
- Compilación de producción, TypeScript independiente, sintaxis del lanzador y `git diff --check` aprobados.
- Revisión visual de ambos temas y ventanas de 320, 390 y 1.107 px, incluido el diálogo dentro del viewport, foco visible, texto Muy grande y mínimo de 12 px. Se corrigió la posición del diálogo respecto del contenedor animado antes de validar las referencias finales.
- Vista previa independiente comprobada en Chromium, escritorio y móvil: HTTP 200 para proyecto, Review y consulta puntual; identidad ficticia, un sprint activo y otro planificado, un resultado, una tarea verificada, feedback y una decisión sin convertir. Apertura y salida de los dos diálogos, vuelta al Tablero y regreso a Review; cero errores de navegador y cero guardados durante la comprobación. Tareas y Review intactas al finalizar. Petición de origen externo rechazada con 403.
- El runner retiró sus servicios y el archivo temporal de credenciales. La vista previa independiente se deja iniciada para revisión del usuario.

La suite específica cubre registros antiguos, instantáneas, Definition of Done, validación de enlaces, sesiones y aislamiento, conflictos, conversiones simultáneas, reversión transaccional, paginación, recuperación y diseño adaptable.

Vista previa: `http://127.0.0.1:4317/?workspace=ws_starter_local_preview&view=review&sprint=sp_starter_local_preview`. Datos temporales de ejemplo, sin cuentas ni servicios de producción.

## Alcance operativo

Cambios locales, sin commit, push, publicación o despliegue. Sin nuevas dependencias o servicios. No se modifican Aula Estrella, Google, Vercel ni MongoDB productivo. El aviso de dependencias documentado en fase 1 sigue pendiente antes de publicar.

La vista previa incluye un resultado y una tarea verificada de ejemplo, evidencias locales, feedback y una decisión sin convertir, además de los datos de Daily. Es demostración con datos temporales, no información real.

La siguiente fase es **12: Retrospectiva accionable**; no se inicia automáticamente en esta entrega.
