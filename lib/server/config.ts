import "server-only";
import path from "node:path";
import { AppError } from "./errors";

export function dataMode(): "local" | "supabase" {
  const mode = process.env.DATA_MODE || "local";
  if (mode !== "local" && mode !== "supabase") throw new AppError(503, "DATA_MODE 配置无效");
  return mode;
}
// Persistent private data is a runtime volume. It must never enter the deployment file trace.
export function dataDirectory() { return path.resolve(/* turbopackIgnore: true */ process.env.STARS_DATA_DIR || path.join(process.cwd(), ".data")); }
export function mediaDirectory() { return path.join(dataDirectory(), "media"); }
export function mediaPath(storagePath: string) {
  const root = mediaDirectory();
  const resolved = path.resolve(/* turbopackIgnore: true */ root, storagePath);
  if (!resolved.startsWith(root + path.sep) || storagePath.includes("\\") || storagePath.includes("..")) throw new AppError(400, "无效的媒体路径");
  return resolved;
}
export function uploadLimit(type: "image" | "audio" | "video", configured: number) {
  const defaults = {image: 10, audio: 50, video: 100};
  const value = Number(process.env[`UPLOAD_${type.toUpperCase()}_LIMIT_MB`] || defaults[type]);
  if (!Number.isFinite(value) || value <= 0 || value > 2048) throw new AppError(503, "服务端上传限制配置无效");
  return Math.min(value, configured) * 1024 * 1024;
}
