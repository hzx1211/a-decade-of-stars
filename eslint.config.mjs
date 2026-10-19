import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals, ...nextTs,
  // Private media endpoints require the browser's owner session cookie; the
  // shared image optimizer must not fetch or cache those private bytes.
  { files: ["components/**/*.tsx"], rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([".next*/**", "node_modules/**", "test-results/**", "playwright-report/**", ".data/**", ".test-data/**", ".npm-cache/**", "verification/**", "next-env.d.ts"])
]);
