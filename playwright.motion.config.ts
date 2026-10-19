import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);
const testDataDirectory = process.env.STARS_MOTION_DATA_DIR || path.resolve(".test-data", `frontend-motion-${process.pid}-${randomUUID()}`);
process.env.STARS_MOTION_DATA_DIR = testDataDirectory;
process.env.STARS_DATA_DIR = testDataDirectory;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "frontend-motion.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/frontend-motion",
  use: {
    baseURL: "http://127.0.0.1:3002",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {executablePath},
  },
  projects: [{name: "frontend-motion", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3002",
    url: "http://127.0.0.1:3002/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      DATA_MODE: "local",
      STARS_NEXT_DIST_DIR: ".next",
      STARS_DATA_DIR: testDataDirectory,
      APP_ORIGIN: "",
    },
  },
});
