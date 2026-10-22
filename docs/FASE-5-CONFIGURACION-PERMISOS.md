# Fase 5 — Configuración Scrum y permisos

17 de octubre de 2026 · America/Guayaquil.

Estado: **COMPLETADA y validada localmente**. Sin despliegue.

## Comportamiento

- Configuración conserva las preferencias personales e incorpora un bloque independiente de acuerdos compartidos: objetivo del producto, Definition of Done y responsabilidades Scrum.
- Se admite un Product Owner y un Scrum Master por proyecto; ambos pueden quedar sin asignar. Developers es una selección de integrantes, combinable con las otras responsabilidades. Nunca se infieren a partir del acceso técnico.
- Equipo distingue Propietario, Administrador y Miembro de Product Owner, Scrum Master y Developer. El propietario puede cambiar el acceso de otro integrante, con explicación previa de los permisos.
- Los formularios usan el ciclo de diálogos de la fase 3: foco contenido, salida compartida, restauración del foco, bloqueo durante guardado y movimiento reducido. Los errores conservan el borrador.
- Los acuerdos pueden quedar vacíos al empezar. Esta fase no impone comprobaciones de Definition of Done sobre tarjetas ni implementa ceremonias o el ciclo de cierre del sprint.

## Matriz de permisos técnicos

| Operación dentro del proyecto | Propietario | Administrador | Miembro |
| --- | --- | --- | --- |
| Leer tablero, equipo y acuerdos Scrum | Sí | Sí | Sí |
| Crear, editar, mover y eliminar tareas | Sí | Sí | Sí |
| Crear sprints | Sí | Sí | Sí |
| Cambiar objetivo, Definition of Done y responsabilidades | Sí | Sí | No |
| Consultar, renovar o revocar invitaciones | Sí | Sí | No |
| Cambiar Administrador ↔ Miembro | Sí | No | No |
| Modificar el acceso del propietario | No | No | No |

Crear un proyecto o incorporarse mediante una invitación válida requiere sesión, no pertenencia previa. Crear un proyecto asigna únicamente acceso de propietario. La admisión siempre asigna miembro, sin responsabilidades Scrum. Una membresía existente conserva su nivel al usar de nuevo una invitación.

Las tres mutaciones administrativas comprueban la membresía y el permiso en servidor, antes de migrar o escribir. No confían en el rol enviado por el navegador ni en responsabilidades Scrum. Devuelven 403 por falta de permiso, 400 por entrada inválida y 409 por versión obsoleta. Las rutas anteriores conservan su contrato de errores y sus comprobaciones de pertenencia.

## Invitaciones

- Solo propietario y administradores reciben el código activo. Se devuelve `inviteCode: null` a miembros y cuando está revocado, tanto en `workspace` como en `workspaces`. El código no se incluye en el registro de actividad.
- Renovar genera un código distinto e invalida el anterior. Revocar desactiva nuevas admisiones y descarta el código anterior. Reactivar genera siempre un código nuevo.
- Ambas acciones requieren confirmación en la interfaz y una revisión de invitación vigente en el servidor.
- Se mantiene al equipo existente; no se borra trabajo ni se revocan cuentas al revocar el enlace.
- La aceptación del código utiliza una actualización atómica condicionada al código activo en el mismo documento que modifica la revocación. Ninguna aceptación posterior a una revocación puede usar ese código. Una admisión aceptada **antes** de la revocación puede terminar creando su membresía después. No se promete cancelación retroactiva de solicitudes ya aceptadas ni se exige un replica set MongoDB para esta operación.

## Migración 005

Implementación: `db/migrations/005-scrum-governance.ts`.

La primera carga autorizada de un proyecto antiguo o su primera actualización válida de acuerdos/invitaciones ejecuta una migración **aditiva, por proyecto e idempotente**. No recorre otras bases ni actualiza todos los proyectos de un usuario por consultar uno. Una actualización atómica añade los campos ausentes y marca `schemaVersion: 5` y `scrumMigratedAt`. Cambiar únicamente el acceso de una membresía no necesita transformar el documento del proyecto.

