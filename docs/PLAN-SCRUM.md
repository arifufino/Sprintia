# Sprintia: plan de evolución a una herramienta Scrum completa

Fecha: 12 de octubre de 2026.

Estado: fase 1 completada y validada el 12 de octubre de 2026; fase 2 completada y validada el 14 de octubre de 2026; fases 3 y 4 completadas y validadas el 15 de octubre de 2026; fase 5 completada y validada el 17 de octubre de 2026; fase 6 completada y validada el 18 de octubre de 2026; fase 7 completada y validada el 19 de octubre de 2026; fase 8 completada y validada el 20 de octubre de 2026; fases 9, 10, 11, 12 y 13 completadas y validadas el 21 de octubre de 2026. La fase 14 original se aplazó por decisión del usuario y se sustituyó por un retoque visual del chat existente, ya validado. Preparación local de fase 15 validada; sus puertas de publicación siguen pendientes. La validación es local y aislada; no constituye una auditoría de producción.

## Alcance

Trabajar únicamente en Sprintia. No modificar Aula Estrella, sus servicios ni configuraciones compartidas. Mantener Next.js, MongoDB, Google y Vercel; no añadir servicios de pago sin decidir antes su necesidad y coste.

Conservar la sencillez: la vista principal sigue siendo el tablero. Las herramientas avanzadas aparecen en su contexto, no como una pantalla llena de controles. Cada fase se entrega por separado y se valida antes de publicar; no se plantea una reescritura completa.

## Diagnóstico inicial del código, anterior a la fase 1

- Existe una base útil: autenticación, proyectos compartidos, tareas, backlog, selector de sprint, preferencias visuales y copiloto.
- `db/runtime.ts:createSprint` crea el primer sprint activo y los posteriores planificados. La API no ofrece iniciar, editar, cerrar o cancelar sprints. Elegir un sprint y activarlo deben ser operaciones diferentes.
- Los tipos no representan todavía objetivo del producto, Definition of Done, criterios de aceptación, impedimentos ni resultados de las ceremonias.
- El backlog no tiene reordenación persistente desde la interfaz. El tablero cambia estados mediante arrastre, pero no ordena tarjetas dentro de una columna.
- `TeamView` presenta al propietario como Scrum Master automáticamente. Los permisos técnicos y las responsabilidades Scrum deben separarse.
- La aplicación refresca los datos cada 25 segundos. Ya hay una actualización optimista al mover tarjetas, pero no versiones de registro para detectar ediciones concurrentes. `updateTask` vuelve a escribir campos leídos previamente y puede sobrescribir cambios simultáneos.
- La interfaz principal concentra 1.277 líneas y la hoja global 4.570. Hay reglas repetidas y correcciones con `!important`; conviene extraer componentes y estilos gradualmente, al intervenir cada flujo.
- Ya existen animaciones y soporte de movimiento reducido. Sin embargo, algunas salidas de los diálogos llaman directamente al cierre y omiten su animación. Hace falta un único mecanismo de apertura y salida.
- Las vistas se controlan mediante estado local, sin enlaces propios. Recargar o compartir una tarea no conserva una navegación completa.
- El resumen muestra el estado actual, no la evolución histórica del sprint. El registro de actividad es textual y limitado; no permite reconstruir de forma fiable métricas históricas.
- El copiloto reconoce acciones limitadas mediante patrones: crear tarea, crear sprint y seleccionar sprint. La respuesta generada por el modelo no constituye por sí misma un sistema general de ejecución de herramientas.
- Las pruebas existentes comprueban cadenas y estructura de archivos. Son útiles como controles básicos, pero no prueban los flujos de usuario, permisos reales ni ediciones de dos personas.

## Estructura de producto propuesta

Navegación principal:

- **Resumen:** objetivo del producto, objetivo del sprint, impedimentos y próximos eventos.
- **Backlog:** un backlog del producto, ordenado y filtrable; no duplicar tareas por sprint.
- **Sprints:** lista de planificados, activo e históricos. Dentro de cada sprint: planificación, tablero y cierre/resultados.
- **Equipo:** personas y responsabilidades. Acceso administrativo a invitaciones según permisos.
- **Informes:** tendencias y evolución, cuando exista historial suficiente.

Daily, Review y Retrospectiva viven dentro del sprint. Configuración permanece al pie de la navegación. El copiloto es un panel contextual compacto, no una columna permanente que reduzca el tablero. No mostrar secciones vacías antes de implementar su función.

Estructura técnica orientativa: componentes visuales compartidos; módulos de tareas, sprints y equipo; casos de uso de servidor compartidos por la interfaz y la IA; validación de entrada y autorización fuera de los componentes visuales. Adoptarla por incrementos, sin trasladar todos los archivos a la vez.

