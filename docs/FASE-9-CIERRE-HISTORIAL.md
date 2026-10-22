# Fase 9 — Cierre, cancelación e historial; interfaz neumórfica

Estado: COMPLETADA y validada localmente. Fecha: 21 de octubre de 2026.

## Recorrido

1. Un sprint activo ofrece `Cerrar sprint`. Cualquier miembro del equipo puede revisar su resultado, las tareas incompletas y la Definition of Done, escribir un resumen y confirmar la revisión.
2. Al confirmar, las tareas incompletas vuelven al final del backlog, en su orden relativo anterior. Mantienen contenido, criterios, checklist, estimación y responsable; no se marcan terminadas ni pasan automáticamente a otro sprint. Las ya terminadas permanecen en el sprint finalizado.
3. Propietarios y administradores pueden `Cancelar sprint`, tanto activo como planificado, indicando un motivo. Se conserva como **cancelado**, separado de los completados. Las mismas reglas de devolución protegen el trabajo incompleto y conservan lo terminado.
4. `Historial de sprints` permite buscar por nombre u objetivo y filtrar completados/cancelados. Elegir un resultado abre su sprint mediante la URL existente.
5. El tablero y el Resumen de un sprint finalizado muestran una instantánea de solo lectura: resultado, fecha real, autor, objetivo, acuerdos y tareas al finalizar. Se puede filtrar trabajo terminado y devuelto, y desplegar descripción, criterios y checklist.
6. El equipo puede volver al backlog, reordenar el trabajo devuelto y seleccionar lo necesario al planificar otro sprint. Un cierre no inicia otro sprint.

La cancelación usa permisos técnicos; asignar la responsabilidad Scrum de Product Owner no convierte a esa persona en administrador. Una cancelación registra la decisión del equipo, no certifica un incremento ni equivale a completar el sprint.

## Datos y consistencia

- `Sprint.status` añade `cancelled`. `Sprint.outcome` es aditivo y se proyecta como `null` para registros anteriores; no hay migración que cierre sprints o invente resultados previos.
- La instantánea guarda tipo de finalización, fecha, identidad del autor, resumen/motivo, plan y disponibilidad, objetivo del producto, Definition of Done y alcance de tareas **en el momento de finalizar**. No representa un alcance inicial que todavía no se registraba.
- Cada tarea histórica conserva código, título, descripción, criterios, checklist, estado previo, puntos, responsable, orden y versión. Se identifica explícitamente si volvió al backlog. Cambiar o borrar después una tarea devuelta no reescribe su instantánea.
- `closeSprint` y `cancelSprint` usan el despachador transaccional, autorización y recibos idempotentes de fase 6. Guardan juntos resultado, devolución, versiones, un evento estructurado y recibo; un fallo revierte todo.
- La finalización comparte el contador de ciclo del proyecto con el inicio. Toda edición de contenido/estado de una tarea escribe también la versión de su sprint; no solo las transferencias. Una confirmación obsoleta rechaza con 409 en lugar de ocultar un resultado modificado.
- La confirmación exige las versiones de sprint y acuerdos que vio el usuario. Se comprueban resumen/motivo, revisión explícita y estado permitido en servidor, incluso llamando directamente a la API.
- Las tareas de sprints finalizados no admiten creación, edición, traslado o eliminación por ninguna de las rutas existentes. El trabajo devuelto se edita normalmente en el backlog. No hay reapertura en esta entrega.
- La devolución incrementa una vez la versión del backlog, incrementa la versión de cada tarea movida y asigna posiciones posteriores al trabajo existente. El historial no depende de las últimas 12 actividades del panel.
- Recuperar un recibo vuelve a comprobar acceso y, para cancelación, privilegios administrativos. No se añade un permiso implícito por responsabilidad Scrum.

## Interfaz y movimiento

