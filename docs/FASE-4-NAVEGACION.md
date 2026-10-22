# Fase 4: navegación con enlaces propios

Completada y validada el 15 de octubre de 2026 (America/Guayaquil).

## Resultado — COMPLETADA

- `npm test`: 6 controles estructurales y 105 pruebas de navegador/API/imagen aprobados, sin fallos, omisiones, resultados inestables ni reintentos. La ejecución de navegador duró aproximadamente 628 segundos.
- Se conservaron las 81 pruebas previas y se añadieron 24 de navegación. Las 15 referencias visuales se compararon sin regenerarlas. Se revisaron las capturas nuevas de recurso no disponible y detalle con enlace en móvil.
- `npm run build`: compilación de producción correcta con Next.js/Turbopack y TypeScript, usando variables ficticias y una URI local sin servicio; sin credenciales de producción.
- `npm run typecheck`: sin errores después de la compilación. `git diff --check`: sin errores; solo advertencias de conversión LF/CRLF de Windows.
- El servidor de pruebas terminó, el puerto 4317 quedó libre y `.test-runtime.json` fue eliminado. No se hizo commit, push ni despliegue.

## Comportamiento

- El proyecto, la vista, el sprint seleccionado y el detalle de tarea tienen URL. Recargar y compartir la dirección conservan el contexto, siempre que la cuenta tenga permiso.
- Las vistas, los sprints y los proyectos añaden entradas al historial. Los filtros sustituyen la entrada actual para no crear una entrada por cada letra escrita.
- Abrir una tarea añade su identificador. Atrás la cierra con la salida compartida de la fase 3; Adelante vuelve a abrirla. Cerrar una tarea abierta por enlace directo conserva el proyecto y no abandona la aplicación.
- El detalle incluye **Copiar enlace de tarea**. Si el navegador impide usar el portapapeles, se indica que puede copiarse la dirección del navegador. Los enlaces de lectura no conceden membresía ni incluyen códigos de invitación.
- El enlace se conserva al pedir de nuevo el inicio de sesión. El destino de OAuth se reconstruye con parámetros permitidos y siempre es local; no se acepta una dirección externa o una ruta arbitraria.
- Los enlaces de invitación existentes `/?join=CODIGO` siguen siendo un flujo distinto y explícito de incorporación al equipo.

## Contrato de URL

Se utiliza la ruta existente `/` con parámetros, sin migrar rutas del servidor ni añadir dependencias:

| Parámetro | Significado |
| --- | --- |
| `workspace` | Identificador del proyecto autorizado; obligatorio para enlazar un sprint o una tarea. |
| `view` | `board`, `backlog`, `summary`, `team` o `settings`. |
| `sprint` | Sprint seleccionado, validado dentro del proyecto. |
| `task` | Tarea cuyo detalle se abre, validada dentro del proyecto. |
| `q` | Búsqueda del tablero, hasta 200 caracteres al interpretar el enlace. |
| `priority` | Prioridad; se omite cuando se muestran todas. |
| `assignee` | Responsable del equipo o `none`; se omite para todo el equipo. |

Por ejemplo, con identificadores ficticios:

```text
/?workspace=ws_ejemplo&view=board&sprint=sp_ejemplo&task=task_ejemplo
```

Sin selección explícita se elige el sprint activo o el primero disponible. Un enlace directo a una tarea sin sprint se sitúa en Backlog. Las preferencias de tema, tamaño de texto y lateral siguen siendo locales y no forman parte del enlace.

Los filtros desconocidos se normalizan. Los identificadores de recurso vacíos, duplicados, mal formados o sin proyecto muestran un error; no se interpretan como una selección implícita. Al cambiar de proyecto se reinician los filtros y el sprint para no trasladar referencias de otro equipo.

## Permisos y recuperación

- `GET /api/bootstrap?workspace=...` devuelve **404** con el mismo mensaje para un proyecto inexistente o no autorizado. Antes devolvía silenciosamente el primer proyecto accesible; ese comportamiento se ha retirado para las solicitudes explícitas. Sin parámetro se mantiene la selección inicial habitual.
- El servidor filtra el conjunto de datos por membresía. El cliente comprueba sprint y tarea exclusivamente dentro de ese conjunto autorizado. No consulta recursos de otros equipos para averiguar si existen.
- Los estados de proyecto, sprint o tarea no disponibles ofrecen una recuperación explícita. No se abre otro proyecto automáticamente.
- Una sesión vencida o una membresía revocada retiran los detalles visibles al detectarse en el refresco. Un fallo temporal de red durante el refresco conserva el formulario y muestra un aviso; una carga inicial fallida permite reintentar el mismo enlace.
- Las solicitudes antiguas se cancelan y sus resultados se descartan. Atrás/Adelante vuelven a validar el proyecto; una respuesta tardía no puede sustituir una navegación más reciente.
- Atrás durante un guardado espera su resultado y la salida del diálogo. No ejecuta un segundo salto del historial al terminar de guardar.

## Estructura

- `app/lib/navigation.ts`: contrato, interpretación, normalización y destino seguro de inicio de sesión.
- `app/components/useWorkspaceNavigation.ts`: historial, carga autorizada, cancelación de solicitudes y refresco.
- `app/components/NavigationError.tsx`: estados de recuperación.
- `app/SprintiaApp.tsx`: integración de vistas, filtros, selección de sprint y presencia de los diálogos.
- `tests/e2e/navigation.spec.ts`: pruebas de enlaces, historial, permisos, recuperación y portapapeles con cuentas y datos ficticios.

## Límites

La verificación usa Chromium y MongoDB temporal local. El recorrido externo completo de Google OAuth conserva su comprobación manual antes de publicar; no se han enviado credenciales ni peticiones a Google, Atlas, OpenAI o Vercel. No se modifica el sistema de roles, el ciclo de vida de sprints ni la gestión de conflictos de edición de las siguientes fases.

Solo Sprintia. Sin commit, push ni despliegue y sin cambios en Aula Estrella. Sigue pendiente resolver el aviso de dependencias registrado en la fase 1 antes de una publicación.