## Fases cortas, en orden de implementación

Cada fase debe tener un cambio demostrable, pruebas de su comportamiento y una revisión visual cuando corresponda. Si una fase exige varias entregas, dividirla antes de iniciarla. No se fijan fechas sin estimar las migraciones y probar el entorno.

### 01. Línea base comprobable — COMPLETADA

Añadir pruebas funcionales de acceso, carga de proyecto, creación y movimiento de tarea, y aislamiento entre proyectos. Usar datos de prueba separados de producción.

**Terminado cuando:** los flujos pueden ejecutarse de forma repetible y una persona ajena al proyecto no puede leerlo ni modificarlo. Registrar el aspecto inicial para comparar cambios visuales.

- [x] Pruebas de acceso, sesiones inválidas y cierre de sesión.
- [x] Carga y cambio entre proyectos autorizados.
- [x] Creación y movimiento de tareas con persistencia y una segunda sesión del equipo.
- [x] Intentos de lectura/escritura entre proyectos, comprobando que no hay filtraciones ni cambios en los datos ajenos.
- [x] MongoDB temporal, identidades ficticias y credenciales de prueba eliminadas al finalizar.
- [x] Siete capturas iniciales y comparaciones visuales repetidas.
- [x] `npm test`: 6 controles estructurales y 30 casos de navegador/API/imagen aprobados; sin fallos, omisiones ni reintentos.
- [x] TypeScript, ESLint y revisión de espacios del diff sin errores.

Evidencia y ejecución: [Pruebas de la fase 1](PRUEBAS-FASE-1.md). No se modificó el comportamiento de producción ni se desplegó. El OAuth externo de Google conserva su comprobación manual. Los problemas de distribución observados quedan registrados para la fase 2; el aviso crítico de dependencias debe resolverse antes de una nueva publicación.

### 02. Base visual y distribución — COMPLETADA

Unificar variables de color, tipografía, espacios y controles. Corregir el contenedor principal y la barra lateral ajustable. Extraer esos componentes sin rediseñar todas las vistas simultáneamente.

**Terminado cuando:** ocultar, mostrar y arrastrar el lateral no produce huecos, superposiciones ni desplazamiento horizontal de toda la página. Probar móvil, 1.107 px y escritorio. Conservar Grande como valor inicial y tamaños visibles nunca menores de 12 px, sin eliminar la jerarquía tipográfica.

- [x] Colores por tema, escala tipográfica, espacios y controles compartidos centralizados.
- [x] Contenedor, barra lateral y cabecera extraídos a componentes con estilos propios.
- [x] Arrastre real y ajuste por teclado entre 220 y 360 px; ancho y colapso persistentes, sin huecos ni solapamientos.
- [x] Menú móvil con foco contenido y cierre mediante Escape, botón y fondo; perfil accesible en ventanas bajas.
- [x] Objetivo, métricas y filtros del sprint adaptables al ancho útil, incluido el lateral ensanchado.
- [x] Grande predeterminado, mínimo de 12 px y jerarquía conservada sin ampliar la página con `zoom`.
- [x] Comprobadas las cinco vistas, los cuatro tamaños de texto, ambos temas y ventanas de 320 a 1.440 px.
- [x] Quince capturas revisadas y comparadas sin regenerar en la ejecución final; originales de la fase 1 conservadas.
- [x] `npm test`: 6 controles estructurales y 53 pruebas de navegador/API/imagen aprobados, sin fallos, omisiones ni reintentos.
- [x] TypeScript, compilación de producción y revisión de espacios del diff sin errores.

Evidencia y ejecución: [Base visual de la fase 2](FASE-2-BASE-VISUAL.md). Cambios guardados en el repositorio local, sin push ni despliegue. No se modificaron datos productivos ni servicios de Aula Estrella. El aviso de dependencias registrado en la fase 1 sigue pendiente antes de publicar.

### 03. Movimiento y diálogos consistentes — COMPLETADA

Centralizar las transiciones de modales, menús y copiloto. Una sola ruta de cierre para X, Escape, Cancelar, clic exterior y guardado satisfactorio. Añadir manejo de foco y restaurarlo al control de origen.

**Terminado cuando:** todas las entradas y salidas se perciben fluidas, no hay dobles cierres ni pérdida de foco, y movimiento reducido elimina desplazamientos innecesarios. No añadir pantallas de carga ni esperas artificiales.

