import {randomUUID} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, statSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const root = process.cwd();
const dataDirectory = path.resolve(root, ".test-data", `archive-design-${process.pid}-${randomUUID()}`);
const testRoot = path.resolve(root, ".test-data");
const relativeDirectory = path.relative(testRoot, dataDirectory);
if (!relativeDirectory.startsWith("archive-design-") || path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) {
  throw new Error("Archive design browser checks must use an isolated .test-data directory");
}

const sourceMediaDirectory = path.resolve(root, ".data", "theme-media");
const isolatedMediaDirectory = path.join(dataDirectory, "theme-media");
for (const fileName of ["stage.jpg", "beidou.jpg", "v-reference.png"]) {
  const source = path.join(sourceMediaDirectory, fileName);
  if (existsSync(source) && statSync(source).isFile()) {
    mkdirSync(isolatedMediaDirectory, {recursive: true});
    copyFileSync(source, path.join(isolatedMediaDirectory, fileName));
  }
}

process.env.STARS_ARCHIVE_DATA_DIR = dataDirectory;
process.env.STARS_ARCHIVE_OWNER_EMAIL = `archive-test-${randomUUID()}@example.test`;
process.env.STARS_ARCHIVE_OWNER_PASSWORD = `Archive-test-${randomUUID()}-Aa9!`;
process.env.STARS_DATA_DIR = dataDirectory;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "archive-design.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/archive-design",
  use: {
    baseURL: "http://127.0.0.1:3004",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined),
    },
  },
  projects: [{name: "archive-design", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3004",
    url: "http://127.0.0.1:3004/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      DATA_MODE: "local",
      STARS_NEXT_DIST_DIR: ".next-test-archive",
      STARS_DATA_DIR: dataDirectory,
      APP_ORIGIN: "",
    },
  },
});
