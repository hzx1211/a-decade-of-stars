import "server-only";
import { AppError } from "./errors";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
function invalidOrigin(): never {
  throw new AppError(403, "请求来源不受信任，请从本站发起操作", "INVALID_ORIGIN");
}
function localHostUrl(host: string, protocol: string): URL {
  // Accept only a loopback authority, never a URL, userinfo, list, or forwarded host.
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) invalidOrigin();
  try {return new URL(`${protocol}//${host}`);} catch {return invalidOrigin();}
}
function expectedOrigin(request: Request): string {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (loopbackHosts.has(url.hostname) && host !== null) {
    // Next may reconstruct the URL as localhost even when the browser uses 127.0.0.1.
    // Use the incoming loopback Host, while keeping the listening port and scheme exact.
    const local = localHostUrl(host, url.protocol);
    if (local.port !== url.port) invalidOrigin();
    return local.origin;
  }
  return url.origin;
}
export function assertSameOrigin(request: Request) {
  const actual = request.headers.get("origin");
  if (!actual || actual !== expectedOrigin(request)) invalidOrigin();
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError(403, "不允许跨站请求", "INVALID_ORIGIN");
}
export function assertLoopback(request: Request) {
  const hostname = new URL(request.url).hostname;
  const originHost = new URL(request.headers.get("origin") || "https://invalid.example").hostname;
  if (!loopbackHosts.has(hostname) || !loopbackHosts.has(originHost)) throw new AppError(403, "首次创建所有者账号只能在本机进行", "LOCAL_SETUP_ONLY");
  const host = request.headers.get("host");
  if (host !== null) localHostUrl(host, new URL(request.url).protocol);
  const forwarded = request.headers.get("x-forwarded-for");
  if (request.headers.get("forwarded") || (forwarded && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(forwarded))) throw new AppError(403, "首次创建账号不能通过外部代理进行", "LOCAL_SETUP_ONLY");
}
export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new AppError(413, "请求内容超过大小限制");
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AppError(415, "请求必须使用 JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "请求内容为空");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) {await reader.cancel(); throw new AppError(413, "请求内容超过大小限制");} chunks.push(value);}
  try {return JSON.parse(Buffer.concat(chunks).toString("utf8"));} catch {throw new AppError(400, "JSON 格式不正确");}
}
type Attempts = {count: number; resetAt: number};
const attempts = new Map<string, Attempts>();
export function clearAuthAttempts(key: string) {attempts.delete(key);}
export function rateLimitAuth(key: string) {
  const now = Date.now();
  if (attempts.size > 1000) for (const [id, value] of attempts) if (value.resetAt < now) attempts.delete(id);
  const existing = attempts.get(key);
  const current = existing && existing.resetAt > now ? existing : {count: 0, resetAt: now + 15 * 60_000};
  current.count++; attempts.set(key, current);
  if (current.count > 10) throw new AppError(429, "尝试次数过多，请 15 分钟后重试", "TOO_MANY_ATTEMPTS");
}