- [x] Ciclo compartido de presencia y cierre para diálogos, menú móvil y Copiloto; el desmontaje espera la animación real, sin temporizadores arbitrarios.
- [x] X, Escape, Cancelar/Listo, clic exterior y guardado satisfactorio usan la misma salida; también la eliminación confirmada.
- [x] Foco inicial, Tab contenido, fondo inerte, Escape en la capa superior y retorno al origen o a un destino visible.
- [x] Traspaso del menú móvil al diálogo sin competir por el foco; Copiloto no modal con borrador conservado.
- [x] Protección frente a envíos/cierres repetidos y error de guardado visible sin perder el formulario.
- [x] Movimiento reducido sin desplazamientos ni espera residual, incluido cambiar la preferencia durante una salida.
- [x] `npm test`: 6 controles estructurales y 81 pruebas de navegador/API/imagen aprobados; 0 fallos, omisiones o reintentos. Incluye 28 casos nuevos y 15 referencias visuales conservadas.
- [x] TypeScript, compilación de producción y revisión de espacios del diff sin errores.

Evidencia y ejecución: [Movimiento y diálogos de la fase 3](FASE-3-MOVIMIENTO.md). Cambios guardados en el repositorio local, sin commit, push ni despliegue. No se modificaron servicios o datos productivos ni Aula Estrella.

### 04. Navegación con enlaces propios — COMPLETADA

Dar URL a proyecto, vista, sprint y detalle de tarea. Conservar filtros y selección cuando resulte útil. Añadir estados claros de recurso inexistente o acceso denegado.

**Terminado cuando:** recargar, usar Atrás y compartir un enlace conservan el contexto autorizado; nunca abren por accidente otro proyecto.

- [x] URL para proyecto, vista, sprint y detalle de tarea; filtros conservados sin llenar el historial por cada pulsación.
- [x] Recarga, Atrás y Adelante mantienen el contexto; el detalle sale con animación y restaura el foco.
- [x] Copiar enlace de tarea desde su detalle, sin códigos de invitación ni concesión de acceso.
- [x] Retorno local seguro después del inicio de sesión y compatibilidad con los enlaces de invitación existentes.
- [x] Estados de enlace inválido, proyecto/sprint/tarea no disponibles, sesión vencida y error de red, sin sustitución silenciosa por otro proyecto.
- [x] Respuestas antiguas descartadas, navegación durante guardado protegida y borradores conservados ante fallos de refresco.
- [x] `npm test`: 6 controles estructurales y 105 pruebas de navegador/API/imagen aprobados; 0 fallos, omisiones, resultados inestables o reintentos. Incluye 24 casos nuevos y 15 referencias visuales conservadas.
- [x] Capturas de recuperación y detalle móvil revisadas; TypeScript, compilación de producción y revisión del diff correctos.

Evidencia y contrato: [Navegación de la fase 4](FASE-4-NAVEGACION.md). Cambios locales, sin commit, push ni despliegue. La siguiente entrega es la fase 5: configuración Scrum y permisos.

### 05. Configuración Scrum y permisos — COMPLETADA

Incorporar objetivo del producto, Definition of Done y responsabilidades de Product Owner, Scrum Master y Developers. Separarlas de propietario/administrador/miembro. Definir y aplicar una matriz de permisos en servidor, incluidas invitaciones revocables.

**Terminado cuando:** ser propietario no asigna automáticamente el rol de Scrum Master; las restricciones se cumplen también al llamar directamente a la API. Las cuentas existentes conservan acceso mediante una migración explícita.

- [x] Objetivo del producto y Definition of Done compartidos, con límites y validaciones en cliente/servidor.
- [x] Product Owner, Scrum Master y Developers independientes de Propietario, Administrador y Miembro; sin asignaciones implícitas.
- [x] Matriz de permisos aplicada en servidor: propietario/administrador gestionan acuerdos e invitaciones; solo el propietario cambia el acceso de otro integrante.
- [x] Invitaciones renovables y revocables, con confirmación, invalidación de códigos anteriores y acceso del equipo existente conservado.
- [x] Migración 005 aditiva, aislada por proyecto e idempotente; conserva datos, membresías y valores ya configurados.
- [x] Diálogos compartidos, borradores conservados ante errores, detección de revisiones obsoletas y diseño adaptable con movimiento reducido.
- [x] `npm test`: 6 controles estructurales y 128 pruebas de navegador/API/imagen aprobados; 0 fallos, omisiones, resultados inestables o reintentos. Incluye 23 pruebas nuevas y 18 comparaciones visuales.
- [x] Compilación de producción, TypeScript y revisión de espacios del diff correctos; datos temporales y servidor de pruebas retirados.

Evidencia, matriz y migración: [Configuración Scrum y permisos de la fase 5](FASE-5-CONFIGURACION-PERMISOS.md). Cambios locales, sin commit, push ni despliegue. No se modificó Aula Estrella. Esta entrega preparó la base para la fase 6: cambios compartidos fiables.

### 06. Cambios compartidos fiables — COMPLETADA

