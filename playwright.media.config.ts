import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const origin = "http://127.0.0.1:3005";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);
const dataDirectory = path.resolve(".test-data", `media-library-${process.pid}-${randomUUID()}`);
process.env.STARS_MEDIA_E2E_DATA_DIR = dataDirectory;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "media-library.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/media-library",
  use: {
    baseURL: origin,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {executablePath},
  },
  projects: [{name: "media-library", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3005",
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      DATA_MODE: "local",
      STARS_DATA_DIR: dataDirectory,
      STARS_NEXT_DIST_DIR: ".next-test-media",
      APP_ORIGIN: origin,
    },
  },
});
