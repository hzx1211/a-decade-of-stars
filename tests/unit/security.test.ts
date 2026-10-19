import {afterEach, describe, expect, it, vi} from "vitest";

vi.mock("server-only", () => ({}));
import {assertLoopback, assertSameOrigin} from "../../lib/server/security";

afterEach(() => vi.unstubAllEnvs());

function localRequest(headers: Record<string, string> = {}, url = "http://localhost:3000/api/auth/setup") {
  return new Request(url, {method: "POST", headers: {Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000", ...headers}});
}

describe("browser origin and local setup boundaries", () => {
  it("accepts the exact local browser Host despite Next's reconstructed localhost URL", () => {
    vi.stubEnv("APP_ORIGIN", "");
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      const request = localRequest({Host: host, Origin: `http://${host}`});
      expect(() => assertSameOrigin(request)).not.toThrow();
      expect(() => assertLoopback(request)).not.toThrow();
    }
  });

  it("rejects missing/null origins, alias mismatch, different ports and schemes, and cross-site requests", () => {
    vi.stubEnv("APP_ORIGIN", "");
    for (const origin of ["", "null", "http://localhost:3000", "http://127.0.0.1:3001", "https://127.0.0.1:3000", "https://evil.example"]) {
      expect(() => assertSameOrigin(localRequest({Origin: origin}))).toThrow(expect.objectContaining({status: 403, code: "INVALID_ORIGIN"}));
    }
    const missing = localRequest(); missing.headers.delete("origin");
    expect(() => assertSameOrigin(missing)).toThrow(expect.objectContaining({status: 403}));
    expect(() => assertSameOrigin(localRequest({"Sec-Fetch-Site": "cross-site"}))).toThrow(expect.objectContaining({status: 403}));
  });

  it("rejects hostile or malformed Hosts and never derives the origin from forwarded headers", () => {
    vi.stubEnv("APP_ORIGIN", "");
    for (const host of ["evil.example:3000", "127.0.0.1:3001", "localhost.evil.example:3000", "127.0.0.1:65536", "localhost:3000/path", "user@localhost:3000", "localhost:3000,127.0.0.1:3000"]) {
      expect(() => assertSameOrigin(localRequest({Host: host, Origin: "http://localhost:3000"}))).toThrow(expect.objectContaining({status: 403}));
    }
    expect(() => assertSameOrigin(localRequest({Host: "127.0.0.1:3001", Origin: "http://127.0.0.1:3001"}))).toThrow(expect.objectContaining({status: 403}));
    expect(() => assertSameOrigin(localRequest({Origin: "https://evil.example", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "https"}))).toThrow(expect.objectContaining({status: 403}));
  });

  it("keeps configured canonical origins exact for remote or reverse-proxy deployment", () => {
    vi.stubEnv("APP_ORIGIN", "https://archive.example");
    expect(() => assertSameOrigin(localRequest({Origin: "https://archive.example"}))).not.toThrow();
    expect(() => assertSameOrigin(localRequest())).toThrow(expect.objectContaining({status: 403}));
    expect(() => assertSameOrigin(localRequest({Origin: "https://archive.example:444"}))).toThrow(expect.objectContaining({status: 403}));
  });

  it("does not broaden remote request URL trust when no canonical origin is configured", () => {
    vi.stubEnv("APP_ORIGIN", "");
    const url = "https://archive.example/api/auth/login";
    expect(() => assertSameOrigin(localRequest({Host: "archive.example", Origin: "https://archive.example"}, url))).not.toThrow();
    expect(() => assertSameOrigin(localRequest({Host: "evil.example", Origin: "https://evil.example"}, url))).toThrow(expect.objectContaining({status: 403}));
    const synthetic = localRequest({Origin: "http://localhost:3000"}); synthetic.headers.delete("host");
    expect(() => assertSameOrigin(synthetic)).not.toThrow();
  });

  it("keeps first-owner setup local even with a canonical origin configured", () => {
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    const nonlocalHeaders: Record<string, string>[] = [{Host: "evil.example:3000"}, {"X-Forwarded-For": "203.0.113.10"}, {Forwarded: "for=127.0.0.1"}];
    for (const headers of nonlocalHeaders) {
      expect(() => assertLoopback(localRequest(headers))).toThrow(expect.objectContaining({status: 403}));
    }
    expect(() => assertLoopback(localRequest({"X-Forwarded-For": "127.0.0.1"}))).not.toThrow();
    expect(() => assertLoopback(localRequest({Origin: "https://archive.example"}))).toThrow(expect.objectContaining({status: 403}));
  });
});