Añadir versión de registro, actualizaciones de campos explícitos y detección de conflictos. Registrar eventos estructurados de cambios relevantes con fecha, autor y proyecto. Mejorar el refresco para evitar respuestas antiguas al cambiar de proyecto y recargas completas innecesarias.

**Terminado cuando:** dos sesiones no se sobrescriben silenciosamente; los errores recuperan el estado correcto y los reintentos no duplican acciones. Mostrar estado de sincronización real. Empezar sin un servicio adicional de tiempo real; evaluar suscripciones después si la latencia lo justifica.

- [x] Versiones de tareas y accesos, actualizaciones parciales y conflictos 409 comprobados con sesiones independientes; datos anteriores compatibles como versión 0.
- [x] Cambios, contadores, historial estructurado y recibos de reintento se confirman juntos mediante transacciones; un fallo intermedio revierte todo.
- [x] Identificador por intención y recibos duraderos: repetir una creación o eliminación no duplica sus efectos, y recuperar un recibo vuelve a comprobar permisos.
- [x] Borrador conservado ante edición/eliminación remota, comparación, copia y carga explícita de la versión actual; sin falso conflicto al cerrar un guardado propio.
- [x] Estado de sincronización visible, ETag/304, refresco al recuperar foco/conexión y protección frente a lecturas anteriores o de otro proyecto; sin servicios externos adicionales.
- [x] Reintento explícito de resultados inciertos y recuperación del movimiento optimista fallido, incluso cuando también falla el refresco.
- [x] `npm test`: 6 controles estructurales y 149 pruebas de navegador/API/imagen aprobadas; 0 fallos, omisiones, casos inestables o reintentos. Incluye 21 casos nuevos de fase 6 y comparaciones visuales sin regeneración en la pasada final.
- [x] Compilación de producción, TypeScript independiente y revisión de espacios del diff sin errores. Servidor de pruebas detenido y archivo temporal de credenciales eliminado por el runner.

Evidencia, contrato y límites: [Sincronización de la fase 6](FASE-6-SINCRONIZACION.md). Validada el 18 de octubre de 2026. Cambios guardados únicamente en el repositorio local, sin commit, push ni despliegue; Aula Estrella y los servicios productivos permanecen intactos. Antes de publicar, comprobar MongoDB con transacciones y resolver el aviso de dependencias de fase 1. La siguiente entrega es la fase 7: backlog y detalle de tarea.

### 07. Backlog y detalle de tarea — COMPLETADA

Añadir orden persistente, criterios de aceptación, checklist y estado sin estimar. Incorporar un editor pequeño con párrafos, listas y enlaces, guardando borradores. Permitir reordenar con ratón y teclado.

**Terminado cuando:** orden, descripción y criterios sobreviven a recargas y se comparten con el equipo; un guardado fallido no pierde el borrador. No confundir los criterios de una tarea con la Definition of Done común.

- [x] Orden persistente y compartido mediante arrastre, teclado y botones de posición; conserva foco y respeta movimiento reducido.
- [x] Versión independiente del backlog, operaciones atómicas e idempotentes y detección de conflictos; altas, bajas y transferencias no desaparecen al reordenar.
- [x] Criterios de aceptación propios de la tarea y checklist opcional, separados de la Definition of Done y del estado de trabajo.
- [x] Sin estimar como opción y valor inicial de la interfaz; estimaciones anteriores conservadas y totales que identifican el trabajo no estimado.
- [x] Editor breve de párrafos, listas y enlaces con vista previa segura, sin interpretar HTML ni añadir dependencias.
- [x] Borradores por usuario/proyecto/tarea en la misma pestaña, recuperación después de recargar, descarte explícito y protección ante conflictos y guardados fallidos.
- [x] Intenciones pendientes de tareas recuperables tras recargar, con la clave original para evitar duplicados; mover una tarjeta no elimina su borrador.
- [x] `npm test`: 6 controles estructurales y 170 casos de navegador/API/imagen aprobados; 0 fallos, omisiones, casos inestables o reintentos. Incluye 21 casos nuevos y 26 comparaciones visuales sin regeneración en la pasada final.
- [x] Compilación de producción, TypeScript independiente y revisión de espacios del diff aprobados. Servicios de prueba detenidos y credenciales temporales retiradas por el runner.

Evidencia y límites: [Backlog y detalle de la fase 7](FASE-7-BACKLOG-DETALLE.md). Validada el 19 de octubre de 2026. Los borradores sobreviven en la misma pestaña, no constituyen un respaldo permanente entre dispositivos. Todo queda en el repositorio local, sin commit, push ni despliegue; Aula Estrella permanece intacto. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente entrega es la fase 8: planificación e inicio de sprint.

### 08. Planificación e inicio de sprint — COMPLETADA

