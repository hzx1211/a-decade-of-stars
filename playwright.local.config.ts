import {randomUUID} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, statSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const projectRoot = process.cwd();
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);
const testDataDirectory = process.env.STARS_LOCAL_ORIGIN_DATA_DIR || path.resolve(projectRoot, ".test-data", `local-origin-${process.pid}-${randomUUID()}`);
const themeMediaFiles = ["stage.jpg", "beidou.jpg", "v-reference.png"] as const;
const sourceThemeMediaDirectory = path.resolve(projectRoot, ".data", "theme-media");
const testThemeMediaDirectory = path.join(testDataDirectory, "theme-media");

// The production-origin browser test gets only the owner's served theme images,
// when present. Original PNG backups and all SQLite data stay out of .test-data.
for (const fileName of themeMediaFiles) {
  const sourcePath = path.join(sourceThemeMediaDirectory, fileName);
  if (existsSync(sourcePath) && statSync(sourcePath).isFile()) {
    mkdirSync(testThemeMediaDirectory, {recursive: true});
    copyFileSync(sourcePath, path.join(testThemeMediaDirectory, fileName));
  }
}

// Keep the test worker and its production server on the same unique, ignored local database.
process.env.STARS_LOCAL_ORIGIN_DATA_DIR = testDataDirectory;
process.env.STARS_DATA_DIR = testDataDirectory;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "local-origin.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/local-origin",
  use: {
    baseURL: "http://127.0.0.1:3002",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {executablePath},
  },
  projects: [{name: "local-origin", use: {...devices["Desktop Chrome"]}}],
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
