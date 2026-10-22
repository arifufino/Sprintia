import { rm } from "node:fs/promises";

export default async function teardown() {
  // Windows may terminate the server tree without running its signal handlers.
  // Remove only the generated local credentials file, never any project data.
  await rm(new URL("../../.test-runtime.json", import.meta.url), { force: true });
}
