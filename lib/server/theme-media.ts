import "server-only";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {dataDirectory} from "./config";
import {AppError} from "./errors";

const themeFiles = {
  stage: {filename: "stage.jpg", contentType: "image/jpeg"},
  beidou: {filename: "beidou.jpg", contentType: "image/jpeg"},
  "v-reference": {filename: "v-reference.png", contentType: "image/png"},
} as const;
export type ThemeMediaKind = keyof typeof themeFiles;

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function themeFilePath(kind: ThemeMediaKind) {
  return path.join(dataDirectory(), "theme-media", themeFiles[kind].filename);
}
export async function readThemeMedia(kind: string) {
  if (!Object.hasOwn(themeFiles, kind)) throw new AppError(404, "主题图片不存在");
  const knownKind = kind as ThemeMediaKind;
  try {
    return {bytes: await readFile(themeFilePath(knownKind)), contentType: themeFiles[knownKind].contentType};
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
export async function hasThemeMedia(kind: ThemeMediaKind = "stage") {
  try {return (await stat(themeFilePath(kind))).isFile();}
  catch (error) {if (isMissing(error)) return false; throw error;}
}

export function privateImageResponse(media: {bytes: Buffer; contentType: string}, head = false) {
  return new Response(head ? null : new Uint8Array(media.bytes), {headers: {
    "Content-Type": media.contentType,
    "Content-Length": String(media.bytes.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  }});
}
