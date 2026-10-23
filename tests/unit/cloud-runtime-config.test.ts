import {afterEach, describe, expect, it, vi} from "vitest";

vi.mock("server-only", () => ({}));

import {dataMode} from "../../lib/server/config";

afterEach(() => vi.unstubAllEnvs());

describe("cloud runtime data mode", () => {
  it("fails closed when Vercel is configured to use local storage", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATA_MODE", "local");

    expect(() => dataMode()).toThrow(expect.objectContaining({status: 503, code: "CLOUD_STORAGE_REQUIRED"}));
  });

  it("accepts Supabase as the Vercel data mode", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATA_MODE", "supabase");

    expect(dataMode()).toBe("supabase");
  });
});