- Neumorfismo compartido por ambos temas mediante colores neutros y sombras emparejadas: `--neu-raised`, `--neu-raised-sm` y `--neu-inset`. Se aplica a navegación, paneles, tarjetas, controles, filtros y diálogos.
- Bordes, etiquetas, foco visible y estados seleccionados acompañan al relieve; no se depende únicamente de sombras. Texto visible mínimo de 12 px y preferencia Grande conservados. En colores forzados se conservan bordes explícitos.
- Se mantienen las transiciones y la infraestructura de presencia de fase 3: salida real antes de desmontar, Escape, restauración de foco y movimiento reducido. No hay pantallas de espera añadidas para animar.
- Los formularios de finalización conservan el texto ante un conflicto. `Revisar versión actual` actualiza las versiones y exige marcar de nuevo la revisión; no sobrescribe el texto.
- Las intenciones inciertas de cierre/cancelación se recuperan al recargar la misma pestaña y usan la clave original al reintentar. Los formularios sin enviar no constituyen borradores permanentes.
- Una tarea terminada cuyo sprint se cierre remotamente pasa a solo lectura; un borrador ya abierto o recuperado sigue visible para copiarlo. No se elimina silenciosamente.
- La vista previa local mantiene datos temporales independientes: un sprint activo con tareas terminadas, en curso y por hacer, y otro planificado. Permite probar directamente cierre y cancelación; el historial comienza vacío hasta realizar una finalización. No incluye datos o servicios de producción.

## Validación

- 6 controles estructurales aprobados.
- Regresión completa de 213 casos: 212 aprobados, incluidos los 22 nuevos de fase 9. Una prueba anterior de arrastre falló al centrar una columna alta: el desplazamiento automático entre pulsar y comenzar a arrastrar cancelaba el gesto nativo de Chromium. Se ajustó el destino a su zona visible de soltar, conservando la comprobación de persistencia en base y tras recargar.
- Pasada final enfocada en ese arrastre y todas las capturas: **30/30 pruebas aprobadas**, 38 comparaciones visuales **sin regeneración**, 0 fallos, omisiones, casos inestables o reintentos. No quedan fallos pendientes de la ejecución completa.
- Compilación de producción, TypeScript independiente, sintaxis del lanzador y `git diff --check` aprobados.
- Capturas revisadas de ambos temas, lateral colapsado, Resumen, Configuración móvil, editor y cierre/histórico. Se conservan las referencias de fases anteriores.
- Vista previa comprobada en Chromium: HTTP 200, identidad ficticia, un sprint activo y otro planificado; apertura y salida de cierre, cancelación e historial, selector de sprint y bloqueo del inicio paralelo. Cero errores de navegador, sin guardados en esa comprobación y petición de origen externo rechazada con 403.
- El runner retiró sus servicios y el archivo temporal de credenciales. La vista previa independiente se deja iniciada para la revisión del usuario.

Las pruebas nuevas cubren devolución e inmutabilidad, compatibilidad sin instantáneas previas, validaciones y permisos, aislamiento entre proyectos, reversión transaccional, versiones de tareas/acuerdos, finalizaciones simultáneas, edición concurrente, bloqueo de todas las rutas sobre sprints finalizados y recorrido cierre → planificación → inicio. También comprueban la interfaz, filtros, solo lectura, borradores, respuesta perdida, foco, movimiento reducido y ventanas de 320, 390 y 1107 px.

El rediseño tiene referencias separadas en `tests/e2e/__screenshots__/phase-9/`; las carpetas y capturas de fases anteriores permanecen intactas.

Vista previa: `http://127.0.0.1:4317/?workspace=ws_starter_local_preview&sprint=sp_starter_local_preview`. Datos temporales de ejemplo, descartados al detener el lanzador.

## Fuera de alcance

Sin commit, push ni despliegue. Sin cambios en Aula Estrella ni en Vercel, Google o MongoDB productivo. Sin nuevas dependencias o servicios. El aviso de dependencias registrado en fase 1 sigue pendiente antes de publicar. La siguiente fase es Daily e impedimentos.
