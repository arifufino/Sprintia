import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Sprintia sign-in experience for an anonymous visitor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Sprintia/);
  assert.match(html, /Tu equipo, un sprint a la vez/);
  assert.match(html, /Continuar con ChatGPT/);
  assert.match(html, /Tablero colaborativo/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("preserves an invitation code through the sign-in return path", async () => {
  const response = await render("/?join=ABC1234");
  const html = await response.text();
  assert.match(html, /ABC1234/);
  assert.match(html, /signin-with-chatgpt/);
});
