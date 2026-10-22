# Fase 12 — Retrospectiva accionable

Estado: **COMPLETADA y validada el 21 de octubre de 2026**. Cambios guardados en el repositorio local, sin commit, push ni despliegue. No se ha modificado producción ni Aula Estrella.

## Recorrido

Retrospectiva es una vista contextual del sprint, enlazada desde Tablero y Resumen, con URL propia `view=retro`. No añade otra pestaña a la navegación móvil.

1. Compartir observaciones en Conservar, Problemas e Ideas. Son aportaciones identificadas, visibles al equipo; no hay anonimato ni votaciones.
2. Seleccionar un problema con el equipo y acordar una acción pequeña. Cada problema tiene como máximo un acuerdo: dos usuarios o reintentos no crean duplicados.
3. Definir responsable del proyecto, criterio observable y, opcionalmente, sprint para revisarlo. Un acuerdo nuevo siempre empieza pendiente.
4. Revisar los pendientes del proyecto desde cualquier sprint. Dar seguimiento, reasignar, comprobar, descartar con motivo o reabrir una mejora; cada cambio necesita una nota y conserva su versión anterior.

La comprobación requiere confirmación expresa del equipo y una nota de resultado. No se deduce automáticamente del cierre del sprint ni del estado de tareas. Una retrospectiva no asigna puntos, no crea tareas ni mide rendimiento individual.

## Contrato y persistencia

- `GET /api/retro?workspace=…&sprint=…` devuelve observaciones del sprint, primera página de mejoras pendientes de todo el proyecto y contadores por estado. `filter=origin` muestra acuerdos originados en ese sprint; `filter=all` incluye comprobados y descartados.
- `action=…` consulta un acuerdo del mismo proyecto y su historial. `before=…` pagina acciones o historial según el modo. Lecturas autenticadas, sin caché, cursores vinculados al proyecto y filtro; recursos ajenos e inexistentes indistinguibles.
- Mutaciones compartidas: `addRetroObservation`, `selectRetroProblem`, `createRetroAction`, `updateRetroAction`. Todos los integrantes pueden colaborar, sin confundir acceso técnico con responsabilidad Scrum.
- Observaciones y acuerdos nuevos solo en sprints activos o completados. En planes y cancelados se conserva la consulta. El seguimiento de un acuerdo existente permanece editable entre sprints, incluso si su sprint de origen terminó o se canceló: no modifica el resultado congelado.
- Propietario y nombre de sprint se resuelven en servidor. No se aceptan nombres, textos de origen ni estados terminales inventados al crear. El responsable debe ser un integrante actual. El sprint de revisión nuevo debe pertenecer al mismo proyecto y estar planificado o activo; se puede conservar una referencia histórica ya asignada.
- Origen, observación, autor y fecha de acuerdo permanecen ligados a la mejora. Cambiar el título o responsable no borra el contexto. No hay eliminación destructiva de acuerdos: descartar/reabrir conserva el recorrido.
- Colecciones nuevas: `retro_observations`, `retro_actions`, `retro_updates`. Índices por proyecto/sprint, unicidad de acuerdo por problema y de versión por acuerdo. Compatibilidad aditiva: proyectos antiguos muestran retrospectiva vacía y contador 0, sin fabricar notas ni reescribir historia.
- Versiones independientes de observaciones y mejoras, comparación antes de guardar, transacciones, un evento por intención y recibos duraderos. Guardado, vínculo, contadores e historial se confirman juntos o se revierten juntos. El contador `workspace.retroRevision` permite refrescar seguimiento entre sprints sin invalidar borradores de contenido de tareas.

## Límites y experiencia

Hasta 100 observaciones y 50 acuerdos por sprint; texto de observación, criterio y nota de hasta 1.000 caracteres, título de 160. Las páginas tienen 50 acuerdos o versiones, orden estable incluso con fechas iguales. Actualizar vuelve a la primera página; contadores representan todo el proyecto, no solo esa página.

Borradores privados por usuario/proyecto/sprint/observación o acuerdo, en la misma pestaña. La confirmación de comprobación no se guarda como permiso automático. Se conserva el texto ante cierre, conflicto y fallo; almacenamiento bloqueado usa memoria con advertencia. Solo se borra el borrador exacto al confirmar el guardado. Las cuatro mutaciones recuperan una respuesta incierta tras recargar con la clave original.

Neumorfismo y tokens existentes, ambos temas, Grande inicial y texto mínimo de 12 px. Diálogos en portal al documento, cierre compartido con animación, Escape, foco y movimiento reducido; sin pantallas de espera artificiales. No se añaden dependencias, servicios, IA ni acceso a cuentas externas.

## Validación

- Se añadieron 27 casos de navegador/API: recorrido hasta el sprint siguiente, selección y versiones, colaboración concurrente, límites, historial paginado, permisos, aislamiento, rollback de las cuatro escrituras, recuperación de respuestas perdidas, borradores, foco y movimiento reducido.
- Los 6 controles estructurales pasaron. La regresión completa ejecutó 296 casos: 293 aprobados y 3 diferencias visuales nuevas, localizadas al borde del foco inicial del editor. Se inspeccionaron esas diferencias y se actualizaron únicamente las referencias de retrospectiva; también se ajustó la toma del seguimiento para no fotografiarlo debajo de la cabecera fija.
- Pasada final: **63/63 pruebas aprobadas**, incluidas las 27 nuevas y las **59 comparaciones visuales sin regeneración**, sin fallos, omisiones ni reintentos. Referencias anteriores conservadas; nuevas en `tests/e2e/__screenshots__/phase-12/`.
- Compilación de producción, TypeScript independiente, sintaxis del lanzador y revisión de espacios del diff aprobados. Sin cambios de dependencias ni ejecución de lint no solicitada.
- Vista previa aislada comprobada en Chromium: HTTP 200, tres observaciones, una mejora pendiente con revisión en el siguiente sprint, seguimiento visible también desde el plan, diálogo con foco y salida, móvil sin desbordamiento, cero errores de navegador y cero guardados durante la inspección. Solicitud de otro origen rechazada con 403; tareas y retrospectiva intactas antes/después. Captura revisada en `test-results/phase-12-preview.png`.
- El runner retiró el archivo temporal de credenciales; la demostración usa una base temporal independiente y un usuario ficticio. No se consultaron servicios externos, OAuth real ni IA.

Para revisar: `npm run preview:local`, con Node 24 y dependencias instaladas. El lanzador imprime un enlace a `view=retro`, con observaciones y una mejora pendiente para el siguiente sprint. Los datos se descartan al detenerlo; no introducir información real. La suite usa el mismo puerto, por lo que hay que cerrar la vista previa antes de ejecutar `npm test`.

La siguiente fase es 13: informes basados en historial real. El aviso de dependencias registrado en fase 1 sigue pendiente antes de cualquier publicación.