Valores iniciales: objetivo vacío, lista DoD vacía, Product Owner/Scrum Master sin asignar, Developers vacío, revisiones en cero e invitación habilitada. Los valores ya presentes —incluida una invitación desactivada— se conservan. Los proyectos nuevos nacen con el esquema 5.

No cambia las membresías, propietarios, códigos existentes, perfiles ni contenido previo de sprints/tareas. Las cuentas existentes mantienen exactamente su acceso. No se elevan miembros a administradores. Las responsabilidades quedan pendientes de una elección explícita del equipo.

Antes de un futuro despliegue se debe respaldar la base exclusiva de Sprintia y ensayar con una copia. Los campos nuevos son aditivos, pero **no se debe revertir a una versión antigua que ignore `inviteEnabled` o los permisos**: reabriría la admisión que esta fase permite desactivar. Una reversión debe conservar esas comprobaciones. Esta entrega no ejecuta migraciones sobre producción.

## Validaciones y concurrencia acotada

- Objetivo: máximo 1.000 caracteres. DoD: hasta 20 criterios distintos, no vacíos, de hasta 300 caracteres cada uno.
- Los identificadores de responsabilidades deben pertenecer al mismo proyecto; Developers no admite duplicados. Product Owner y Scrum Master son campos únicos del proyecto, no banderas independientes que puedan duplicarse entre personas.
- Una sola actualización guarda los acuerdos y responsabilidades con `governanceRevision`. Otra sesión no puede sobrescribir una revisión obsoleta silenciosamente.
- Las invitaciones usan `invitationRevision`; los cambios de acceso comparan el rol previo y nunca modifican un propietario.
- El borrador mantiene la versión con la que se abrió. Ante conflicto se actualizan los datos de fondo sin reemplazar el borrador; cerrar y abrir permite revisar los valores actuales.
- La versión general de tareas/sprints y los eventos estructurados siguen correspondiendo a la fase 6. El refresco existente continúa cada 25 segundos; un cambio de permiso se hace efectivo en servidor sin esperar ese refresco visual. Las operaciones administrativas autorizadas antes de una degradación de permisos pueden terminar; no se añaden transacciones entre colecciones en esta fase.

## Evidencia

Pruebas nuevas: `tests/e2e/governance.spec.ts` y `tests/e2e/governance-ui.spec.ts`. Cubren migración, matriz de API, aislamiento, elevación de privilegios, referencias ajenas, validaciones, concurrencia, invitaciones y formularios compartidos. Las referencias originales de fases anteriores se conservan; Equipo móvil tiene una nueva referencia con prefijo `phase-5-` por el cambio intencional de responsabilidades.

- `npm test`: 6 controles estructurales y 128 pruebas de navegador/API/imagen aprobados; 0 fallos, omisiones, resultados inestables y reintentos. Ejecución completa: 281 segundos, iniciada el 17 de octubre de 2026 a las 20:26:36 UTC.
- Se conservaron las 105 pruebas anteriores y se añadieron 23. Comparación final de 18 imágenes sin regenerarlas: 14 referencias previas, la nueva referencia de Equipo móvil y tres formularios Scrum a 320, 390 y 1.107 px. Las cuatro imágenes nuevas se inspeccionaron visualmente.
- `npm run build`: compilación de producción Next.js/Turbopack correcta, con credenciales ficticias y URI local sin servicio. La comprobación detectó dos parámetros sin anotación en una prueba; se añadieron los tipos `Document` y la compilación posterior terminó correctamente, sin cambiar su comportamiento.
- `npm run typecheck`: sin errores después de compilar. `git diff --check`: sin errores, solo advertencias de conversión LF/CRLF de Windows. No se ejecutó lint en esta entrega.
- El servidor de pruebas terminó; el puerto 4317 quedó libre y `.test-runtime.json` fue eliminado. Los informes locales se guardan en `test-results/results.json` y `playwright-report/` (ignorados por Git).

Alcance: solo Sprintia local. Sin commit, push, despliegue, credenciales nuevas ni cambios en Aula Estrella. OAuth externo y el aviso de dependencias de la fase 1 siguen pendientes de comprobación antes de publicar.
