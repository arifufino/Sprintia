// Development-only launcher. No preview authentication route or bypass is
// shipped in the app: this loopback proxy owns a disposable DB and JWT secret.
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer, connect } from "node:net";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { encode } from "next-auth/jwt";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:4317";
const databaseName = `sprintia_preview_${randomUUID().replaceAll("-", "")}`;
const secret = randomBytes(48).toString("base64url");
const cookieName = "authjs.session-token";
const user = { id: "local_preview", name: "Vista previa local", email: "preview@example.invalid" };
const cookie = `${cookieName}=${await encode({ token: { sub: user.id, userId: user.id, name: user.name, email: user.email }, secret, salt: cookieName, maxAge: 86400 })}`;
const probe = createNetServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const internalPort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const internalOrigin = `http://127.0.0.1:${internalPort}`;
let mongo, child, proxy, stopping = false;
const sockets = new Set();

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const socket of sockets) socket.destroy();
  proxy?.close();
  if (child?.pid) {
    // Only the exact process tree spawned by this launcher; no broad node kill.
    if (process.platform === "win32") await new Promise((resolve) => {
      const kill = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      kill.once("exit", resolve); kill.once("error", resolve);
    });
    else child.kill("SIGTERM");
  }
  await mongo?.stop();
  process.exit(code);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  mongo = await MongoMemoryReplSet.create({ binary: { version: "7.0.24" }, replSet: { count: 1, ip: "127.0.0.1", dbName: databaseName, storageEngine: "wiredTiger", spawn: { windowsHide: true, detached: process.platform === "win32" } } });
  child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(internalPort)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      AUTH_URL: internalOrigin, NEXTAUTH_URL: internalOrigin, AUTH_TRUST_HOST: "true", AUTH_REDIRECT_PROXY_URL: "",
      AUTH_SECRET: secret, NEXTAUTH_SECRET: secret,
      AUTH_GOOGLE_ID: "sprintia-preview-only.invalid", AUTH_GOOGLE_SECRET: "sprintia-preview-only-not-a-real-credential",
      MONGODB_URI: mongo.getUri(databaseName), MONGODB_DB: databaseName, OPENAI_API_KEY: "", OPENAI_MODEL: "" },
  });
  // Do not dump child diagnostics that may contain runtime URIs or credentials.
  child.stderr.resume();
  child.once("error", () => { console.error("No se pudo iniciar Next para la vista previa."); void stop(1); });
  child.once("exit", () => { if (!stopping) { console.error("La vista previa se detuvo."); void stop(1); } });
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${internalOrigin}/api/bootstrap`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Startup is asynchronous. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("No respondió el servidor local.");
  const response = await fetch(`${internalOrigin}/api/bootstrap`, { headers: { cookie } });
  const data = await response.json();
  const nextStart = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const nextEnd = new Date(Date.now() + 27 * 86400000).toISOString().slice(0, 10);
  const second = await fetch(`${internalOrigin}/api/mutate`, { method: "POST", headers: { cookie, origin: internalOrigin, "content-type": "application/json" },
    body: JSON.stringify({ action: "createSprint", mutationId: randomUUID(), workspaceId: data.workspace.id, name: "Sprint 2 · Próximo incremento", goal: "Validar la experiencia con compañeros", startDate: nextStart, endDate: nextEnd }) });
  if (!second.ok) throw new Error("No se pudo preparar el segundo sprint de demostración.");
  const demoSprint = data.sprints[0];
  const demoMutation = async (payload) => {
    const result = await fetch(`${internalOrigin}/api/mutate`, { method: "POST", headers: { cookie, origin: internalOrigin, "content-type": "application/json" },
      body: JSON.stringify({ mutationId: randomUUID(), workspaceId: data.workspace.id, ...payload }) });
    if (!result.ok) throw new Error("No se pudo preparar el ciclo del sprint de demostración.");
    return result.json();
  };
  // An actual, short plan/start/work/close cycle in the disposable database.
  // Do not fabricate past timestamps just to make the report look populated.
  const rehearsal = await demoMutation({ action: "createSprint", name: "Ensayo completado · Demostración", goal: "Comprobar el ciclo Scrum y conservar su resultado" });
  const rehearsalTask = await demoMutation({ action: "createTask", sprintId: rehearsal.sprintId, title: "Validar el recorrido de demostración", points: 3 });
  await demoMutation({ action: "createTask", sprintId: rehearsal.sprintId, title: "Adaptación pendiente del ensayo", points: null });
  let rehearsalData = await fetch(`${internalOrigin}/api/bootstrap`, { headers: { cookie } }).then((result) => result.json());
  await demoMutation({ action: "startSprint", id: rehearsal.sprintId, revision: rehearsalData.sprints.find((item) => item.id === rehearsal.sprintId).revision });
  await demoMutation({ action: "updateTask", id: rehearsalTask.taskId, revision: 0, status: "done" });
  rehearsalData = await fetch(`${internalOrigin}/api/bootstrap`, { headers: { cookie } }).then((result) => result.json());
  await demoMutation({ action: "closeSprint", id: rehearsal.sprintId, revision: rehearsalData.sprints.find((item) => item.id === rehearsal.sprintId).revision, governanceRevision: rehearsalData.workspace.governanceRevision, summary: "Se comprobó el recorrido. Una adaptación sin estimar volvió al backlog sin marcarla como terminada.", reviewed: true });
  await demoMutation({ action: "startSprint", id: demoSprint.id, revision: demoSprint.revision });
  const demoTasks = data.tasks.filter((task) => task.sprintId === demoSprint.id).slice(0, 2);
  for (const [index, task] of demoTasks.entries()) await demoMutation({ action: "updateTask", id: task.id, revision: task.revision, status: index === 0 ? "done" : "progress", ...(index === 0 ? { points: 5 } : {}) });
  if (demoTasks[1]) {
    await demoMutation({ action: "changeImpediment", id: demoTasks[1].id, revision: demoTasks[1].revision + 1, operation: "report", reason: "Falta acceso al entorno de pruebas del laboratorio", ownerId: user.id });
    await demoMutation({ action: "addTaskComment", id: demoTasks[1].id, text: "Solicitamos el acceso. Hoy revisaremos una alternativa para continuar con el objetivo." });
  }
  const demoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await demoMutation({ action: "saveDailyNote", sprintId: demoSprint.id, date: demoDay, revision: 0, text: "Comprobar el acceso al laboratorio y preparar una alternativa con el equipo." });
  await demoMutation({ action: "updateScrumConfiguration", governanceRevision: data.workspace.governanceRevision, productGoal: "Organizar y validar el proyecto universitario con el equipo", definitionOfDone: ["Revisado por un compañero", "Recorrido principal probado", "Evidencia disponible para demostrar"], productOwnerId: null, scrumMasterId: null, developerIds: [] });
  const reviewData = await fetch(`${internalOrigin}/api/bootstrap`, { headers: { cookie } }).then((result) => result.json());
  await demoMutation({ action: "saveSprintReview", sprintId: demoSprint.id, revision: 0, sprintRevision: reviewData.sprints.find((item) => item.id === demoSprint.id).revision, governanceRevision: reviewData.workspace.governanceRevision, summary: "El equipo validó una primera parte del recorrido. La próxima demostración contrastará el flujo con compañeros.", taskIds: demoTasks[0] ? [demoTasks[0].id] : [], evidence: [{ label: "Abrir el tablero de demostración", url: `${origin}/?workspace=${data.workspace.id}&view=board&sprint=${demoSprint.id}` }], verified: true });
  await demoMutation({ action: "addReviewEntry", sprintId: demoSprint.id, kind: "feedback", text: "La demostración ayuda a entender el objetivo. Conviene simplificar el recorrido de nuevas tareas." });
  await demoMutation({ action: "addReviewEntry", sprintId: demoSprint.id, kind: "decision", text: "Probar el flujo de creación de tareas con tres compañeros y recoger sus dudas." });
  await demoMutation({ action: "addRetroObservation", sprintId: demoSprint.id, kind: "keep", text: "Revisar juntos las tareas ayudó a detectar dudas antes de la demostración." });
  await demoMutation({ action: "addRetroObservation", sprintId: demoSprint.id, kind: "problem", text: "El acceso al laboratorio llegó tarde y retrasó la validación del equipo." });
  await demoMutation({ action: "addRetroObservation", sprintId: demoSprint.id, kind: "idea", text: "Preparar una alternativa local para no depender de un único entorno." });
  const demoRetro = await fetch(`${internalOrigin}/api/retro?workspace=${data.workspace.id}&sprint=${demoSprint.id}`, { headers: { cookie } }).then((result) => result.json());
  const demoProblem = demoRetro.observations.find((row) => row.kind === "problem");
  await demoMutation({ action: "selectRetroProblem", sprintId: demoSprint.id, id: demoProblem.id, revision: demoProblem.revision, selected: true });
  const demoNext = (await fetch(`${internalOrigin}/api/bootstrap`, { headers: { cookie } }).then((result) => result.json())).sprints.find((item) => item.status === "planned");
  await demoMutation({ action: "createRetroAction", sprintId: demoSprint.id, observationId: demoProblem.id, observationRevision: demoProblem.revision + 1, title: "Preparar los accesos antes del próximo sprint", measure: "Todos los integrantes pueden acceder al laboratorio el primer día. Registrar el resultado en el seguimiento.", ownerId: user.id, targetSprintId: demoNext?.id ?? null });
  const safeRequest = (req) => req.headers.host === "127.0.0.1:4317" && /^\/(?!\/)/.test(req.url ?? "")
    && (!req.headers.origin || req.headers.origin === origin)
    && (["GET", "HEAD"].includes(req.method ?? "") || (req.headers.origin === origin && req.headers["sec-fetch-site"] !== "cross-site"));
  const headers = (req) => {
    const result = { ...req.headers, host: `127.0.0.1:${internalPort}`, cookie };
    delete result.authorization;
    delete result["x-forwarded-host"]; delete result["x-forwarded-proto"]; delete result["x-forwarded-for"];
    if (result.origin) result.origin = internalOrigin;
    return result;
  };
  proxy = createServer((req, res) => {
    if (!safeRequest(req)) { res.writeHead(403); res.end("Solo vista previa local del mismo origen."); return; }
    if (req.url?.startsWith("/api/auth/")) { res.writeHead(403); res.end("La demostración no usa cuentas reales."); return; }
    const upstream = httpRequest({ hostname: "127.0.0.1", port: internalPort, path: req.url, method: req.method, headers: headers(req) }, (reply) => {
      const outgoing = { ...reply.headers, "cache-control": "no-store" };
      delete outgoing["set-cookie"];
      if (outgoing.location?.startsWith(internalOrigin)) outgoing.location = origin + outgoing.location.slice(internalOrigin.length);
      res.writeHead(reply.statusCode ?? 502, outgoing); reply.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("La vista previa está arrancando. Recarga en unos segundos."); });
    req.pipe(upstream);
  });
  proxy.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  proxy.on("upgrade", (req, socket, head) => {
    const pathname = (req.url ?? "").split("?", 1)[0];
    if (!safeRequest(req) || !["/_next/hmr", "/_next/webpack-hmr"].includes(pathname)) { socket.destroy(); return; }
    const upstream = connect(internalPort, "127.0.0.1", () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers(req)).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy()); socket.on("close", () => upstream.destroy());
  });
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(4317, "127.0.0.1", resolve); });
  console.log(`Vista previa local: ${origin}/?workspace=${data.workspace.id}&view=reports&sprint=${demoSprint.id}`);
  console.log("Datos de demostración temporales. Sin Google, IA externa ni acceso a producción. Ctrl+C cierra la vista previa y elimina su base temporal.");
} catch (error) {
  console.error(error instanceof Error && error.code === "EADDRINUSE" ? "El puerto 4317 ya está ocupado; no se ha cerrado ningún proceso ajeno." : "No se pudo preparar la vista previa aislada.");
  await stop(1);
}
