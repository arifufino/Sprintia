// Operator tool, never exposed by a web route. No implicit .env loading.
import { readFile, writeFile, lstat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
import { captureDatabase, sealArchive, openArchive, restoreDatabase } from "./lib/recovery.mjs";
export async function run(args) {
  const [command, ...rest] = args, options = {};
  if (!["backup", "verify", "restore"].includes(command)) throw new Error("Usa backup, verify o restore. Consulta docs/OPERACION.md antes de continuar.");
  for (let i = 0; i < rest.length; i += 2) {
    if (!["--file", "--source-db", "--target-db", "--confirm"].includes(rest[i]) || !rest[i + 1] || Object.hasOwn(options, rest[i])) throw new Error("Argumentos no válidos o repetidos.");
    options[rest[i]] = rest[i + 1];
  }
  if (!options["--file"] || extname(options["--file"]) !== ".sprintia-backup") throw new Error("Indica un archivo .sprintia-backup.");
  const file = resolve(options["--file"]), passphrase = process.env.SPRINTIA_BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 20) throw new Error("Falta SPRINTIA_BACKUP_PASSPHRASE: mínimo 20 caracteres, nunca como argumento.");
  let archive;
  if (command !== "backup") {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 46 * 1024 * 1024) throw new Error("El archivo no es una copia válida dentro del límite.");
    archive = openArchive(await readFile(file, "utf8"), passphrase);
    if (command === "verify") return { ok: true, verified: true };
  }
  const databaseName = options[command === "backup" ? "--source-db" : "--target-db"];
  if (!databaseName || options["--confirm"] !== databaseName) throw new Error("Confirma el nombre exacto de la base con --confirm. No se usa una base predeterminada.");
  if (!process.env.SPRINTIA_RECOVERY_URI) throw new Error("Falta SPRINTIA_RECOVERY_URI. No se reutiliza implícitamente la conexión de la aplicación.");
  const client = new MongoClient(process.env.SPRINTIA_RECOVERY_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 20000 });
  try {
    await client.connect();
    if (command === "backup") {
      const content = sealArchive(await captureDatabase(client, databaseName), passphrase);
      await writeFile(file, content, { flag: "wx", mode: 0o600 });
      return { ok: true, encrypted: true };
    }
    return { ok: true, restored: true, ...await restoreDatabase(client, databaseName, archive) };
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result))).catch(() => {
    // Driver/OS exceptions can contain URIs and private paths. No raw errors.
    console.error("Operación de copia no completada. Revisa formato, frase, argumentos, conectividad y permisos; no se han sobrescrito datos. Consulta docs/OPERACION.md."); process.exitCode = 1;
  });
}
