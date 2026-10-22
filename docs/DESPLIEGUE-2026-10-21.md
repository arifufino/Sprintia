# Despliegue de Sprintia — 21 de octubre de 2026

Estado: **PUBLICADO y verificado en el dominio original**. Esta publicación no cierra por sí sola las comprobaciones operativas pendientes de la fase 15.

## Destino y versión

- Cuenta autenticada: `corno3130-5940`, elegida expresamente por el usuario.
- Equipo: `team_jkMRwwvM3dS85cFkYfmhDXdx` (slug `estrella-web`). El slug identifica el equipo, no una autorización para modificar otro proyecto.
- Proyecto original: `sprintia`, `prj_NQiCn5XRMaNbtP9HaZDnOPWV7jbj`.
- Dominio público conservado: <https://sprintia-sigma.vercel.app/>.
- Despliegue: `dpl_CM6Xji7Yknh4XLP8z7KgyaB9MHUE`, estado `READY`, destino `production`.
- URL de la versión: <https://sprintia-koj2jrjb1-estrella-web.vercel.app/>. Esta URL tiene protección de Vercel; no se desactivó.
- Inspección: <https://vercel.com/estrella-web/sprintia/CM6Xji7Yknh4XLP8z7KgyaB9MHUE>.
- Versión anterior de referencia: `dpl_7Qd9TuVZNLoLFRUYs8KGUYmQjUnT`.

Se desplegó el árbol de trabajo actual directamente, sin commit, push ni modificación de GitHub. El HEAD local era `6941a3614aae34c297a1c2f37f3e25d0f6af6f97`; **no representa los cambios locales incluidos**. La versión inmutable de esta publicación es el identificador de despliegue anterior.

## Paquete y compilación

La revisión previa detectó y corrigió las negaciones de directorios de `.vercelignore`. El manifiesto definitivo contiene **86 archivos**, 2.081.492 bytes antes de comprimir, sin archivos necesarios ausentes ni rutas inesperadas. Su huella SHA-256, calculada sobre la lista ordenada de rutas y hashes del manifiesto, es:

```text
797e10523642831207d1217b5dc452ecdd6ac6bcb8dd06b2339bda9ca13595e2
```

Se excluyeron `.env*`, `.vercel`, `.git`, dependencias, compilaciones locales, pruebas, capturas, copias operativas y el marcador de vista previa. No se subió el build local con valores ficticios. Vercel extrajo los 86 archivos y compiló de nuevo con Node.js 24 y Next.js 16.3.8; compilación y TypeScript aprobados.

Se reutilizaron las variables ya configuradas exclusivamente en Sprintia: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `MONGODB_URI` y `MONGODB_DB`. No se leyeron sus valores, no se modificaron variables compartidas ni se configuró una clave nueva de IA.

## Activación y comprobaciones

1. Creación de la versión con `--prod --skip-domain` y archivo comprimido.
2. Comprobación de la página de acceso y `/api/health` de la candidata mediante la sesión autorizada de Vercel, conservando su protección.
3. Promoción explícita de esa misma versión.
4. Consulta del alias: `sprintia-sigma.vercel.app` apunta al proyecto original y al despliegue `dpl_CM6Xji7Yknh4XLP8z7KgyaB9MHUE`.

Comprobaciones anónimas posteriores a la promoción:

- `/`: HTTP 200, botón de Google habilitado y sin aviso de configuración incompleta.
- `/api/health`: HTTP 200, `{"ok":true,"auth":true,"database":true}`.
- `/api/auth/providers`: HTTP 200, proveedor `google`.
- `/api/auth/session`: HTTP 200, sesión anónima `null`.
- Cabeceras CSP de producción, `nosniff`, `DENY` y política de referencia presentes.
- Página pública abierta y captura guardada: [evidencia visual](deployment-2026-10-21.png).
- Los 23 controles de Node se repitieron durante la preparación y aprobaron; no hubo cambios funcionales posteriores, solo empaquetado y documentación.

No se invocó bootstrap como prueba de salud ni se forzaron migraciones o escrituras de prueba en la base productiva. La comprobación de salud acredita configuración y conectividad, **no** un ciclo OAuth completo ni la compatibilidad de transacciones de todos los flujos. La migración aditiva existente mantiene su ejecución bajo acceso autorizado al proyecto.

## Límites y seguimiento

- Pendiente: un inicio de sesión real con Google y verificación funcional autenticada por el usuario.
- Siguen pendientes las puertas operativas de [fase 15](FASE-15-VERSION-ESTABLE.md): staging, copia real, ensayo de recuperación/reversión, responsables y revisión de los cinco avisos de desarrollo. No se ha certificado una versión estable completa.
- Se conservó el despliegue anterior como referencia de reversión; **no se ensayó un rollback en producción**. Revertir código no revierte datos.
- No se modificó Aula Estrella ni ningún otro proyecto del equipo.
- Antes del cambio de cuenta solicitado, se había creado un proyecto Sprintia vacío en `garifufino-6082`, `prj_WIuyGtLUxtESrusA4i50aHd1cLW7`, con un secreto de sesión propio. Quedó **sin despliegue**; no se eliminó ni se trasladaron datos. El vínculo local final volvió al Sprintia original. Los vínculos de referencia se conservaron en `.vercel`, fuera del paquete y de Git.
