import "server-only";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {dataDirectory, dataMode} from "./config";
import {AppError} from "./errors";
import {requireApiOwner} from "./auth";
import {createSupabaseServerClient} from "@/lib/supabase/server";

const themeFiles = {
  stage: {filename: "stage.jpg", contentType: "image/jpeg"},
  beidou: {filename: "beidou.jpg", contentType: "image/jpeg"},
  "v-reference": {filename: "v-reference.png", contentType: "image/png"},
} as const;
export type ThemeMediaKind = keyof typeof themeFiles;
export type PrivateImageMedia = {bytes: Buffer; contentType: string} | {stream: ReadableStream<Uint8Array>; size: number; contentType: string};
const maximumThemeBytes = 12 * 1024 * 1024;
const safeCloudPath = /^(?:theme-media\/(?:stage\.jpg|beidou\.jpg|v-reference\.png)|starsea-v2\/(?:manifest\.json|[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(?:webp|png|jpe?g)))$/;

function storageFileMissing(error: {message: string; status?: number; statusCode?: string | number}) {
  return Number(error.statusCode ?? error.status) === 404 || /^(?:Object not found|The resource was not found|Not found)$/i.test(error.message);
}

// Both directories live in a private bucket and only expose fixed theme names
// or manifest-approved frame names. Never fall back to filesystem data in cloud mode.
export async function readCloudThemeFile(relativePath: string, maximumBytes: number) {
  if (!safeCloudPath.test(relativePath)) throw new AppError(404, "主题文件不存在");
  const owner = await requireApiOwner(); const client = await createSupabaseServerClient();
  const storage = client.storage.from("private-theme"); const storagePath = `${owner.id}/${relativePath}`;
  const {data: info, error} = await storage.info(storagePath);
  if (error) {if (storageFileMissing(error)) return null; throw new AppError(502, "主题存储暂时无法读取");}
  if (!info) return null;
  const size = Number(info.size ?? info.metadata?.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumBytes) return null;
  const contentType = String(info.contentType ?? info.metadata?.mimetype ?? "").toLowerCase().split(";")[0].trim();
  const {data: signed, error: signError} = await storage.createSignedUrl(storagePath, 60);
  if (signError || !signed) throw new AppError(502, "主题存储暂时无法读取");
  const response = await fetch(signed.signedUrl, {cache: "no-store"});
  if (!response.ok || !response.body) {await response.body?.cancel(); if (response.status === 404) return null; throw new AppError(502, "主题存储暂时无法读取");}
  let received = 0;
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {received += chunk.byteLength; if (received > size || received > maximumBytes) throw new AppError(502, "主题文件大小与记录不一致"); controller.enqueue(chunk);},
    flush() {if (received !== size) throw new AppError(502, "主题文件读取不完整");},
  }));
  return {stream, size, contentType};
}

export async function readPrivateThemeBytes(media: {stream: ReadableStream<Uint8Array>}, maximum: number) {
  const reader = media.stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {for (;;) {const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) throw new AppError(502, "主题文件超过大小限制"); chunks.push(value);}}
  finally {await reader.cancel().catch(() => {});}
  return Buffer.concat(chunks);
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function themeFilePath(kind: ThemeMediaKind) {
  return path.join(dataDirectory(), "theme-media", themeFiles[kind].filename);
}
export async function readThemeMedia(kind: string): Promise<PrivateImageMedia | null> {
  if (!Object.hasOwn(themeFiles, kind)) throw new AppError(404, "主题图片不存在");
  const knownKind = kind as ThemeMediaKind;
  if (dataMode() === "supabase") {
    const media = await readCloudThemeFile(`theme-media/${themeFiles[knownKind].filename}`, maximumThemeBytes);
    if (!media) return null;
    if (media.contentType !== themeFiles[knownKind].contentType) {await media.stream.cancel(); return null;}
    return media;
  }
  try {
    return {bytes: await readFile(themeFilePath(knownKind)), contentType: themeFiles[knownKind].contentType};
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
export async function hasThemeMedia(kind: ThemeMediaKind = "stage") {
  if (dataMode() === "supabase") {
    const media = await readThemeMedia(kind);
    if (media && "stream" in media) await media.stream.cancel();
    return Boolean(media);
  }
  try {return (await stat(themeFilePath(kind))).isFile();}
  catch (error) {if (isMissing(error)) return false; throw error;}
}

export function privateImageResponse(media: PrivateImageMedia, head = false) {
  if (head && "stream" in media) void media.stream.cancel().catch(() => {});
  return new Response(head ? null : "stream" in media ? media.stream : new Uint8Array(media.bytes), {headers: {
    "Content-Type": media.contentType,
    "Content-Length": String("stream" in media ? media.size : media.bytes.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  }});
}
