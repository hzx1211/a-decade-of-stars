import {randomUUID} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, statSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const root = process.cwd();
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);
const dataDirectory = path.resolve(root, ".test-data", `fan-portrait-${process.pid}-${randomUUID()}`);
const sourceMediaDirectory = path.resolve(root, ".data", "theme-media");
const isolatedMediaDirectory = path.join(dataDirectory, "theme-media");
const mediaFiles = ["stage.jpg", "beidou.jpg", "v-reference.png"] as const;

// The test owner sees copies of the supplied reference media in its own isolated store.
for (const fileName of mediaFiles) {
  const source = path.join(sourceMediaDirectory, fileName);
  if (existsSync(source) && statSync(source).isFile()) {
    mkdirSync(isolatedMediaDirectory, {recursive: true});
    copyFileSync(source, path.join(isolatedMediaDirectory, fileName));
  }
}

// These values exist only for this Playwright process and its one fictional owner.
process.env.STARS_FAN_DATA_DIR = dataDirectory;
process.env.STARS_FAN_OWNER_EMAIL = `fan-test-${randomUUID()}@example.test`;
process.env.STARS_FAN_OWNER_PASSWORD = `Fan-test-${randomUUID()}-Aa9!`;
process.env.STARS_DATA_DIR = dataDirectory;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "fan-portrait.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/fan-portrait",
  use: {
    baseURL: "http://127.0.0.1:3003",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {executablePath},
  },
  projects: [{name: "fan-portrait", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3003",
    url: "http://127.0.0.1:3003/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      DATA_MODE: "local",
      STARS_NEXT_DIST_DIR: ".next-test-fan",
      STARS_DATA_DIR: dataDirectory,
      APP_ORIGIN: "",
    },
  },
});
