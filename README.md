# Sprintia

Sprintia es un tracker Scrum colaborativo, sencillo y responsive para proyectos universitarios. Permite organizar el backlog, planificar sprints, repartir tareas y seguir el progreso del equipo desde un único tablero.

## Funciones

- Inicio de sesión con Google mediante Auth.js.
- Cuenta y perfil creados automáticamente en el primer acceso.
- Espacios de trabajo compartidos mediante código de invitación.
- Tablero Kanban con arrastrar y soltar y controles accesibles.
- Backlog, sprints, prioridades, responsables y puntos de historia.
- Daily centrada en el objetivo, impedimentos con seguimiento y conversación por tarea.
- Acuerdos diarios opcionales compartidos, con control de versiones y recuperación de borradores.
- Review con resultados, Definition of Done, evidencias y decisiones convertibles en backlog con trazabilidad.
- Retrospectiva con problemas seleccionados, acciones de mejora, responsables e historial de seguimiento entre sprints.
- Informes con evolución real, estimación inicial conservada, cambios de alcance y resultados históricos; periodos sin datos indicados expresamente.
- Exportación JSON del proyecto para propietario/administrador, sin credenciales ni correos de perfil.
- Herramienta operativa de copia cifrada y restauración a una base nueva aislada.
- Resumen de progreso, distribución del trabajo y actividad reciente.
- Tema claro, oscuro o sincronizado con el sistema.
- Cuatro tamaños de texto guardados por dispositivo.
- Persistencia multiusuario en MongoDB Atlas.
- Diseño adaptable para escritorio, tableta y móvil.
- Enlaces a proyectos, vistas, sprints y tareas, con historial y filtros persistentes en la URL.

## Stack

- Next.js 16 y React 19
- Auth.js 5 con Google OAuth
- MongoDB 6 y el adaptador oficial de Auth.js
- Vercel para compilación, previews y producción

## Desarrollo local

Requiere Node.js 24.

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` como `.env.local` y configura las variables.

3. En Google Cloud crea un cliente OAuth de tipo **Aplicación web** y añade:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

4. Inicia Sprintia:

   ```bash
   npm run dev
   ```

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `AUTH_SECRET` | Secreto aleatorio de Auth.js. Generar con `npm exec auth secret`. |
| `AUTH_GOOGLE_ID` | Client ID del cliente OAuth de Google. |
| `AUTH_GOOGLE_SECRET` | Client secret del cliente OAuth de Google. |
| `MONGODB_URI` | URI privada del clúster MongoDB Atlas. |
| `MONGODB_DB` | Base de datos; por defecto `sprintia`. |
| `OPENAI_API_KEY` | Opcional. Activa respuestas generativas del Copiloto en el servidor. |
| `OPENAI_MODEL` | Opcional. Modelo de Responses API; por defecto `gpt-4o-mini`. |

No uses el prefijo `NEXT_PUBLIC_` para estas variables ni publiques valores reales en GitHub.

El botón **Copiloto** funciona también sin `OPENAI_API_KEY`: en ese caso responde con una guía local basada en el sprint actual y no envía el contexto fuera de Sprintia. Si configuras la clave en Vercel, se usa únicamente desde el servidor y nunca se expone al navegador.

El Copiloto también reconoce comandos confirmables como `crea un sprint llamado Diseño`, `crea una tarea en el backlog llamada Revisar fuentes` y `cambia al sprint Diseño`. Las acciones que modifican el proyecto siempre requieren pulsar **Ejecutar** dentro del panel.

Para MongoDB Atlas crea un usuario exclusivo para Sprintia con permiso `readWrite` únicamente sobre la base `sprintia`. Usa una contraseña larga y única, autoriza solo la conectividad necesaria para Vercel y codifica los caracteres especiales de la contraseña dentro de la URI.

Las escrituras compartidas requieren MongoDB con transacciones (replica set o clúster compatible; no una instancia standalone). No se degrada a guardados parciales si no está disponible. Antes de publicar, comprobar este requisito en el entorno destino. La actualización de fase 15 dejó la auditoría de producción sin avisos, pero quedan cinco avisos altos de herramientas de desarrollo pendientes de revisión; consulta [las puertas de publicación](docs/FASE-15-VERSION-ESTABLE.md).

## Verificación

La fase 1 incorpora pruebas funcionales con Chromium, la aplicación real y una base
MongoDB temporal. No usa producción. Requiere Node.js 24.x y, en la primera ejecución,
descargar el navegador con `npx playwright install chromium`.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` incluye controles estructurales y pruebas de navegador/API. Para ejecutar
solo una parte: `npm run test:release` o `npm run test:e2e`. Los datos aislados,
las referencias visuales, los límites y la actualización de capturas están descritos
en [Pruebas de la fase 1](docs/PRUEBAS-FASE-1.md). La distribución adaptable,
los componentes compartidos y las nuevas referencias visuales se documentan en
[Base visual de la fase 2](docs/FASE-2-BASE-VISUAL.md).
El ciclo compartido de ventanas, menú móvil y Copiloto se describe en
[Movimiento y diálogos de la fase 3](docs/FASE-3-MOVIMIENTO.md).
El contrato de enlaces, el historial y la recuperación de acceso están descritos en
[Navegación de la fase 4](docs/FASE-4-NAVEGACION.md).
Los acuerdos compartidos, las responsabilidades, la matriz de acceso y la migración
aditiva se describen en [Configuración Scrum y permisos de la fase 5](docs/FASE-5-CONFIGURACION-PERMISOS.md).
El control de versiones, los reintentos idempotentes, el historial atómico y los límites
del refresco se describen en [Sincronización de la fase 6](docs/FASE-6-SINCRONIZACION.md).
El orden compartido del backlog, los criterios, el checklist, el editor breve y la
recuperación de borradores en la misma pestaña se describen en
[Backlog y detalle de la fase 7](docs/FASE-7-BACKLOG-DETALLE.md).

