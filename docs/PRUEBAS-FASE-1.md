# Fase 1: base de pruebas funcionales

## Resultado de validación — COMPLETADA

Validado el 12 de octubre de 2026 en Windows, Node.js 24.19.0, Playwright 1.64.0 y Chromium 156.0.8078.4.

- `npm test`: seis controles estructurales aprobados y 30 casos de navegador/API/comparación visual aprobados.
- Informe final de Playwright: 30 resultados esperados, 0 inesperados, 0 omitidos y 0 inestables; reintentos desactivados. Duración de la batería: aproximadamente 103 segundos.
- Las siete referencias visuales se compararon sin regenerarlas; los flujos principales se repitieron en ejecuciones separadas con una base temporal nueva.
- `tsc --noEmit`, ESLint y `git diff --check`: sin errores.
- Al terminar, `.test-runtime.json` ya no existía. No se usaron datos de producción ni se desplegaron cambios.

Los informes regenerables quedan en `test-results/results.json`, `test-results/.last-run.json` y `playwright-report/`, ignorados por Git. Los casos, las capturas y esta documentación permanecen en el proyecto para futuras verificaciones. Los límites y pendientes se detallan más abajo; este resultado no certifica las fases siguientes.

Actualización del 14 de octubre de 2026: la distribución y el lateral se corrigieron y verificaron en la [fase 2](FASE-2-BASE-VISUAL.md). Las observaciones visuales originales de este documento se conservan como historial; sus siete capturas iniciales no se reemplazaron. El informe regenerable actual corresponde a la batería ampliada de 53 casos.

## Qué se ejecuta

La batería abre la aplicación Next.js real con Chromium y se comunica por HTTP con sus rutas reales. MongoDB 7.0.24 se inicia como un proceso temporal de `mongodb-memory-server-core`; no se sustituye la base por un mock.

Los datos ficticios incluyen tres usuarios, tres proyectos, membresías diferentes, sprints y tareas. Cada prueba restablece esas colecciones y se ejecuta con un solo worker para evitar interferencias.

- Acceso: pantalla de entrada, sesión válida, sesión vencida, firma incorrecta, identidad incompleta, lectura/escritura sin sesión y cierre de sesión.
- Proyectos: carga de datos de propietario/miembro, cambio de espacio de trabajo y ausencia de información de un proyecto ajeno.
- Tareas: creación desde el formulario, persistencia tras recargar, movimiento con selector y mediante arrastre; visibilidad y edición desde una segunda sesión del equipo.
- Aislamiento: creación, edición, eliminación y creación de sprints en un proyecto ajeno; identificadores de tareas, sprints y responsables cruzados; mutaciones desde otro origen. Las pruebas comparan el estado de todas las colecciones antes y después de cada intento denegado.
- Referencia visual: entrada, tablero claro/oscuro, anchura de 1.107 px, móvil de 390 px, nueva tarea y copiloto.

## Seguridad del entorno

- La URL está fijada en `http://127.0.0.1:4317`; no hay opción para ejecutar escrituras contra un dominio remoto.
- El runner no reutiliza un servidor existente. Si el puerto está ocupado, falla.
- Genera una base `sprintia_e2e_<identificador aleatorio>` en un MongoDB nuevo, enlazado exclusivamente a loopback.
- Antes de preparar datos, las fixtures verifican el protocolo, la dirección, la ausencia de credenciales de MongoDB y el prefijo/ruta de la base temporal.
- El proceso Next recibe explícitamente URI, nombre de base y secreto de sesión efímeros. Las variables de Google son ficticias y la clave de IA queda vacía; estos valores prevalecen sobre `.env.local`.
- No se modificó el mecanismo de autenticación de producción ni se añadió una puerta de acceso de pruebas a la aplicación. Las cookies se firman con la biblioteca real de Auth.js y un secreto exclusivo de esta ejecución.
- `.test-runtime.json`, trazas, informes y resultados están ignorados por Git. El teardown elimina el archivo temporal de credenciales. Las capturas versionables solo contienen identidades y proyectos ficticios.
- El runner detiene el árbol de procesos al finalizar. En una terminación abrupta puede quedar un archivo local de ejecución; la siguiente ejecución lo reemplaza y nunca reutiliza un servidor ni una base de producción.

