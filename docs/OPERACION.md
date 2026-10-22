# Operación y recuperación de Sprintia

Ámbito exclusivo: Sprintia. No reutilizar credenciales, bases, proyectos de Vercel ni variables compartidas de Aula Estrella. Estas instrucciones no autorizan publicar ni cambiar producción.

## Exportación de contenido

Configuración → Datos del proyecto → Descargar proyecto · JSON. Solo propietario/administrador; el servidor comprueba el acceso en cada solicitud. Descarga autenticada y sin caché, coherente mediante snapshot de lectura.

Incluye acuerdos, integrantes por nombre e ID (sin correo de perfil), sprints con resultado congelado, tareas, conversaciones, Daily, Review y retrospectiva. Campos explícitos, sin credenciales, códigos de invitación, sesiones, recibos ni paquetes de auditoría. El contenido escrito por las personas puede contener información privada: no publicar el archivo.

Es una exportación de consulta, **no** una copia restaurable. No existe una importación web. Límite total 4 MiB, por debajo del máximo de respuesta de 4,5 MB de [Vercel Functions](https://vercel.com/docs/functions/limitations#request-body-size); además 5.000 tareas, 500 sprints, 200 integrantes, 5.000 conversaciones, 1.000 notas Daily, 500 Review y 5.000 entradas de cada clase de feedback/retrospectiva. Si se supera un límite, se rechaza la descarga completa; no se presenta un archivo truncado como completo.

## Copia operativa cifrada

Herramienta separada, para un operador autorizado: `npm run recovery -- …`. No expuesta por HTTP ni ejecutada contra producción en esta entrega. Requiere MongoDB con transacciones y permisos de lectura de la base origen. Se lee una base Sprintia nombrada expresamente: no hay base ni conexión predeterminadas.

Antes de usarla, guardar mediante el gestor de secretos del operador, solo en el entorno del proceso:

- `SPRINTIA_RECOVERY_URI`: conexión exclusiva a Sprintia. No se carga automáticamente `.env.local` ni se usa `MONGODB_URI`.
- `SPRINTIA_BACKUP_PASSPHRASE`: frase larga y única, mínimo 20 caracteres. Guardarla separada del archivo; perderla impide recuperar la copia. No introducirla en argumentos, capturas, chats ni el repositorio.

Ejemplo de argumentos sin valores secretos, desde el checkout:

```text
npm run recovery -- backup --source-db sprintia --confirm sprintia --file RUTA-PRIVADA/copia.sprintia-backup
npm run recovery -- verify --file RUTA-PRIVADA/copia.sprintia-backup
```

Elegir una ruta privada fuera del repositorio, con permisos del sistema operativo y almacenamiento cifrado. El directorio debe existir. El archivo se crea con exclusión: nunca se sobrescribe uno anterior. La extensión está ignorada por Git como protección adicional, no como sustituto de una ubicación privada ni de los permisos de Windows.

La copia está cifrada con AES-256-GCM y una clave derivada con scrypt, salt e IV nuevos; la verificación rechaza una frase equivocada, manipulación y archivos incompletos. El contenido BSON conserva fechas, ObjectId y enteros largos. Nunca se escribe un volcado intermedio sin cifrar.

Incluye las 20 colecciones conocidas de aplicación y autenticación: perfiles, proyectos, membresías, sprints, tareas, auditoría, contadores, recibos, conversación, Daily, Review y sus revisiones, retrospectiva y seguimiento, usuarios, cuentas, sesiones y verificaciones. Contiene datos personales y puede contener tokens o invitaciones: sigue siendo altamente privado aunque esté cifrado. Se copian los índices de las colecciones presentes.

Los documentos se leen en snapshot. Los índices y opciones se leen antes: no ejecutar cambios de esquema durante la copia. Se conservan validadores, nivel/acción de validación y collation. Se rechazan colecciones desconocidas, vistas y otras opciones especiales, como colecciones capped o series temporales; no se pretende sustituir una copia administrada completa de Atlas. Límites: 50.000 documentos, 32 MB de contenido y 46 MB de archivo cifrado. Para bases mayores, configurar y probar copias administradas. No se ha activado ningún plan de pago.

## Restauración sin sobrescrituras

Hacer un ensayo en un entorno aislado. No apuntar la aplicación pública a ese entorno ni permitir otras escrituras durante el ensayo. El destino debe ser una base completamente nueva cuyo nombre empiece por `sprintia_restore_`, con al menos ocho caracteres adicionales. La herramienta **no puede restaurar encima de `sprintia`, del origen ni de una base ocupada**.

```text
npm run recovery -- restore --target-db sprintia_restore_ensayo_20261021 --confirm sprintia_restore_ensayo_20261021 --file RUTA-PRIVADA/copia.sprintia-backup
```

Verificar primero el archivo. La restauración crea colecciones e índices, luego inserta los documentos en una sola transacción. Ante fallo, revierte todos los documentos; pueden quedar colecciones vacías con sus índices. No se borran automáticamente: usar otro nombre nuevo para el siguiente intento. No borrar ni mover una base existente para sortear la protección.

Comprobar cantidades e índices, recibos, referencias entre tareas y ceremonias, resultados congelados e informes. En un entorno privado, arrancar el mismo código contra el destino y probar con dos cuentas autorizadas. El ensayo local automatizado compara documentos e índices completos y un fallo intermedio; **no certifica OAuth, permisos de Atlas ni una recuperación de producción**. Los JWT existentes no quedan revocados por restaurar: un cambio de secreto de sesión o invalidación requiere una decisión operativa separada.

## Publicación y reversión — procedimiento manual pendiente

1. Elegir y registrar una revisión inmutable de Sprintia y conservar la revisión de producción anterior. No publicar un árbol sucio como versión identificable.
2. Ejecutar instalación reproducible, tipos, pruebas, comparaciones visuales, compilación y auditoría de dependencias. Revisar los avisos pendientes, incluso de herramientas de desarrollo. No usar `audit fix --force` para forzar una degradación mayor.
3. Revisar migración 005, permisos de aplicación e índices. La migración es aditiva e idempotente, pero no sustituye una copia anterior comprobada.
4. Acordar responsable, frecuencia, retención y almacenamiento de copias. Propuesta inicial, no configurada: una copia antes de cada publicación y diaria durante uso activo; retención según necesidades y coste del curso. Verificar regularmente una restauración separada y medir tiempos reales. RPO/RTO de producción todavía no establecidos.
5. Confirmar réplica/transacciones, permisos exclusivos para Sprintia, conectividad y límites reales de MongoDB/Vercel. No modificar variables compartidas.
6. En staging privado, comprobar Google OAuth, callback estable, cookies seguras, dos usuarios, invitación/revocación y recursos ajenos. El health check actual comprueba configuración y ping, no OAuth externo ni transacciones.
7. Revisar aviso de privacidad, responsables de datos y política de conservación. El contenido y copias del equipo no son públicos.
8. Desplegar únicamente tras autorización para Sprintia. Comprobar health, acceso, cambios compartidos y un recorrido breve. No se ha ejecutado este paso.
9. Para fallo solo de código, volver a la revisión anterior verificada en el mismo proyecto Sprintia y comprobar compatibilidad con la migración aditiva. No revertir a una versión sin controles de concurrencia sin validarla.
10. Para corrupción de datos, detener nuevas escrituras mediante un procedimiento de mantenimiento autorizado, restaurar a una base nueva, verificarla y decidir explícitamente el cambio de conexión y la pérdida admisible de cambios posteriores a la copia. Una reversión de Vercel por sí sola **no** revierte MongoDB.

## Errores, costes y límites

Bootstrap, mutaciones, exportación y error de página registran únicamente un nombre fijo de evento, categoría limitada y referencia aleatoria. No se imprime el error original, mensaje, stack, URI, cookies ni contenido de usuario. Esto no elimina los registros de infraestructura o de Auth.js: revisarlos aparte antes de publicar. Las referencias facilitan correlacionar un incidente, no son un servicio de monitorización ni alertas configuradas.

No se añadieron servicios externos ni costes de IA. El chat conserva su función anterior y solo se retocó visualmente; la fase 14 original está aplazada. El refresco sigue siendo de 25 segundos, no tiempo real. La exportación se acota a 4 MiB y solo se genera a petición; no promete capacidad masiva. Las mediciones locales de 500 tareas son orientativas, no un SLA de Vercel ni una previsión de coste de Atlas. Consultar los planes reales antes de contratar o abrir el servicio.
