# Fase 8 — Planificación e inicio de sprint

Estado: COMPLETADA y validada localmente. Fecha: 20 de octubre de 2026.

## Recorrido

1. En Tablero, `+ Sprint` crea siempre un sprint **planificado**, incluso si es el primero del proyecto. Seleccionarlo no lo inicia.
2. `Planificar sprint` permite editar nombre, objetivo, fechas y disponibilidad colectiva. La selección muestra tareas de ese sprint y del backlog, con búsqueda y casillas accesibles por teclado.
3. Guardar mueve las tareas seleccionadas al plan. Quitar una las devuelve al final del backlog, sin duplicarlas. El formulario admite hasta 100 cambios de selección por guardado.
4. `Iniciar sprint` presenta un resumen y exige confirmación, objetivo y al menos una tarea. Las estimaciones y la disponibilidad son opcionales; cero horas no bloquea el inicio.
5. El servidor registra el momento real de inicio sin sustituir las fechas planificadas. Solo un sprint puede estar activo por proyecto.

Los sprints activos existentes no se convierten ni se cierran automáticamente. Mientras haya uno activo se pueden preparar otros, pero no iniciarlos. Cierre, cancelación e histórico corresponden a la fase 9. Tampoco se reorganizó la navegación global: los controles nuevos aparecen en el contexto del sprint planificado.

## Datos y seguridad

- `Sprint` añade `availability`, `capacityHours` y `startedAt`. Los registros previos se proyectan con `""`, `null` y `null`, sin inventar un inicio histórico ni reescribirlos al leer.
- Las altas nuevas, incluidas las de proyectos y el espacio inicial, son planificadas. Los ejemplos de un espacio nuevo quedan por hacer; los datos existentes permanecen intactos.
- `updateSprint` y `startSprint` usan el despachador transaccional y los recibos idempotentes de fase 6. Repetir la misma intención no duplica efectos ni eventos. Consultar un recibo vuelve a comprobar la pertenencia al proyecto.
- Los miembros pueden planificar e iniciar, conforme a la colaboración ya existente. Las responsabilidades Scrum no conceden permisos técnicos adicionales.
- Una versión de sprint protege el plan y su selección. Crear, transferir o eliminar tareas también invalida las versiones anteriores del sprint afectado. Los cambios de selección comprueban además la versión de cada tarea modificada.
- Los inicios escriben un contador interno del **mismo proyecto** antes de comprobar los activos. Dos transacciones dirigidas a sprints diferentes entran en conflicto en ese documento; la que reintenta lee el activo confirmado por la ganadora. No basta una comprobación de cliente ni un `count` sin escritura compartida.
- Se evita crear un índice único que impida abrir proyectos antiguos con activos duplicados. Si existen, se bloquean nuevos inicios, sin reparar o borrar datos silenciosamente. Las escrituras directas externas a la aplicación no están cubiertas por este bloqueo.
- El plan, sus transferencias, las versiones, un único evento `sprint.planned` con diferencias y el recibo se confirman juntos o se revierten juntos. `sprint.started` registra estado, autor y hora.
- Nombre, objetivo, fechas reales, disponibilidad, capacidad numérica y selección se validan en servidor. No se aceptan tareas de otro proyecto ni de otro sprint.

## Interfaz y recuperación

- Mantiene los tokens de diseño, el mínimo de 12 px, las preferencias de tamaño y los modos claro/oscuro.
- Reutiliza `ModalShell`: entrada/salida, Escape, foco circular, retorno del foco, bloqueo durante guardado y movimiento reducido.
- El encabezado distingue un sprint planificado de uno activo; los días de un plan son duración prevista, no una cuenta atrás que sugiera que ya empezó.
- Un conflicto conserva el formulario mientras esté abierto. Cargar la versión actual es una acción explícita que descarta esas ediciones; los formularios de planificación no son borradores permanentes.
- Las intenciones pendientes de crear, editar o iniciar sprints sobreviven a una recarga en la misma pestaña mediante el mecanismo de fase 7. El reintento conserva la clave original. No se reenvían automáticamente.
- Puntos sin estimar, horas disponibles y notas de contexto son ayudas colectivas, no objetivos de rendimiento ni cuotas personales. No se convierten puntos en horas.

## Validación

- `npm test`: 6 controles estructurales y 191 pruebas de navegador/API/imagen aprobados; 0 fallos, omisiones, casos inestables o reintentos. Incluye 32 comparaciones visuales.
- Tras el ajuste del tablero a 320 px y de las fechas del ejemplo inicial, regresión final de planificación y base visual: 36 pruebas aprobadas, sin regenerar referencias, fallos, omisiones o reintentos.
- Compilación de producción, TypeScript independiente y `git diff --check` aprobados. `node --check scripts/local-preview.mjs` aprobado.
- Vista previa aislada comprobada en Chromium: página y bootstrap HTTP 200, dos sprints planificados, apertura/cierre de planificación y confirmación de inicio habilitada en el sprint con tareas. Sin escrituras durante esa comprobación ni errores de navegador; petición de origen externo rechazada con 403.
- Corregido el proxy de desarrollo para aceptar la ruta actual de HMR de Next, además de la anterior, manteniendo las restricciones de host y origen. Captura final revisada en `test-results/phase-8-preview.png`.

Los 21 casos nuevos de `tests/e2e/sprint-planning.spec.ts` cubren compatibilidad, altas planificadas, edición/selección compartida, validaciones, permisos, conflictos, invalidación del alcance por rutas existentes, reversión ante fallo de auditoría, idempotencia, inicio simultáneo, duplicados heredados, recuperación de respuesta incierta, navegación, foco y movimiento.

Las seis referencias visuales nuevas son exclusivas de fase 8: tablero planificado y formulario a 320, 390 y 1107 px, con texto extragrande y combinaciones de tema claro/oscuro. Las referencias de fases anteriores se conservan.

## Vista previa aislada

`npm run preview:local`, con Node 24 y las dependencias de desarrollo instaladas, inicia:

- MongoDB temporal en loopback con un nombre aleatorio propio.
- Next en un puerto local interno.
- Un proxy en `http://127.0.0.1:4317` con una identidad de demostración y dos planes de ejemplo.

No se necesitan credenciales ni Google para esta demostración. El proxy firma únicamente con un secreto efímero propio y solo acepta su host/origen local. No hay ruta de acceso alternativo ni modificación de la autenticación dentro de la aplicación desplegable. Las variables reales del entorno se sustituyen; no se consultan bases productivas ni IA externa. Los tokens no se escriben en archivos ni se muestran.

Es una vista previa temporal para este ordenador, no un despliegue ni un respaldo. No introducir información real. `Ctrl+C` detiene únicamente sus procesos y elimina su base temporal. Antes de ejecutar las pruebas completas hay que cerrar la vista previa, ya que usan el mismo puerto. Si el puerto está ocupado, el lanzador falla sin cerrar procesos ajenos.

Enlace del ejemplo con tareas: `http://127.0.0.1:4317/?workspace=ws_starter_local_preview&sprint=sp_starter_local_preview`. La vista previa se deja iniciada para la revisión solicitada; los datos se descartan al detenerla.

Actualización de fase 9: el lanzador actual prepara un sprint activo y otro planificado para poder probar el cierre directamente. Los dos planes descritos arriba corresponden a la demostración original de fase 8.

## Fuera de alcance

Sin commit, push ni despliegue. Sin cambios de Vercel, Google, MongoDB productivo o Aula Estrella. Sin nuevos servicios ni dependencias. El aviso de dependencias de fase 1 sigue pendiente antes de publicar.