Editar sprints planificados, seleccionar trabajo del backlog y establecer objetivo, fechas y disponibilidad del equipo. Añadir la acción explícita de iniciar. En el modelo inicial, un proyecto representa un equipo y admite un sprint activo; ampliar ese modelo si se incorporan varios equipos.

**Terminado cuando:** el usuario puede preparar varios sprints y arrancar el elegido sin marcar todos como activos. El servidor evita dos inicios simultáneos. Los puntos son una ayuda opcional y la capacidad una orientación, no una cuota individual.

- [x] Todos los sprints nuevos comienzan planificados; crear o seleccionar no inicia. Los activos existentes permanecen intactos.
- [x] Edición de objetivo, fechas y disponibilidad colectiva; selección de tareas del backlog y devolución de tareas retiradas, con búsqueda y controles accesibles.
- [x] Planificación atómica, versiones, auditoría e idempotencia; conflictos conservan el formulario y los reintentos inciertos sobreviven a una recarga.
- [x] Inicio explícito con resumen y confirmación, objetivo y trabajo obligatorio; estimación y capacidad opcionales. Protección transaccional frente a dos inicios simultáneos en un proyecto.
- [x] Diseño adaptable, mínimo de 12 px, temas y tamaño de texto conservados; diálogos con transiciones, restauración del foco y movimiento reducido.
- [x] `npm test`: 6 controles estructurales y 191 pruebas de navegador/API/imagen aprobados. Regresión final tras ajustes: 36 casos aprobados, sin regenerar referencias ni fallos, omisiones o reintentos.
- [x] Compilación de producción, TypeScript y revisión del diff aprobados; vista previa de demostración verificada en Chromium, sin acceso a datos reales.

Evidencia, contrato y límites: [Planificación de la fase 8](FASE-8-PLANIFICACION.md). Cambios locales, sin commit, push ni despliegue; Aula Estrella permanece intacto. Vista previa temporal disponible para la revisión del usuario. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente entrega es la fase 9: cierre, cancelación e historial.

### 09. Cierre, cancelación e historial — COMPLETADA

Añadir cierre con resumen y revisión de elementos incompletos. Devolverlos al backlog para reordenarlos, sin marcarlos terminados ni trasladarlos automáticamente al siguiente sprint. Conservar una instantánea del sprint y su alcance. La cancelación es distinta del cierre y requiere motivo y permiso correspondiente.

**Terminado cuando:** se completa el recorrido planificar → iniciar → trabajar → cerrar → consultar histórico, sin pérdida de tareas. Repetir una petición de cierre no duplica movimientos ni altera el historial.

- [x] Cierre explícito de sprints activos con resumen, revisión del trabajo y Definition of Done; devolución del trabajo incompleto al final del backlog sin completarlo ni iniciar otro sprint.
- [x] Cancelación diferenciada, con motivo obligatorio y permiso técnico de propietario/administrador; admite planes y sprints activos.
- [x] Instantánea inmutable de plan, acuerdos, autor, fecha y alcance al finalizar; filtros de historial y consulta de detalles mediante el selector y las URL existentes.
- [x] Finalización, devolución, versiones, auditoría y recibo atómicos; conflictos, finalizaciones simultáneas y reintentos comprobados, incluidos resultados inciertos tras recargar.
- [x] Protección en servidor de todas las rutas de escritura sobre sprints finalizados. Trabajo devuelto editable y borradores abiertos conservados para copiar ante un cierre remoto.
- [x] Neumorfismo en ambos temas con controles hundidos y tarjetas en relieve; bordes y foco visibles, mínimo de 12 px, transiciones y movimiento reducido conservados.
- [x] 6 controles estructurales y 22 casos nuevos aprobados. Regresión completa de 213 casos revisada; incidencia del destino automático de arrastre corregida en la prueba. Pasada final: 30 casos aprobados y 38 comparaciones visuales sin regeneración, sin fallos pendientes.
- [x] Compilación de producción, TypeScript y diff correctos; vista previa temporal verificada en Chromium, con un sprint activo listo para probar el cierre.

Evidencia, contrato y límites: [Cierre, historial y neumorfismo de la fase 9](FASE-9-CIERRE-HISTORIAL.md). Validada el 21 de octubre de 2026. Todo queda en el repositorio local, sin commit, push ni despliegue; Aula Estrella permanece intacto. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente entrega es la fase 10: Daily e impedimentos.

### 10. Daily e impedimentos — COMPLETADA

Añadir una vista breve centrada en el objetivo del sprint, trabajo bloqueado y adaptación del plan. Incorporar impedimento con responsable de seguimiento y conversación por tarea. Las notas de Daily son opcionales, no un formulario obligatorio de control individual.

