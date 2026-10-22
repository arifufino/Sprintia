# Fase 13 — Informes basados en historial real

Estado: **COMPLETADA y validada localmente el 21 de octubre de 2026**. Sin commit, push, despliegue ni cambios en producción o Aula Estrella.

## Experiencia

Informes se abre desde el ciclo del Tablero o desde Resumen, conservando proyecto y sprint en la URL (`view=reports`). No amplía la navegación móvil.

- Evolución de alcance, pendiente y terminado con tareas como unidad inicial. Puntos estimados conocidos como alternativa; las tareas sin estimar se cuentan aparte, nunca se presentan como trabajo gratuito o cuota individual.
- Estimación y selección iniciales conservadas al pulsar Iniciar sprint. Entradas, retiradas, reestimaciones y reaperturas separadas del resultado actual.
- Una retirada, incluso una eliminación de trabajo terminado, reduce el alcance: no es una finalización nueva. Entrar ya terminado tampoco es una nueva finalización. Las reaperturas son transiciones, no personas ni entregas únicas.
- Resultado de cierre congelado antes de la devolución automática al backlog. El pendiente permanece en el último corte; cambiar después las tareas devueltas no reescribe la historia.
- Últimos 12 sprints finalizados, cantidad total visible y selector para consultar los anteriores. Cancelaciones diferenciadas y excluidas de las barras comparativas de completados. Sin clasificaciones por persona ni promesas de velocidad.
- Tabla accesible con los valores del gráfico; etiquetas HTML de al menos 12 px que no se reducen al escalar el SVG. Neumorfismo, temas, foco, movimiento reducido y Grande predeterminado conservados.

## Datos y cobertura

`activities.event`, introducido en fase 6, sigue siendo el historial estructurado. Las escrituras relevantes añaden `changes.reporting.after`, un paquete versión 1 con valores métricos anteriores/posteriores y una secuencia del proyecto. La actividad mantiene un solo evento por intención: no se duplican eventos para los informes.

Al iniciar se registra una instantánea mínima con ID, código, sprint, estado y puntos de las tareas seleccionadas, no nombres ni estadísticas de integrantes. `workspace.reportSequence` se incrementa en la misma transacción y proporciona un orden inequívoco incluso cuando varias operaciones tienen la misma fecha. Reintentar un recibo no avanza la secuencia. Un fallo de auditoría revierte también esta información.

Crear, mover, reestimar o eliminar tareas genera datos métricos; editar solo un título, comentar, registrar impedimentos o celebrar ceremonias no cambia la métrica. La planificación anterior al inicio queda representada por la instantánea del inicio, no por una curva de ejecución inventada. El cierre conserva su propia instantánea y marca el fin del recorrido.

Los informes no dependen de las últimas 12 actividades del bootstrap. Consultan el historial autorizado completo dentro de límites explícitos. Los paquetes de informes no se incluyen en ese pequeño feed para no repetir las instantáneas iniciales en cada refresco de la aplicación.

Coberturas:

- Completa: inicio medible, secuencia continua de estados y resultado que coincide con la instantánea observada.
- Sin inicio medible: el estado observado o resultado conservado se puede consultar, pero no se inventa una estimación inicial ni una curva anterior. Los cambios nuevos medibles siguen siendo consultables como parciales.
- Parcial: valores anteriores incompatibles, eventos métricos sin instrumentar o resultado que no coincide; no se dibuja una curva engañosa.
- Planificado: selección actual, sin evolución de trabajo antes del inicio.
- Limitada: más de 10.000 eventos o más de 2.000 tareas en la proyección activa; se muestra la limitación y no una curva truncada. Un alcance inicial mayor no impide iniciar el sprint, pero no recibe una instantánea parcial presentada como completa. Los totales actuales grandes se calculan mediante agregación sobre todo el alcance autorizado.

Los sprints antiguos sin resultado de cierre muestran datos no disponibles, no ceros ni tareas actuales usadas como pasado. No se migran ni fabrican eventos históricos. Las referencias antiguas de fase 6 son válidas como actividad, pero sus cambios parciales no bastan para certificar todas las estimaciones iniciales.