## Ejecutar

Requisitos: Node.js 24.x y dependencias instaladas en `scrum-tracker`.

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test` ejecuta los seis controles estructurales existentes y la batería de navegador/API. La primera ejecución descarga MongoDB para pruebas. Chromium, MongoDB y las fuentes de Next pueden necesitar acceso a Internet; las operaciones sobre proyectos permanecen en la base local temporal.

Comandos específicos:

```sh
npm run test:release
npm run test:e2e
npm run typecheck
npm run lint
npm run test:report
```

Se necesita libre el puerto 4317 y no ejecutar otro `next dev` sobre este mismo checkout al mismo tiempo: las pruebas usan el directorio de desarrollo `.next/dev`. No ejecutar dos baterías simultáneamente.

## Referencias visuales

Las siete imágenes iniciales están en `tests/e2e/__screenshots__/chromium/win32/`. Se fijan fecha del navegador, zona horaria, datos, tamaño Grande, tema y viewport. Se espera a las fuentes y se desactivan las animaciones durante la captura; solo se ocultan las herramientas de desarrollo de Next.

Las comparaciones normales no actualizan las referencias automáticamente. Cuando una fase cambie intencionalmente el diseño:

```sh
npm run test:visual:update
npm run test:e2e
```

Revisar visualmente las imágenes nuevas y el diff antes de aceptar la actualización. La tolerancia máxima es del 0,2 % de píxeles. Se separan referencias por sistema operativo; para otro sistema hay que generar y revisar su propia referencia. El estado móvil inicial conserva el lateral que tapa parte del contenido y el tablero de 1.107 px conserva superposiciones en la cabecera del sprint. Son defectos registrados para la fase 2, no un diseño aprobado.

## Límites de esta fase

- No automatiza el consentimiento ni el callback externo de Google. Sí usa los mecanismos reales de decodificación de sesión, consulta de usuario, cierre de sesión y autorización de Sprintia. El recorrido completo de OAuth sigue requiriendo una prueba manual en staging.
- No es una prueba de carga, una auditoría exhaustiva de seguridad ni una validación de producción.
- El comportamiento actual al solicitar un proyecto ajeno es devolver el primer proyecto permitido. Las pruebas verifican que no se filtra información ajena; un error explícito 403 puede abordarse en la fase de navegación/permisos. Las mutaciones sin membresía responden actualmente 400.
- No corrige los problemas visuales registrados: esa implementación corresponde a las fases 2 y 3.
- Los recorridos funcionales de escritorio se prueban a 1.440 × 960 px. Se observó que a 1.280 × 720 px el lateral puede dejar el cierre de sesión fuera de la zona accesible; se registra para corregirlo en la fase 2. Las capturas de móvil son referencias del estado actual, no una certificación de usabilidad móvil.

## Hallazgo de dependencias

La consulta `npm audit` del 12 de octubre de 2026 reportó 10 entradas vulnerables (9 altas y 1 crítica), incluida la dependencia de producción `next` 16.3.0. También aparecen dependencias de lint, `sharp` y `source-map-js`. Ninguna de las dos herramientas directas añadidas para pruebas figura como paquete vulnerable en ese informe.

No se ejecutó `npm audit fix --force` ni se actualizó silenciosamente el framework. Debe planificarse una actualización compatible y repetir estas pruebas antes de una nueva publicación. Completar la fase 1 no elimina este pendiente de seguridad.

## Fuentes de las herramientas

- [Playwright: servidor local de pruebas](https://playwright.dev/docs/test-webserver).
- [MongoDB Memory Server: instancia temporal para pruebas](https://typegoose.github.io/mongodb-memory-server/docs/guides/quick-start-guide/).
