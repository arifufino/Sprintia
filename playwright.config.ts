import { defineConfig, devices } from "@playwright/test";

// Intentionally not configurable to a remote URL: these tests write disposable data.
const baseURL = "http://127.0.0.1:4317";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  updateSnapshots: "none",
  // The visual chat refresh has its own references; preserve previous phases.
  snapshotPathTemplate: "{testDir}/__screenshots__/phase-15/{projectName}/{platform}/{arg}{ext}",
  outputDir: "test-results",
  globalTeardown: "./tests/e2e/teardown.ts",
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    locale: "es-EC",
    timezoneId: "America/Guayaquil",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } }],
  webServer: {
    command: `"${process.execPath}" tests/e2e/server.mjs`,
    url: `${baseURL}/api/bootstrap`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
