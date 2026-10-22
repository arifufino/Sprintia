# Fase 15 — Preparación de una versión estable

Estado: **PREPARACIÓN LOCAL VALIDADA y CANDIDATA DESPLEGADA el 21 de octubre de 2026; validación operativa pendiente**. La fase 14 original se aplazó por decisión del usuario; se conservó el chat con una mejora visual neumórfica. Tras autorización expresa, se publicó en el Sprintia original de `corno3130-5940`, conservando dominio y variables. [Registro del despliegue y sus límites](DESPLIEGUE-2026-10-21.md). Las puertas operativas descritas al final siguen abiertas: la fase completa no se declara terminada solo por la publicación.

## Implementación

- Exportación de contenido JSON desde Configuración, con permisos de propietario/administrador, snapshot coherente, selección explícita de campos y límites sin truncado silencioso.
- Copias operativas cifradas, verificables y con preservación de BSON, auditoría, recibos, índices y opciones de validación compatibles. Restauración únicamente a una base nueva aislada, nunca encima del origen ni una base ocupada.
- Registro acotado de errores en los nuevos flujos y los puntos principales anteriores; no se serializan excepciones con datos privados. Mensaje de fallo de página sin afirmar que un borrador no guardado está a salvo.
- Ciclo integrado de dos personas: planificación, inicio, conflicto de edición, conversación, impedimento y resolución, Daily, Review y conversión a backlog, retrospectiva, cierre, seguimiento de mejora e informes.
- Diseño del chat en claro/oscuro, mínimo de 12 px, foco, borrador y salida con movimiento reducido. Sin llamadas nuevas a IA.
- Actualización local de Next.js y eslint-config-next a 16.3.8; sharp y source-map-js corregidos en el lockfile. No se cambió de framework ni se añadió un servicio.

Procedimiento, alcance de la copia y límites: [Operación y recuperación](OPERACION.md).

## Auditoría de dependencias

La auditoría local del 21 de octubre de 2026 pasó de 1 dependencia crítica y 2 altas en producción a **0 avisos de producción** después de fijar Next.js 16.3.8, sharp 0.35.5 y source-map-js 1.2.2. También se aplicaron actualizaciones compatibles de brace-expansion y js-yaml.

La auditoría completa mantiene **5 avisos altos de desarrollo**, en la cadena braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next. No se usó `audit fix --force`: la propuesta automática degrada la configuración de Next a una versión mayor anterior y no constituye una validación de compatibilidad. Queda una revisión de riesgo/corrección pendiente antes de declarar la versión estable para publicación. Una auditoría sin avisos de producción no demuestra ausencia de vulnerabilidades.

Referencias de las correcciones revisadas: [aviso del proveedor de Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [corrección de mantenimiento de Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-3w37-wq28-93x7) y [aviso del proveedor de sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w). Los números anteriores corresponden a `npm audit` ejecutado sobre el lockfile local, no a una auditoría de producción.

## Validación

- **23/23 pruebas de Node aprobadas**: 7 de recuperación/registro, 10 de cálculo de informes y 6 controles estructurales. Incluye un archivo de 20 MB para superar expresamente el buffer interno predeterminado de BSON, frases incorrectas, manipulación, destinos ocupados y opciones no compatibles.
- Regresión amplia de **335 casos revisada**: 331 aprobados y 4 rechazos de copia por opciones de validación conservadas por las pruebas anteriores. Se corrigió la copia para preservar validador, nivel/acción y collation, en vez de omitirlos; se añadió una prueba que verifica que el destino conserva y aplica el validador.
- Pasada final tras esa corrección: **61/61 pruebas aprobadas**, sin fallos, omisiones ni reintentos. Incluye las 15 de esta entrega, las 25 de informes y las 21 de sincronización, con **12 comparaciones visuales sin regeneración**. No se volvió a ejecutar la suite entera después del ajuste limitado a recuperación; los demás casos y las 69 referencias visuales se revisaron en la regresión amplia.
- Compilación de producción Next.js 16.3.8, TypeScript independiente, sintaxis de ambos scripts y revisión de espacios del diff aprobados. La compilación usó valores ficticios, no conexiones productivas. No se ejecutó lint porque no fue solicitado.
- Medición orientativa de la exportación de 500 tareas, ruta ya compilada en desarrollo: 341.044 bytes y 48 ms en la pasada final. Se comprueba el presupuesto de 4 MiB y se rechaza tanto exceso de filas como de bytes; no es un SLA de producción.
- Vista previa final comprobada en Chromium: página y exportación HTTP 200, 10 tareas de demostración exportadas, cero errores de navegador, cero llamadas a IA y cero escrituras de usuario durante la inspección. Se conservó el borrador al cerrar/reabrir el chat y no hubo desbordamiento horizontal a 390 px. Las tareas antes/después fueron idénticas.
- Archivo temporal de credenciales de pruebas retirado por el runner. Solo se conserva el servidor local de demostración, con base efímera y sin Google, IA externa ni datos productivos.

[Ver la vista previa local](http://127.0.0.1:4317/?workspace=ws_starter_local_preview&view=settings&sprint=sp_starter_local_preview). Abre Copiloto para ver el chat; la descarga está en Datos del proyecto, al final de Configuración. Los datos se descartan al detener la sesión de vista previa.

## Puertas de publicación

No equivalen a fallos del ensayo local y no se deben dar por completadas sin acceso y autorización expresos:

- Resolver o aceptar de forma documentada los avisos de desarrollo que no tengan corrección compatible; no degradar Next.js para ocultarlos.
- Seleccionar una revisión inmutable, revisar migraciones con una copia real y probar staging con Google y MongoDB del entorno destino.
- Definir y comprobar copias recurrentes, retención, responsable, RPO/RTO y recuperación de una copia del entorno destino.
- Verificar la reversión de código en Vercel y el cambio a una base recuperada sin modificar Aula Estrella ni variables compartidas.
- Aprobar privacidad, límites y costes del despliegue concreto.

La candidata ya está publicada en Vercel. Hasta cerrar esas puertas, la publicación no equivale a una certificación ni a la validación completa de una versión estable.
