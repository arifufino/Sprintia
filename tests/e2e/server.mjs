import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const runtimeFile = new URL("../../.test-runtime.json", import.meta.url);
const origin = "http://127.0.0.1:4317";
// Never reuse an environment-provided database or auth secret.
const databaseName = `sprintia_e2e_${randomUUID().replaceAll("-", "")}`;
const authSecret = randomBytes(48).toString("base64url");
const mongo = await MongoMemoryReplSet.create({
  binary: { version: "7.0.24" },
  replSet: { count: 1, ip: "127.0.0.1", dbName: databaseName, storageEngine: "wiredTiger" },
});
const uri = mongo.getUri(databaseName);
await writeFile(runtimeFile, JSON.stringify({ origin, uri, databaseName, authSecret }), { mode: 0o600 });

const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "4317"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    AUTH_URL: origin,
    NEXTAUTH_URL: origin,
    AUTH_TRUST_HOST: "true",
    AUTH_REDIRECT_PROXY_URL: "",
    AUTH_SECRET: authSecret,
    NEXTAUTH_SECRET: authSecret,
    AUTH_GOOGLE_ID: "sprintia-test-only.invalid",
    AUTH_GOOGLE_SECRET: "sprintia-test-only-not-a-real-credential",
    MONGODB_URI: uri,
    MONGODB_DB: databaseName,
    // Override .env files too: no external AI calls or production credentials.
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
  },
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await mongo.stop();
  await unlink(runtimeFile).catch(() => {});
  process.exit(code);
}
child.once("error", (error) => {
  console.error("No se pudo iniciar el servidor de pruebas:", error.message);
  void stop(1);
});
child.once("exit", (code) => void stop(code ?? 1));
process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));
