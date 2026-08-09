import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("uses the production Vercel stack", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.dependencies.next, "16.3.0");
  assert.equal(packageJson.dependencies["next-auth"], "5.0.0-beta.32");
  assert.equal(packageJson.dependencies.mongodb, "6.21.0");
  assert.equal(packageJson.dependencies["drizzle-orm"], undefined);
  assert.equal(packageJson.devDependencies.vinext, undefined);
});

test("documents every private runtime variable without values", async () => {
  const envExample = await read(".env.example");
  for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "MONGODB_URI", "MONGODB_DB"]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
  }
  assert.doesNotMatch(envExample, /mongodb(?:\+srv)?:\/\/[^\s]*@/i);
});

test("includes Google access and local appearance preferences", async () => {
  const [signIn, app, layout] = await Promise.all([
    read("app/SignInPage.tsx"),
    read("app/SprintiaApp.tsx"),
    read("app/layout.tsx"),
  ]);
  assert.match(signIn, /Continuar con Google/);
  assert.match(app, /Configuración/);
  assert.match(app, /Tamaño de texto/);
  assert.match(app, /sprintia-theme/);
  assert.match(layout, /sprintia-text-size/);
});

test("keeps authorization checks on every shared mutation", async () => {
  const runtime = await read("db/runtime.ts");
  assert.match(runtime, /isMember\(workspaceId, user\.id\)/);
  assert.match(runtime, /\{ _id: id, workspaceId \}/);
});

test("validates mutation boundaries and keeps internal failures private", async () => {
  const [route, runtime, errors] = await Promise.all([
    read("app/api/mutate/route.ts"),
    read("db/runtime.ts"),
    read("lib/errors.ts"),
  ]);
  assert.match(route, /MAX_MUTATION_BYTES/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /contentType !== "application\/json"/);
  assert.match(route, /userFacingMessage/);
  assert.match(runtime, /UserFacingError/);
  assert.match(runtime, /\^\[A-Z0-9\]\{8,20\}\$/);
  assert.match(runtime, /parsed\.toISOString\(\)\.slice\(0, 10\) !== date/);
  assert.match(errors, /error instanceof UserFacingError \? error\.message : fallback/);
});

test("ships browser security headers and ignores local secrets", async () => {
  const [config, gitignore] = await Promise.all([
    read("next.config.ts"),
    read(".gitignore"),
  ]);
  for (const header of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "Cross-Origin-Opener-Policy",
    "X-Content-Type-Options",
    "Permissions-Policy",
  ]) {
    assert.match(config, new RegExp(header));
  }
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(gitignore, /^\.vercel$/m);
});