La planificación, selección de trabajo e inicio explícito de sprints se documentan
en [Planificación de la fase 8](docs/FASE-8-PLANIFICACION.md).

El cierre, la cancelación, el historial y el diseño neumórfico se documentan en
[Cierre, historial y neumorfismo — fase 9](docs/FASE-9-CIERRE-HISTORIAL.md).

La Daily, sus acuerdos y las conversaciones por tarea se documentan en
[Daily, impedimentos y conversación — fase 10](docs/FASE-10-DAILY-IMPEDIMENTOS.md).

La Review y sus decisiones se documentan en [Review e incremento — fase 11](docs/FASE-11-REVIEW-INCREMENTO.md).

La retrospectiva se documenta en [Retrospectiva accionable — fase 12](docs/FASE-12-RETROSPECTIVA.md).

Los informes se documentan en [Historial real — fase 13](docs/FASE-13-INFORMES-HISTORICOS.md).

Entrega actual: [Chat neumórfico — alcance visual de fase 14](docs/FASE-14-CHAT-VISUAL.md),
[Preparación de versión estable — fase 15](docs/FASE-15-VERSION-ESTABLE.md) y
[Operación, copias y recuperación](docs/OPERACION.md). La IA ampliada se aplazó por decisión del usuario.

### Vista previa local sin cuentas reales

Con Node 24 y las dependencias de desarrollo instaladas, ejecuta `npm run preview:local`.
Abre el enlace que imprime el lanzador en `http://127.0.0.1:4317`. Utiliza una base
temporal, una identidad de demostración, un sprint activo y otro planificado. Incluye
un impedimento de ejemplo, su conversación, acuerdos de Daily y una Review con
resultado, evidencias, feedback y una decisión lista para convertir en backlog.
También incluye observaciones de retrospectiva y una mejora pendiente para revisar
en el siguiente sprint, con responsable y criterio de comprobación.
Los informes incluyen un ensayo cerrado mediante el ciclo real de la aplicación,
con trabajo pendiente devuelto al backlog. No se falsifican fechas históricas para
rellenar los gráficos.
No lee ni modifica datos de producción ni requiere
Google. No introduzcas información real.
Los datos se descartan al cerrar el servidor con `Ctrl+C`. Cierra esta vista previa
antes de ejecutar la suite de pruebas, que utiliza el mismo puerto.

El endpoint `GET /api/health` devuelve `200` cuando Google OAuth y MongoDB están configurados y la base responde.

## Despliegue en Vercel

Versión actual publicada el 21 de octubre de 2026 en [sprintia-sigma.vercel.app](https://sprintia-sigma.vercel.app/), dentro del proyecto original de `corno3130-5940`. [Evidencia, versión anterior y comprobaciones pendientes](docs/DESPLIEGUE-2026-10-21.md). No se modificó Aula Estrella.

Para configurar una instalación nueva (no sustituir las variables de la existente):

1. Importa este repositorio en Vercel.
2. Configura las cinco variables anteriores en **Production**.
3. Configura en Google Cloud la pantalla de consentimiento, el dominio autorizado y un cliente OAuth de tipo **Aplicación web**. Solicita únicamente `openid`, `profile` y `email`.
4. Usa el dominio estable de Vercel para registrar el origen y el callback exacto:

   ```text
   https://TU-DOMINIO
   https://TU-DOMINIO/api/auth/callback/google
   ```

5. Vuelve a desplegar y verifica `/api/health` y un inicio de sesión completo.

Las URLs Preview cambian y Google no admite comodines. Para pruebas OAuth usa el dominio de producción o un dominio estable de staging.

## Seguridad

- Las mutaciones verifican la sesión y la membresía del proyecto en el servidor.
- Las tareas siempre se consultan y modifican dentro de su espacio de trabajo.
- La API de escritura exige JSON del mismo origen, limita el tamaño de las solicitudes y no expone errores internos de MongoDB.
- Las respuestas incluyen CSP, HSTS, protección contra iframes y una política restrictiva de permisos del navegador.
- Los secretos permanecen fuera del repositorio.
- El inicio con Google solicita únicamente identidad básica (`openid`, `profile`, `email`), no acceso a Gmail.

Los códigos y enlaces de invitación conceden acceso como miembro del proyecto. Solo propietarios y administradores pueden consultarlos, renovarlos o revocarlos. Revocar impide nuevas admisiones sin retirar el acceso del equipo actual; una admisión ya aceptada puede terminar. Compártelos únicamente con el equipo y evita publicarlos en capturas, documentos públicos o incidencias.

Los permisos Propietario/Administrador/Miembro son independientes de Product Owner, Scrum Master y Developer. Solo el propietario cambia el acceso administrativo. No se asignan responsabilidades Scrum por crear una cuenta o proyecto.

## Lista de lanzamiento

- Confirma que `GET /api/health` responde `200` sin mostrar secretos.
- Prueba inicio y cierre de sesión con Google desde el dominio de producción.
- Prueba con dos cuentas que una invitación abre el mismo tablero y que un usuario externo no puede consultar ni modificar otro proyecto.
- Comprueba en móvil los temas claro/oscuro/sistema y los cuatro tamaños de texto.
- Revisa que `.env.local` y `.vercel` sigan ignorados antes de publicar el repositorio.
- Antes de abrir el servicio fuera del curso, publica un aviso de privacidad que explique que Sprintia guarda nombre, correo, pertenencia a proyectos y contenido del tablero.
