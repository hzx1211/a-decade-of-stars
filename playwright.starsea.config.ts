import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import {defineConfig, devices} from "@playwright/test";

const root = process.cwd();
const origin = "http://127.0.0.1:3006";
const testDataDirectory = path.resolve(root, ".test-data", `starsea-${process.pid}-${randomUUID()}`);
const testRoot = path.resolve(root, ".test-data");
const relativeDirectory = path.relative(testRoot, testDataDirectory);
if (!relativeDirectory.startsWith("starsea-") || path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) {
  throw new Error("Starsea browser checks require a fresh isolated .test-data directory");
}

// These credentials are scoped to the isolated Playwright owner and are never printed.
process.env.STARS_STARSEA_DATA_DIR = testDataDirectory;
process.env.STARS_STARSEA_OWNER_EMAIL = `starsea-test-${randomUUID()}@example.test`;
process.env.STARS_STARSEA_OWNER_PASSWORD = `Starsea-test-${randomUUID()}-Aa9!`;
process.env.STARS_DATA_DIR = testDataDirectory;

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "starsea-background.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 75_000,
  expect: {timeout: 15_000},
  reporter: "list",
  outputDir: "./test-results/starsea-background",
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
  projects: [{name: "starsea-background", use: {...devices["Desktop Chrome"]}}],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3006",
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