**Terminado cuando:** un bloqueo queda visible y se puede resolver con historial; cualquier compañero entiende qué impide avanzar sin revisar un chat externo.

- [x] Daily con objetivo del sprint, bloqueos abiertos y trabajo en curso o revisión, sin control individual obligatorio.
- [x] Impedimento único por tarea, con motivo, responsable de seguimiento y resolución explícita; visible en tablero, backlog y Daily, sin mover ni estimar trabajo automáticamente.
- [x] Conversación persistente y paginada por tarea, con historial de impedimentos separado de la actividad reciente del proyecto.
- [x] Acuerdos opcionales compartidos por sprint y fecha, versión propia, conflictos entre sesiones y enlace que conserva el día seleccionado.
- [x] Transacciones, recibos idempotentes, permisos y aislamiento; comentarios concurrentes no invalidan los borradores de contenido de tarea.
- [x] Borradores en la misma pestaña y recuperación de respuestas inciertas sin duplicar mensajes o perder texto; solo lectura tras finalizar un sprint.
- [x] Cierre con impedimentos congelados en el resultado; las tareas devueltas conservan su seguimiento y conversación actuales.
- [x] Neumorfismo, mínimo de 12 px, Grande predeterminado, navegación móvil ajustada, foco y movimiento reducido.
- [x] 6 controles estructurales; regresión completa de 240 casos y pasada final de 57 pruebas aprobadas, incluidas las 27 nuevas y 44 comparaciones visuales sin regeneración; fallos iniciales resueltos y arrastre repetido 3/3 veces.
- [x] Compilación de producción, TypeScript independiente, revisión de espacios y vista previa con datos temporales comprobadas.

Evidencia y límites: [Daily, impedimentos y conversación de la fase 10](FASE-10-DAILY-IMPEDIMENTOS.md). Cambios locales, sin commit, push ni despliegue y sin modificar Aula Estrella. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente fase es **11: Review e incremento**.

### 11. Review e incremento — COMPLETADA

Registrar el trabajo que cumple la Definition of Done, enlaces o evidencias de demostración, feedback y decisiones. Permitir convertir un acuerdo en un elemento del backlog, manteniendo su referencia.

**Terminado cuando:** puede mostrarse qué resultado se consiguió y qué cambió a partir del feedback. La Review no se convierte en una aprobación obligatoria para poder entregar software.

- [x] Review contextual con enlace propio, selector de sprint y acceso desde Tablero y Resumen, sin saturar la navegación móvil.
- [x] Resultado e incremento verificados expresamente por el equipo, Definition of Done y tareas obtenidas del servidor, evidencias con enlaces seguros y registro honesto sin incremento cuando corresponda.
- [x] Instantáneas del trabajo y acuerdos al revisar; versiones completas conservadas fuera del feed de actividad. Sprints cerrados usan su resultado congelado y los antiguos no reciben historia inventada.
- [x] Feedback y decisiones persistentes, paginadas, independientes del último resultado y de las últimas actividades del proyecto.
- [x] Conversión confirmada de decisiones a backlog sin duplicados, con referencia en ambos sentidos y conservación del origen aunque se elimine la tarea.
- [x] Versiones, transacciones, auditoría, recibos y permisos comprobados; dos usuarios no pisan resultados ni crean dos tareas desde el mismo acuerdo.
- [x] Borradores privados y recuperación de respuestas perdidas, incluso en conversiones desde páginas antiguas; no se borra otro texto sin enviar.
- [x] Neumorfismo, ambos temas, mínimo de 12 px, foco, diálogos dentro del viewport y cierres con movimiento reducido.
- [x] 6 controles estructurales; regresión inicial de 266 casos aprobados y pasada final de 62 pruebas aprobadas, incluidas las 29 nuevas y 50 comparaciones visuales sin regeneración.
- [x] Compilación, TypeScript, sintaxis del lanzador, revisión del diff y vista previa temporal comprobadas.

Evidencia y límites: [Review e incremento de la fase 11](FASE-11-REVIEW-INCREMENTO.md). Validada el 21 de octubre de 2026, sin commit, push ni despliegue. Aula Estrella y los servicios productivos permanecen intactos. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente fase es **12: Retrospectiva accionable**.

### 12. Retrospectiva accionable — COMPLETADA

Crear una retrospectiva ligera: observaciones, selección de problemas y acciones de mejora con responsable y seguimiento. No añadir votación compleja o anonimato hasta necesitarlo.

**Terminado cuando:** al siguiente sprint se puede comprobar qué mejora se acordó y si se llevó a cabo; no queda únicamente una lista de notas olvidadas.

