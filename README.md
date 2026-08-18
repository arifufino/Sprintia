# Sprintia

Sprintia es un tracker Scrum colaborativo, sencillo y responsive para proyectos universitarios. Permite organizar el backlog, planificar sprints, repartir tareas y seguir el progreso del equipo desde un único tablero.

## Funciones

- Inicio de sesión con Google mediante Auth.js.
- Cuenta y perfil creados automáticamente en el primer acceso.
- Espacios de trabajo compartidos mediante código de invitación.
- Tablero Kanban con arrastrar y soltar y controles accesibles.
- Backlog, sprints, prioridades, responsables y puntos de historia.
- Resumen de progreso, distribución del trabajo y actividad reciente.
- Tema claro, oscuro o sincronizado con el sistema.
- Cuatro tamaños de texto guardados por dispositivo.
- Persistencia multiusuario en MongoDB Atlas.
- Diseño adaptable para escritorio, tableta y móvil.

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

## Verificación

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

El endpoint `GET /api/health` devuelve `200` cuando Google OAuth y MongoDB están configurados y la base responde.

## Despliegue en Vercel

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

Los códigos y enlaces de invitación conceden acceso como miembro del proyecto. Compártelos únicamente con el equipo y evita publicarlos en capturas, documentos públicos o incidencias.

## Lista de lanzamiento

- Confirma que `GET /api/health` responde `200` sin mostrar secretos.
- Prueba inicio y cierre de sesión con Google desde el dominio de producción.
- Prueba con dos cuentas que una invitación abre el mismo tablero y que un usuario externo no puede consultar ni modificar otro proyecto.
- Comprueba en móvil los temas claro/oscuro/sistema y los cuatro tamaños de texto.
- Revisa que `.env.local` y `.vercel` sigan ignorados antes de publicar el repositorio.
- Antes de abrir el servicio fuera del curso, publica un aviso de privacidad que explique que Sprintia guarda nombre, correo, pertenencia a proyectos y contenido del tablero.
