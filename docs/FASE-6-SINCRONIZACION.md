# Fase 6 — Cambios compartidos fiables

Estado: **COMPLETADA**, validada localmente el 18 de octubre de 2026. Implementación iniciada el 17 de octubre.

## Contrato de escritura

Todas las acciones de `/api/mutate` requieren `mutationId`, un UUID v4 generado una vez por intención del usuario. Un reintento debe enviar la misma clave y el mismo contenido. El servidor guarda un recibo por actor y clave; devolverlo exige volver a comprobar sus permisos actuales. Reutilizar la clave con otro contenido responde 409. No se conservan cargas completas ni códigos de invitación en los recibos, solo una huella SHA-256, resultado, actor, proyecto y fecha.

Actualizar o eliminar una tarea exige su `revision`. Los documentos anteriores se leen como versión 0 sin reescribirlos. Cada modificación efectiva aumenta la versión una vez; una operación sin cambios no genera evento ni incrementa versión. Los cambios de acceso utilizan `accessRevision`, independiente de `governanceRevision` e `invitationRevision`. Así también se detecta el caso de un permiso que cambia y luego vuelve a su valor anterior.

Las actualizaciones de tareas escriben únicamente los campos editados. Estado y sprint se validan juntos; el resto de campos no se vuelve a escribir desde una lectura antigua. Las tareas, responsables, sprints y permisos siguen acotados al proyecto autorizado. Los errores 409 no sobrescriben el documento actual.

## Atomicidad e historial

Los cambios de dominio, contadores, eventos y recibos se confirman en una misma transacción. Si falla cualquier paso, se revierten todos. Las operaciones dentro de la sesión son secuenciales. La creación inicial automática del proyecto de bienvenida sigue siendo el flujo existente; no se inventan eventos históricos para datos previos.

`activities.event` conserva tipo, entidad, versión, identificador de operación y valores anteriores/posteriores de los campos modificados, junto al autor, fecha y proyecto del registro. Los textos antiguos siguen siendo compatibles. Las invitaciones solo registran su estado y versión, nunca el código. El historial estructurado queda preparado para los informes de fases posteriores; el resumen mantiene su lista reciente, no un supuesto historial completo.

Se añade `mutation_receipts` y un índice único parcial de `activities.event.operationId`. Los recibos no caducan automáticamente: eliminarlos permitiría duplicar reintentos antiguos. Su retención y archivo deben decidirse junto con el respaldo, no mediante un TTL silencioso.

