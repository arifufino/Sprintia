# Fase 2: base visual y distribución

Iniciada el 12 de octubre de 2026. Completada y validada el 14 de octubre de 2026.

## Resultado — COMPLETADA

- `npm test`: 6 controles estructurales y 53 pruebas de navegador/API/imagen aprobados; 0 fallos, 0 omisiones y 0 resultados inestables, sin reintentos.
- La batería final duró aproximadamente 252 segundos y comparó las 15 referencias visuales sin regenerarlas.
- `tsc --noEmit`: sin errores.
- `npm run build`: compilación de producción correcta con Next.js/Turbopack, incluida su comprobación de TypeScript. Se utilizaron variables ficticias y una URI local sin servicio, no credenciales ni bases de producción.
- `git diff --check`: sin errores. Las advertencias de conversión LF/CRLF de Windows no son fallos del diff.
- El servidor de pruebas terminó y `.test-runtime.json` fue eliminado. No se hizo push ni despliegue.

## Implementación

- `app/components/AppShell.tsx` y su módulo CSS reúnen la barra lateral, la cabecera y la navegación móvil. Una cuadrícula determina el ancho del contenido; se eliminaron los márgenes y anchos globales contradictorios.
- El lateral mide 264 px inicialmente y admite 220–360 px mediante arrastre con captura del puntero o teclado (flechas, Mayús + flecha, Inicio y Fin). Al arrastrar se desactiva la interpolación para seguir el puntero; ocultar y mostrar conserva una transición breve.
- El ancho y el estado oculto persisten localmente, sin bloquear la aplicación si el navegador impide almacenar preferencias. El botón de reapertura ocupa su propio espacio en la cabecera. El acceso a otro proyecto queda dentro del lateral, separado del perfil.
- El perfil y el cierre de sesión permanecen accesibles en ventanas bajas. El contenido central del lateral tiene su propio desplazamiento. En móvil se usa un menú superpuesto con fondo, foco contenido, cierre con Escape y restauración de foco; cambiar entre móvil y escritorio cierra ese menú.
- `BoardHeader.tsx` y `BoardLayout.module.css` separan el selector/objetivo del sprint, sus métricas y los filtros. Las consultas de contenedor responden al ancho disponible después de ajustar el lateral, no solo al ancho de la pantalla.
- El desplazamiento horizontal necesario para las columnas queda dentro del tablero. No se ocultan desbordamientos de la página para disimular errores.
- `app/styles/tokens.css` define colores por tema, escala tipográfica, espacios, radios y foco. `controls.css` centraliza los controles compartidos; `responsive-views.css` adapta las vistas existentes al espacio útil sin rediseñarlas por completo.
- Se retiró `body { zoom: ... }` y la regla con `!important` que igualaba el tamaño de casi todos los textos. Grande sigue siendo la preferencia inicial. La base tipográfica es 14/15/16/18 px para Pequeño/Medio/Grande/Muy grande; los tokens de texto conservan un suelo de 12 px y los encabezados su jerarquía.
- Se corrigieron el contraste del acceso de Google, la tarjeta de invitación en tema claro y los indicadores de selección. No se cambiaron la autenticación, las APIs ni los datos del proyecto.

## Comprobaciones

`tests/e2e/layout.spec.ts` cubre:

- 1440×960, 1107×958, 1280×720, 390×844, 320×640 y 640×480.
- Arrastre mientras el puntero está pulsado, límites, teclado, persistencia y ocultar/reabrir sin huecos.
- Menú móvil con lateral previamente oculto, navegación con Tab, Escape, clic exterior y cambio de tamaño de ventana.
- Las cinco vistas con los cuatro tamaños de texto, en claro y oscuro; medidas reales de texto y ausencia de desbordamiento global.
- Lateral máximo con texto Muy grande, cambio de preferencia desde Configuración y conservación al recargar.
- Nombres y objetivos largos, ventana de 480 px de alto, almacenamiento bloqueado y movimiento reducido.
- Contraste del botón de entrada en los dos temas.

Las 15 referencias visuales de esta fase están en `tests/e2e/__screenshots__/phase-2/chromium/win32/`. Incluyen lateral oculto/ensanchado, menú móvil, ventana baja, ambos temas, las cinco vistas, nueva tarea y copiloto. Las siete referencias originales de la fase 1 se conservan sin reemplazarlas en `tests/e2e/__screenshots__/chromium/win32/`.

Para reproducir con Node.js 24.x:

```sh
npm run typecheck
npm test
```

Para revisar cambios visuales deliberados: `npm run test:visual:update`, inspeccionar las imágenes y después ejecutar `npm test` sin regenerarlas. Solo se oculta el control de desarrollo de Next.js durante las capturas/pruebas donde interceptaría botones; nunca se ocultan elementos del producto.

## Alcance y límites

Las pruebas usan el Next.js real y MongoDB temporal de la fase 1, con identidades ficticias, sin llamadas a Google ni al proveedor de IA. El informe regenerable queda en `test-results/results.json`; los archivos temporales de credenciales y el servidor local se eliminan/detienen al acabar.

Esta fase no centraliza todavía los cierres de todos los diálogos y del copiloto: corresponde a la fase 3. Tampoco implementa el ciclo de vida completo del sprint ni cambia roles Scrum. No se hizo publicación, push ni cambio de servicios externos; Aula Estrella queda fuera de alcance.

Continúa pendiente resolver el aviso crítico de dependencias documentado en la fase 1 antes de publicar. Esta validación de distribución no sustituye una auditoría de seguridad ni la prueba manual del OAuth real de Google. Las capturas automatizadas se verifican en Chromium/Windows; otros motores requieren comprobación adicional.
