import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const origin = "http://127.0.0.1:3012";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);
const dataDirectory = path.resolve(".test-data", `photos-${process.pid}-${randomUUID()}`);
process.env.STARS_PHOTOS_E2E_DATA_DIR = dataDirectory;
if (!process.env.TEST_WORKER_INDEX) console.info(`[photos-e2e] isolated local data: ${dataDirectory}`);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "photos.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/photos",
  use: {
    baseURL: origin,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {executablePath},
  },
  projects: [{name: "photos-chrome", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3012",
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      DATA_MODE: "local",
      STARS_DATA_DIR: dataDirectory,
      STARS_NEXT_DIST_DIR: ".next",
      APP_ORIGIN: origin,
    },
  },
});
