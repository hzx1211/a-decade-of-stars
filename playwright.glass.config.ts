import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const root = process.cwd();
const origin = "http://127.0.0.1:3007";
const testDataDirectory = path.resolve(root, ".test-data", `glass-${process.pid}-${randomUUID()}`);
const testRoot = path.resolve(root, ".test-data");
const relativeDirectory = path.relative(testRoot, testDataDirectory);
if (!relativeDirectory.startsWith("glass-") || path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) {
  throw new Error("Liquid-glass browser checks require a fresh isolated .test-data directory");
}

process.env.STARS_GLASS_DATA_DIR = testDataDirectory;
process.env.STARS_GLASS_OWNER_EMAIL = `glass-test-${randomUUID()}@example.test`;
process.env.STARS_GLASS_OWNER_PASSWORD = `Glass-test-${randomUUID()}-Aa9!`;
process.env.STARS_DATA_DIR = testDataDirectory;

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "liquid-glass.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/liquid-glass-refraction",
  use: {
    baseURL: origin,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined),
    },
  },
  projects: [{name: "liquid-glass", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3007",
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      DATA_MODE: "local",
      STARS_NEXT_DIST_DIR: ".next-test-starsea",
      STARS_DATA_DIR: testDataDirectory,
      APP_ORIGIN: "",
    },
  },
});
