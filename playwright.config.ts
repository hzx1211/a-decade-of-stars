import {defineConfig, devices} from "@playwright/test";
import {existsSync} from "node:fs";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);
const testDataDirectory = process.env.STARS_E2E_DATA_DIR || path.resolve(".test-data", `playwright-${Date.now()}`);
process.env.STARS_E2E_DATA_DIR = testDataDirectory;

export default defineConfig({
  testDir: "./tests/e2e", testIgnore: /(?:local-origin|frontend-motion|lyrics|netease|photos)\.spec\.ts/, fullyParallel: false, workers: 1, retries: 0,
  timeout: 45_000, expect: {timeout: 10_000},
  reporter: [["list"], ["html", {open: "never"}]],
  use: {baseURL: "http://127.0.0.1:3001", actionTimeout:15_000, navigationTimeout:30_000, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: {executablePath}},
  projects: [
    {name: "desktop", use: {...devices["Desktop Chrome"]}},
    {name: "mobile", testMatch: /workspace\.spec\.ts/, use: {...devices["Pixel 7"]}},
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3001",
    url: "http://127.0.0.1:3001/login", reuseExistingServer: false, timeout: 180_000,
    env: {DATA_MODE: "local", STARS_DATA_DIR: testDataDirectory, STARS_NEXT_DIST_DIR: ".next-test", APP_ORIGIN: "http://127.0.0.1:3001"},
  },
});