## API y límites

`GET /api/reports?workspace=…&sprint=…` es autenticado, de solo lectura, sin caché. Recursos inexistentes y ajenos responden de la misma manera. Parámetros duplicados, IDs inválidos y cursores numéricos incorrectos se rechazan. `before` pagina cambios medibles de 50 en 50; los eventos son inmutables y se ordenan por secuencia, no por UUID ni por texto de actividad.

El cálculo se realiza en una transacción de lectura snapshot: un cierre simultáneo no mezcla eventos antiguos con totales nuevos. Las respuestas viejas no sustituyen un sprint seleccionado después. Un error permite reintentar sin escribir nada.

La proyección acota eventos, tareas y muestras. Cortes al cierre del día de Ecuador (UTC-5), más inicio y último dato; intervalos mayores para recorridos muy largos, con menos de 185 muestras. No rellena fechas futuras ni dibuja una línea ideal de rendimiento. Las líneas unen observaciones, no predicen un ritmo. El resultado conserva tareas pendientes tras el cierre, no las resta como si se hubieran entregado.

Las lecturas de varios lotes revelaron una incompatibilidad del timeout transaccional del driver instalado con `getMore`. Se corrigieron las consultas nuevas usando proyecciones mínimas y lotes explícitos dentro de los límites anteriores; no se cambiaron dependencias ni se desactivaron las transacciones. Referencia de configuración: [timeouts y cursores del driver oficial](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/csot/).

## Validación

- 10 pruebas puras de cálculo, además de los 6 controles estructurales existentes, aprobadas.
- 25 pruebas nuevas de API/navegador aprobadas: números conocidos, historial independiente del feed reciente, inicio y cierre, estimaciones desconocidas, retiradas y reaperturas, permisos, rollback, idempotencia, concurrencia, paginación, límites, respuestas tardías y comparación visual en 320, 390 y 1.107 px.
- Regresión completa: **321/321 casos aprobados**, sin fallos, omisiones ni reintentos, tras corregir los dos fallos de lectura por lotes detectados en las pruebas de volumen iniciales.
- Pasada final: **64/64 casos aprobados**, incluidas las 25 pruebas nuevas y las **65 comparaciones visuales sin regeneración**, sin fallos, omisiones ni reintentos. Referencias anteriores conservadas; nuevas en `tests/e2e/__screenshots__/phase-13/`.
- Tras una última corrección tipográfica limitada a las tarjetas de informes, sus 3 casos adaptables y 6 capturas se compararon de nuevo sin regeneración, todos aprobados; se añadió una comprobación del tamaño destacado de las cifras.
- Compilación de producción, TypeScript independiente, sintaxis del lanzador y revisión de espacios del diff aprobados después del ajuste tipográfico final.
- Vista previa final verificada en Chromium: HTTP 200, cobertura completa en el sprint activo y el ensayo cerrado, resultado congelado correcto y sin desbordamiento horizontal a 390 px. Sin errores de navegador ni escrituras durante la inspección; tareas y métricas estables antes y después. También se comprobó el rechazo 403 de una escritura desde otro origen.
- El runner retiró el archivo temporal de credenciales de las pruebas. La única sesión conservada es la vista previa local con datos de demostración temporales, no cuentas ni bases productivas.

La demostración local realiza un ciclo real de ensayo en su base temporal, sin falsificar fechas pasadas. Conserva un sprint activo y otro planificado, además del ensayo cerrado con trabajo devuelto al backlog. No utiliza Google real, IA externa ni bases productivas.

Vista previa: [Informes de Sprintia](http://127.0.0.1:4317/?workspace=ws_starter_local_preview&view=reports&sprint=sp_starter_local_preview). Solo está disponible mientras se conserve la sesión local; sus datos son temporales.

La siguiente fase es 14: Copiloto que actúa de forma controlada. El aviso de dependencias de fase 1 sigue pendiente antes de publicar.
