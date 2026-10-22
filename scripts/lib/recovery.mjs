import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { BSON } from "mongodb";

export const archiveCollections = Object.freeze(["profiles", "workspaces", "memberships", "sprints", "tasks", "activities", "counters", "mutation_receipts", "task_updates", "daily_notes", "sprint_reviews", "review_entries", "review_revisions", "retro_observations", "retro_actions", "retro_updates", "users", "accounts", "sessions", "verification_tokens"]);
const MAX_ROWS = 50_000, MAX_BYTES = 32 * 1024 * 1024;
const AAD = Buffer.from("sprintia-encrypted-backup:1");
const collectionOptions = ["validator", "validationLevel", "validationAction", "collation"];
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function passphraseKey(passphrase, salt) {
  assert(typeof passphrase === "string" && passphrase.length >= 20 && passphrase.length <= 1024, "Usa una frase de copia de al menos 20 caracteres, guardada fuera del archivo.");
  return scryptSync(passphrase, salt, 32);
}
export function validateArchive(data) {
  assert(plain(data) && data.format === "sprintia-database" && data.version === 1 && typeof data.database === "string" && /^sprintia[a-z0-9_]*$/.test(data.database) && Number.isFinite(Date.parse(data.createdAt)), "La copia no tiene un formato compatible.");
  assert(plain(data.collections) && Object.keys(data.collections).length === archiveCollections.length && archiveCollections.every((name) => Array.isArray(data.collections[name])), "La copia no incluye todas las colecciones esperadas.");
  assert(plain(data.indexes) && Object.keys(data.indexes).length === archiveCollections.length && archiveCollections.every((name) => Array.isArray(data.indexes[name]) && data.indexes[name].every((index) => plain(index) && plain(index.key) && typeof index.name === "string" && index.name !== "_id_")), "Los índices de la copia no son válidos.");
  assert(plain(data.options) && Object.keys(data.options).length === archiveCollections.length && archiveCollections.every((name) => plain(data.options[name]) && Object.keys(data.options[name]).every((key) => collectionOptions.includes(key))), "La copia contiene opciones de colección no compatibles.");
  let total = 0;
  for (const rows of Object.values(data.collections)) {
    assert(rows.every((row) => plain(row) && Object.hasOwn(row, "_id")), "La copia contiene documentos no válidos.");
    const ids = rows.map((row) => BSON.EJSON.stringify(row._id, { relaxed: false }));
    assert(new Set(ids).size === ids.length, "La copia contiene identificadores repetidos.");
    total += rows.length;
  }
  assert(total <= MAX_ROWS && Buffer.byteLength(BSON.EJSON.stringify(data, { relaxed: false })) <= MAX_BYTES, "La copia supera el límite de 50.000 documentos o 32 MB.");
  return data;
}
export function sealArchive(data, passphrase) {
  validateArchive(data);
  const salt = randomBytes(16), iv = randomBytes(12), key = passphraseKey(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(AAD);
    const size = BSON.calculateObjectSize(data);
    assert(size <= MAX_BYTES, "La copia supera el límite BSON de 32 MB.");
    // The BSON library's default scratch buffer is only 17 MiB. Size this
    // archive explicitly; a valid larger copy must not fail or be truncated.
    const encoded = BSON.serialize(data, { minInternalBufferSize: size });
    let ciphertext;
    try { ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()]); }
    finally { encoded.fill(0); }
    return JSON.stringify({ format: "sprintia-encrypted-backup", version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  } finally { key.fill(0); }
}
export function openArchive(envelope, passphrase) {
  assert(typeof envelope === "string" && Buffer.byteLength(envelope) <= 46 * 1024 * 1024, "El archivo es demasiado grande.");
  try {
    const data = JSON.parse(envelope);
    assert(data.format === "sprintia-encrypted-backup" && data.version === 1, "Formato no compatible.");
    const decode = (field) => { assert(typeof data[field] === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(data[field]), "Codificación no válida."); return Buffer.from(data[field], "base64"); };
    const salt = decode("salt"), iv = decode("iv"), tag = decode("tag"), ciphertext = decode("ciphertext");
    assert(salt.length === 16 && iv.length === 12 && tag.length === 16 && ciphertext.length <= MAX_BYTES, "Tamaño no válido.");
    const key = passphraseKey(passphrase, salt);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAAD(AAD); decipher.setAuthTag(tag);
      return validateArchive(BSON.deserialize(Buffer.concat([decipher.update(ciphertext), decipher.final()]), { promoteLongs: false }));
    } finally { key.fill(0); }
  } catch { throw new Error("No se pudo verificar la copia: formato, frase o integridad incorrectos. No se ha restaurado nada."); }
}
export async function captureDatabase(client, databaseName) {
  assert(/^sprintia[a-z0-9_]*$/.test(databaseName), "Selecciona explícitamente una base de Sprintia.");
  const db = client.db(databaseName), listed = await db.listCollections().toArray(), names = listed.map((c) => c.name);
  assert(names.every((name) => archiveCollections.includes(name)), "Hay colecciones desconocidas. Actualiza la herramienta antes de hacer una copia incompleta.");
  assert(listed.every((collection) => collection.type === "collection" && Object.keys(collection.options ?? {}).every((key) => collectionOptions.includes(key))), "La base tiene vistas u opciones especiales no compatibles. Usa una copia administrada que las conserve.");
  const indexes = {}, options = {};
  for (const name of archiveCollections) {
    options[name] = listed.find((collection) => collection.name === name)?.options ?? {};
    indexes[name] = names.includes(name) ? (await db.collection(name).listIndexes().toArray()).filter((index) => index.name !== "_id_").map(({ v: _v, ns: _ns, ...index }) => { void _v; void _ns; return index; }) : [];
  }
  return client.withSession((session) => session.withTransaction(async () => {
    const collections = {}, data = { format: "sprintia-database", version: 1, database: databaseName, createdAt: new Date().toISOString(), collections, indexes, options };
    let count = 0, bytes = 0;
    for (const name of archiveCollections) {
      collections[name] = [];
      // No client-side transaction timeout: the installed driver otherwise sends
      // maxTimeMS on non-awaitData getMore. Server query limits still apply.
      for await (const row of db.collection(name).find({}, { session, batchSize: 200, maxTimeMS: 15_000 }).sort({ _id: 1 })) {
        count++; bytes += Buffer.byteLength(BSON.EJSON.stringify(row, { relaxed: false }));
        assert(count <= MAX_ROWS && bytes <= MAX_BYTES, "La base supera el límite de 50.000 documentos o 32 MB. Usa copias administradas para ese volumen.");
        collections[name].push(row);
      }
    }
    return validateArchive(data);
  }, { readConcern: { level: "snapshot" }, readPreference: "primary", maxCommitTimeMS: 10_000 }));
}
export async function restoreDatabase(client, databaseName, archive) {
  validateArchive(archive);
  assert(/^sprintia_restore_[a-z0-9_]{8,64}$/.test(databaseName) && databaseName !== archive.database, "La restauración solo admite una base nueva sprintia_restore_ seguida de al menos 8 caracteres.");
  const db = client.db(databaseName);
  assert((await db.listCollections({}, { nameOnly: true }).toArray()).length === 0, "La base destino debe estar completamente vacía; no se sobrescribe ni elimina información.");
  // Empty namespaces may remain after a failed transaction. Never delete them
  // automatically: choose a different new database for the next attempt.
  for (const name of archiveCollections) {
    await db.createCollection(name, archive.options[name]);
    if (archive.indexes[name].length) await db.collection(name).createIndexes(archive.indexes[name]);
  }
  await client.withSession((session) => session.withTransaction(async () => {
    for (const name of archiveCollections) {
      assert(await db.collection(name).countDocuments({}, { session }) === 0, "El destino cambió durante la restauración. Operación cancelada.");
      const rows = archive.collections[name];
      for (let i = 0; i < rows.length; i += 200) await db.collection(name).insertMany(rows.slice(i, i + 200), { session });
    }
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10_000 }));
  return { collections: archiveCollections.length, documents: Object.values(archive.collections).reduce((total, rows) => total + rows.length, 0) };
}
