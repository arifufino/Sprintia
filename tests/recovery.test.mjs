import test from "node:test";
import assert from "node:assert/strict";
import { BSON, ObjectId, Long } from "mongodb";
import { archiveCollections, validateArchive, sealArchive, openArchive, restoreDatabase, captureDatabase } from "../scripts/lib/recovery.mjs";
import { failureRecord } from "../lib/safe-log.ts";
const phrase = "una-frase-solo-para-pruebas-aisladas";
function archive() {
  const collections = Object.fromEntries(archiveCollections.map((name) => [name, []]));
  collections.tasks.push({ _id: "t", title: "Trabajo privado", date: new Date("2026-10-21T15:00:00Z"), ref: new ObjectId(), serial: Long.fromString("9223372036854775806") });
  return { format: "sprintia-database", version: 1, database: "sprintia_test", createdAt: new Date().toISOString(), collections, indexes: Object.fromEntries(archiveCollections.map((name) => [name, []])), options: Object.fromEntries(archiveCollections.map((name) => [name, {}])) };
}
test("backup: encrypted round trip preserves BSON types and does not reveal content", () => {
  const data = archive(), sealed = sealArchive(data, phrase);
  assert.ok(!sealed.includes("Trabajo privado") && !sealed.includes(phrase) && !sealed.includes("sprintia_test"));
  assert.equal(BSON.EJSON.stringify(openArchive(sealed, phrase), { relaxed: false }), BSON.EJSON.stringify(data, { relaxed: false }));
  assert.notEqual(sealed, sealArchive(data, phrase));
});
test("backup: rejects a wrong phrase, modified bytes, truncated files and short phrases", () => {
  const sealed = sealArchive(archive(), phrase), tampered = JSON.parse(sealed); tampered.ciphertext = "AAAA" + tampered.ciphertext.slice(4);
  for (const [file, key] of [[sealed, "otra-frase-incorrecta-de-pruebas"], [JSON.stringify(tampered), phrase], [sealed.slice(0, -5), phrase], ["{}", phrase]]) assert.throws(() => openArchive(file, key), /No se pudo verificar/);
  assert.throws(() => sealArchive(archive(), "corta"), /20 caracteres/);
});
test("backup: a 20 MB archive round-trips beyond the BSON library default scratch buffer", () => {
  const data = archive(); data.collections.tasks = Array.from({ length: 20 }, (_, i) => ({ _id: `large_${i}`, text: "x".repeat(1_000_000) }));
  const restored = openArchive(sealArchive(data, phrase), phrase);
  assert.equal(restored.collections.tasks.length, 20); assert.equal(restored.collections.tasks.at(-1).text.length, 1_000_000);
});
test("backup: rejects incompatible versions, missing collections and duplicate identities", () => {
  const data = archive(); assert.throws(() => validateArchive({ ...data, version: 2 }));
  const missing = archive(); delete missing.collections.accounts; assert.throws(() => validateArchive(missing));
  data.collections.tasks.push(data.collections.tasks[0]); assert.throws(() => validateArchive(data), /repetidos/);
});
test("backup: restore refuses production, source and occupied destination before writes", async () => {
  let writes = 0;
  const client = { db: () => ({ listCollections: () => ({ toArray: async () => [{ name: "already_here" }] }), createCollection: async () => { writes++; } }) };
  for (const name of ["sprintia", "aula_estrella", "sprintia_test", "sprintia_restore_abc", "sprintia_restore_abcdefgh"]) await assert.rejects(restoreDatabase(client, name, archive()));
  assert.equal(writes, 0);
});
test("backup: refuses unknown collections and unsupported views or options before reading data", async () => {
  for (const entry of [{ name: "future_collection", type: "collection", options: {} }, { name: "tasks", type: "view", options: {} }, { name: "tasks", type: "collection", options: { capped: true } }]) {
    const client = { db: () => ({ listCollections: () => ({ toArray: async () => [entry] }) }) };
    await assert.rejects(captureDatabase(client, "sprintia_test"));
  }
});
test("logging: only fixed categories and a random reference survive hostile exceptions", () => {
  const error = { code: 121, message: "mongodb://user:secret@host/db", stack: "bearer secret", cause: { token: "private" }, name: "secret", request: { email: "private@example.invalid" } };
  const record = failureRecord("mutation.failed", error);
  assert.equal(record.category, "validation"); assert.deepEqual(Object.keys(record).sort(), ["category", "event", "reference"]);
  assert.match(record.reference, /^[a-f0-9-]{36}$/); assert.doesNotMatch(JSON.stringify(record), /mongodb|secret|private|@/);
  assert.equal(failureRecord("export.failed", { code: "secret" }).category, "unexpected");
});