- [x] Vista contextual con URL propia y acceso desde Tablero y Resumen, sin ampliar la navegación móvil.
- [x] Observaciones identificadas en Conservar, Problemas e Ideas, selección de problemas y acuerdo concreto por problema, sin votos ni anonimato.
- [x] Mejoras con responsable del proyecto, criterio verificable, sprint de revisión opcional y origen conservado; no crea tareas ni modifica estimaciones automáticamente.
- [x] Pendientes del proyecto visibles entre sprints, filtros de origen/todos, comprobación explícita con resultado, descarte con motivo y reapertura con historial.
- [x] Seguimiento de acuerdos anteriores sin reescribir resultados congelados; planes y cancelados no reciben observaciones ni acuerdos nuevos.
- [x] Autorización, versiones, transacciones, auditoría, límites y recibos idempotentes comprobados con sesiones independientes y fallos intermedios.
- [x] Borradores privados y recuperación de las cuatro mutaciones tras perder una respuesta, sin duplicar acuerdos ni borrar otro texto sin enviar.
- [x] Neumorfismo, temas, mínimo de 12 px, diálogos con foco y salida compartida, movimiento reducido y tamaños de 320, 390 y 1.107 px comprobados.
- [x] 6 controles estructurales; regresión de 296 casos revisada. Tras ajustar las nuevas referencias de foco, pasada final de 63/63 pruebas y 59 comparaciones visuales sin regeneración, sin fallos pendientes.
- [x] Compilación, TypeScript independiente, sintaxis del lanzador, diff y vista previa temporal verificados; ningún guardado durante la inspección de entrega.

Evidencia y límites: [Retrospectiva accionable de la fase 12](FASE-12-RETROSPECTIVA.md). Validada el 21 de octubre de 2026. Cambios locales, sin commit, push ni despliegue; Aula Estrella y los servicios productivos permanecen intactos. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente fase es **13: Informes basados en historial real**.

### 13. Informes basados en historial real — COMPLETADA

Crear evolución de trabajo pendiente/completado, cambios de alcance y tendencias de sprints cerrados usando los eventos de la fase 06. Separar estimación inicial de cambios posteriores y mostrar periodos sin datos.

**Terminado cuando:** los gráficos coinciden con casos de prueba conocidos y distinguen trabajo completado de trabajo retirado. No inventar historia previa a la instrumentación ni usar velocidad para clasificar personas.

- [x] Informes contextuales con URL propia, selector de sprint, actualización y recuperación de errores; sin ampliar la navegación principal.
- [x] Evolución de alcance, pendiente y terminado en tareas o puntos conocidos; estimación inicial congelada, trabajo sin estimar explícito y tabla accesible con los valores exactos.
- [x] Entradas, retiradas, reestimaciones y reaperturas diferenciadas mediante eventos mínimos, ordenados y transaccionales; los reintentos no duplican datos métricos.
- [x] Resultado de cierre anterior a la devolución al backlog, tendencias de los últimos 12 cierres y acceso a los anteriores; cancelaciones y periodos sin datos identificados, sin métricas individuales ni historia inventada.
- [x] Lectura autenticada y aislada, paginación, límites de volumen explícitos, totales completos por agregación y respuestas antiguas descartadas.
- [x] Neumorfismo, ambos temas, mínimo de 12 px, cifras destacadas, foco y movimiento reducido conservados; tamaños de 320, 390 y 1.107 px comprobados.
- [x] 10 pruebas puras y 6 controles estructurales aprobados; regresión completa de 321/321 casos y pasada combinada de 64/64 con 65 comparaciones visuales sin regeneración. Tras el ajuste tipográfico final, 3/3 pruebas y sus 6 capturas nuevamente aprobadas sin regeneración.
- [x] Compilación de producción, TypeScript independiente, sintaxis del lanzador, revisión del diff y vista previa temporal verificadas; inspección de entrega sin escrituras y credenciales temporales de pruebas retiradas.

Evidencia, contrato y límites: [Informes históricos de la fase 13](FASE-13-INFORMES-HISTORICOS.md). Validada el 21 de octubre de 2026. Cambios locales, sin commit, push ni despliegue; Aula Estrella y los servicios productivos permanecen intactos. El aviso de dependencias de fase 1 sigue pendiente antes de publicar. La siguiente fase es **14: Copiloto que actúa de forma controlada**.

### 14. Copiloto que actúa de forma controlada — APLAZADA; alcance visual realizado

El usuario pidió conservar el chat actual con neumorfismo y pasar a la siguiente fase, sin conectar una API de IA. Se mejoraron panel, mensajes, sugerencias y controles en ambos temas, conservando foco, borrador y salida animada. Las acciones y el servidor de IA no se modificaron. El contrato funcional original que sigue queda pendiente, no completado. Evidencia: [Chat visual](FASE-14-CHAT-VISUAL.md).