**Requisito de infraestructura:** MongoDB debe ser un replica set o clúster compatible con transacciones. Atlas normalmente lo proporciona; esta fase no comprueba ni modifica producción. Una instancia standalone devuelve un error claro y no utiliza escrituras parciales como alternativa. Las pruebas usan un replica set de un nodo, temporal y exclusivamente loopback. Referencia técnica: [transacciones del driver oficial de MongoDB](https://www.mongodb.com/docs/drivers/node/v6.x/crud/transactions/).

## Experiencia de sincronización

- Estado visible: actualizado, comprobando, guardando, sin conexión, sincronización pendiente o cambio sin confirmar. “Actualizado” significa que la última comprobación fue satisfactoria, no conexión en tiempo real.
- Refresco periódico cada 25 segundos cuando la página es visible, además de recuperar foco/conexión y el botón Actualizar. No se añade un proveedor de suscripciones.
- `ETag` y respuesta 304 conservan los datos del cliente cuando no hay cambios. La autorización se comprueba antes de responder 304. No se utiliza caché pública ni se omite la revisión de permisos.
- Las lecturas anteriores se invalidan al iniciar una escritura; el refresco automático se pausa mientras hay un cambio pendiente. Las respuestas de un proyecto anterior no sustituyen el actual.
- Si otra persona modifica una tarea abierta, el formulario conserva el borrador y permite comparar, copiarlo y cargar explícitamente la nueva versión. Si se elimina remotamente, conserva el texto sin permitir guardar sobre un recurso desaparecido.
- Ante un resultado incierto (red/5xx/respuesta ilegible), se conserva en memoria la intención original. El botón Reintentar cambio pendiente usa la misma clave incluso después de cerrar el diálogo. Los controles de edición quedan bloqueados hasta resolver esa operación; no se crea una segunda intención por accidente.
- Un error definitivo libera la intención. Un movimiento optimista fallido recupera el dato confirmado y solicita una nueva lectura.
- El refresco de una edición propia confirmada no muestra un falso conflicto durante la salida animada del formulario.

No hay cola offline persistente. El navegador advierte antes de recargar/cerrar con un resultado incierto, pero forzar la salida elimina la intención en memoria. Tras una recarga debe comprobarse el tablero antes de recrear una operación; guardar borradores persistentes corresponde a una fase posterior. Tampoco se promete refresco instantáneo, fusión automática de conflictos ni publicación de estos cambios.

Actualización del 19 de octubre: la [fase 7](FASE-7-BACKLOG-DETALLE.md) amplía la recuperación de borradores e intenciones de tareas a recargas de la misma pestaña. Las demás acciones mantienen el alcance en memoria descrito aquí; no se incorpora una cola offline general.

## Validación

Los casos nuevos están en `tests/e2e/synchronization.spec.ts`; usan sesiones ficticias, fallos deliberados y consultas directas a la base temporal. No acceden a Google, IA, Vercel ni bases externas.

| Comprobación | Evidencia |
| --- | --- |
| Dos sesiones editan la misma versión | Solo una confirma; la otra recibe 409. Tras revisar, puede editar sobre la nueva versión. |
| Reintentos simultáneos y posteriores | Una tarea, sprint o proyecto; un recibo y un evento. Otra carga con la misma clave se rechaza. |
| Actualización parcial y eliminación | Campos ajenos intactos; versión inválida o desactualizada no produce efectos; repetir una eliminación confirmada devuelve su recibo. |
| Fallo intermedio | Un validador deliberadamente incompatible en la base temporal impide el evento y revierte tarea, contador y recibo. El mismo intento funciona al restaurar el validador. |
| Permisos e historial | Se comprueban otra vez al recuperar un recibo; versiones de acceso evitan cambios ABA; los eventos no contienen invitaciones. |
| Recuperación en navegador | Respuesta perdida después del commit, reintento desde fuera del diálogo, desconexión y foco, movimiento optimista fallido y lectura antigua en vuelo. |
| Borradores y distribución | Conflicto visible, comparación y carga explícita; una eliminación remota no borra el texto. Capturas a 390 y 1.107 px, además de las vistas anteriores. |

La ejecución final de `npm test` aprobó **6 controles estructurales y 149 casos de navegador/API/imagen**, con 0 fallos, omisiones, casos inestables o reintentos. El informe registró 344,83 segundos para Playwright. Incluye 21 casos nuevos (13 de API/datos y 8 de navegador, con dos comparaciones visuales de conflicto). Las 19 referencias nuevas llevan prefijo `phase-6-`; se conservan las de fases anteriores. La pasada final comparó las capturas sin regenerarlas.

Se revisaron visualmente el tablero oscuro en móvil/1.107 px, escritorio claro, nueva tarea, equipo móvil, configuración a 320 px y los dos paneles de conflicto. No hay desbordamiento horizontal en los casos verificados; el diálogo largo mantiene desplazamiento vertical.

Las capturas de conflicto fijan el desplazamiento del diálogo en su posición superior después de cargar las fuentes. Se corrigió únicamente la referencia móvil de fase 6 que se había tomado parcialmente desplazada; no se relajó la tolerancia ni se ocultaron elementos del producto. La prueba de salida de edición comprueba además que no aparezca el aviso de conflicto al cerrar un guardado propio.

`npm run build` (Next.js 16.3/Turbopack), `tsc --noEmit` independiente y `git diff --check` finalizaron correctamente. La compilación usó variables ficticias y una base no operativa, sin llamadas a producción. El runner detuvo sus servicios y retiró `.test-runtime.json`; el puerto 4317 quedó libre. No se ejecutó ESLint en esta fase.

Cambios locales, sin commit, push ni despliegue. No se modificaron Aula Estrella ni servicios o datos productivos. Esta validación no sustituye la revisión de producción: confirmar soporte de transacciones y resolver el aviso de dependencias de fase 1 antes de publicar. Siguiente entrega: fase 7, backlog y detalle de tarea.