Conectar herramientas estructuradas a los mismos casos de uso y permisos de la aplicación. Primera entrega: crear y editar tareas, crear sprints planificados y proponer una selección para planificar. Contexto obtenido en servidor para el proyecto autorizado, no aceptado ciegamente desde el navegador.

Mostrar vista previa de cambios, confirmación para operaciones masivas o sensibles, resultado real por operación y registro de auditoría. Añadir límites de uso, prevención de duplicados y tratamiento de errores. No afirmar éxito antes de persistirlo.

**Terminado cuando:** una instrucción se refleja correctamente en el tablero, un permiso denegado no se elude y reintentar no duplica tareas. La IA no decide autónomamente objetivos, estimaciones, cierres o permisos. Voz, ejecución masiva avanzada y nuevas integraciones quedan para entregas posteriores.

### 15. Preparación de una versión estable — CANDIDATA DESPLEGADA; VALIDACIÓN OPERATIVA PENDIENTE

Completar pruebas integradas del ciclo Scrum y de dos usuarios, exportación básica de datos, comprobación de copias y restauración, registro de errores sin secretos y documentación de operación. Revisar costes, límites y rendimiento con datos representativos.

**Terminado cuando:** existe una versión candidata probada, migraciones revisadas y una forma comprobada de recuperar datos y revertir el despliegue. Ninguna publicación modifica servicios de Aula Estrella.

- [x] Exportación JSON autenticada y limitada, sin credenciales ni correos de perfil; separada explícitamente de una copia restaurable.
- [x] Copia operativa cifrada, verificación de integridad y restauración a una base nueva, sin borrar ni sobrescribir datos existentes.
- [x] Ensayo aislado de documentos, índices y rollback, y ciclo Scrum completo de dos usuarios con resultados, mejoras e informes.
- [x] Registro acotado de errores, instrucciones de operación, privacidad, límites, costes y procedimiento de reversión documentados.
- [x] Actualización local de mantenimiento y auditoría: sin avisos en dependencias de producción; cinco avisos altos en herramientas de desarrollo pendientes de revisión.
- [x] Regresión amplia revisada, cuatro rechazos de recuperación corregidos y pasada final de 61/61 casos, más 23/23 controles de Node; compilación, TypeScript y vista previa de entrega comprobados. La evidencia detalla el alcance de la repetición, sin afirmar una nueva pasada íntegra.
- [ ] Revisión inmutable y ensayo en staging autorizado de OAuth, migraciones, copia real y reversión de código/datos, con responsable y retención definidos.

Evidencia y puertas pendientes: [Preparación de versión estable](FASE-15-VERSION-ESTABLE.md) y [Operación](OPERACION.md). La preparación fue local; el 21 de octubre de 2026, con autorización expresa, se desplegó la candidata en el Sprintia original de Vercel, sin commit ni push y sin cambios en Aula Estrella. [Registro del despliegue](DESPLIEGUE-2026-10-21.md). La fase no se declara operativamente terminada solo por superar pruebas locales o publicar el código.

## Reglas de movimiento y accesibilidad

- Como punto de partida: microinteracciones de 120–160 ms, entradas de 180–260 ms y salidas de 140–200 ms; ajustar observando el resultado, no sumar retrasos a cada elemento.
- Priorizar opacidad y desplazamientos cortos. Reservar la animación escalonada para la primera aparición de grupos, no para cada refresco o pulsación.
- Al arrastrar el lateral, seguir el puntero sin una transición de anchura que lo retrase. Al ocultarlo, mantener el contenido bien medido y el botón de reapertura en una posición estable.
- Conservar scroll, foco, borradores y selección. Usar indicadores de carga solo ante esperas reales; evitar cambios bruscos de altura.
- Respetar `prefers-reduced-motion`, navegación por teclado, foco visible y zoom al 200 %. Probar combinaciones de tema y tamaño de texto. El mínimo de 12 px no basta por sí solo para garantizar accesibilidad.
- Las pruebas de cada fase acompañan su implementación; la fase 15 es una revisión de lanzamiento, no el primer momento de probar.

## Ampliaciones posteriores, no imprescindibles para Scrum

Notificaciones y menciones configurables; adjuntos con límites; épicas y subtareas si el tamaño del proyecto lo requiere; planning poker; integraciones con GitHub/calendario; presencia y sincronización en tiempo real si la solución inicial no es suficiente. Evaluar cada una por utilidad, complejidad y coste, evitando convertir un proyecto universitario en una herramienta difícil de mantener.

## Referencias

- [Scrum Guide oficial](https://scrumguides.org/scrum-guide.html): responsabilidades, eventos, artefactos y compromisos. Scrum no exige story points, planning poker ni una herramienta concreta.
- [W3C: animación provocada por interacciones](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions): permitir reducir animaciones no esenciales.
