import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import type { Asset } from "@/lib/types";
import { rightsSchema } from "@/lib/validation/schemas";
import { identifyMedia, parseRange } from "@/lib/validation/media";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataMode, mediaPath, uploadLimit } from "./config";
import { AppError } from "./errors";
import { requireApiOwner } from "./auth";
import { assertSameOrigin, readJson } from "./security";
import { getAsset, getAssets, getEntries, getSettings, getLocalState, removeAssetRecord, saveAsset, saveLocalAsset } from "./store";
import { assetReferences, validateReferences } from "./references";
import { getDatabase, transaction } from "./db";

const bucket = "private-media";
export async function uploadAsset(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); const settings = await getSettings(owner.id);
  const maximum = Math.max(uploadLimit("image", settings.imageLimitMb), uploadLimit("audio", settings.audioLimitMb), uploadLimit("video", settings.videoLimitMb));
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new AppError(415, "上传必须使用 multipart/form-data");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximum + 64 * 1024) throw new AppError(413, "上传内容超过服务端大小限制");
  if (!request.body) throw new AppError(400, "上传内容为空");
  let total = 0;
  const counted = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({transform(chunk, controller) {total += chunk.byteLength; if (total > maximum + 64 * 1024) throw new AppError(413, "上传内容超过服务端大小限制"); controller.enqueue(chunk);}}));
  const inputRequest = new Request(request.url, {method: "POST", headers: request.headers, body: counted, duplex: "half"} as RequestInit & {duplex: "half"});
  let form: FormData; try {form = await inputRequest.formData();} catch (error) {if (error instanceof AppError) throw error; throw new AppError(total > maximum + 64 * 1024 ? 413 : 400, "上传中断或文件格式不正确");}
  const file = form.get("file"); if (!(file instanceof File) || file.size === 0) throw new AppError(400, "请选择非空的媒体文件");
  const rawScopes = form.get("allowedUseScope"); let allowedUseScope: unknown;
  try {allowedUseScope = typeof rawScopes === "string" && rawScopes.trim() ? JSON.parse(rawScopes) : undefined;} catch {throw new AppError(400, "使用范围格式不正确");}
  const optional = (key: string) => {const value = form.get(key); return typeof value === "string" && value.trim() ? value : undefined;};
  const rights = rightsSchema.parse({sourceUrl: optional("sourceUrl"), rightsHolder: optional("rightsHolder"), rightsStatus: optional("rightsStatus"), licenseType: optional("licenseType"), licenseNotes: optional("licenseNotes"), attribution: optional("attribution"), allowedUseScope});
  const signature = Buffer.from(await file.slice(0, 4096).arrayBuffer()); const descriptor = identifyMedia(file.name, file.type, signature);
  if (!descriptor) throw new AppError(415, "文件扩展名、MIME 类型或实际内容不匹配；不支持 SVG、脚本与可执行文件", "UNSUPPORTED_MEDIA");
  const limit = uploadLimit(descriptor.mediaType, settings[`${descriptor.mediaType}LimitMb`]);
  if (file.size > limit) throw new AppError(413, `文件过大，此类媒体当前上限为 ${Math.floor(limit / 1024 / 1024)} MB`, "MEDIA_TOO_LARGE");
  const id = randomUUID(); const storagePath = `${owner.id}/${id}.${descriptor.extension}`;
  const filename = path.basename(file.name.replaceAll("\\", "/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || `media.${descriptor.extension}`;
  // These defaults describe private app behavior, not authorship or a licence grant.
  // Keep them here, rather than in the shared schema, so PATCH and backups retain
  // existing metadata without filling in claims the owner never supplied.
  const privateScopes = descriptor.mediaType === "image" ? ["private_storage"] : ["private_storage", "private_playback"];
  const asset: Asset = {id, ownerId: owner.id, filename, mimeType: descriptor.mimeType, mediaType: descriptor.mediaType, size: file.size, storagePath, ...rights, rightsStatus: rights.rightsStatus ?? "personal_only", allowedUseScope: [...new Set([...(rights.allowedUseScope || []), ...privateScopes])], createdAt: new Date().toISOString()};
  if (dataMode() === "local") {
    const destination = mediaPath(storagePath); await fsp.mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
    try {await fsp.writeFile(destination, Buffer.from(await file.arrayBuffer()), {flag: "wx", mode: 0o600}); if (request.signal.aborted) throw new AppError(499, "上传已取消"); await saveAsset(asset);} catch (error) {await fsp.unlink(destination).catch(() => {}); throw error;}
  } else {
    const client = await createSupabaseServerClient(); const {error} = await client.storage.from(bucket).upload(storagePath, file, {contentType: descriptor.mimeType, upsert: false});
    if (error) throw new AppError(502, "云端上传失败，请核实 Storage 容量、策略和套餐限制");
    try {if (request.signal.aborted) throw new AppError(499, "上传已取消"); await saveAsset(asset);} catch (error) {await client.storage.from(bucket).remove([storagePath]); throw error;}
  }
  return {asset};
}
export async function updateAsset(request: Request, id: string) {
  assertSameOrigin(request); const owner = await requireApiOwner(); z.uuid().parse(id);
  const patch = rightsSchema.partial().parse(await readJson(request)); const existing = await getAsset(owner.id, id);
  const rights = rightsSchema.parse({sourceUrl: existing.sourceUrl, rightsHolder: existing.rightsHolder, rightsStatus: existing.rightsStatus, licenseType: existing.licenseType, licenseNotes: existing.licenseNotes, attribution: existing.attribution, allowedUseScope: existing.allowedUseScope, ...patch});
  const asset: Asset = {...existing, ...rights, rightsStatus: rights.rightsStatus ?? existing.rightsStatus, allowedUseScope: rights.allowedUseScope ?? existing.allowedUseScope}; const [entries, currentAssets] = await Promise.all([getEntries(owner.id), getAssets(owner.id)]);
  const assets = currentAssets.map(a => a.id === id ? asset : a); for (const entry of entries) validateReferences(entry, entries, assets);
  if (dataMode() === "local") transaction(() => {const state = getLocalState(owner.id); if (!state.assets.some(a => a.id === id)) throw new AppError(404, "媒体不存在"); const nextAssets = state.assets.map(a => a.id === id ? asset : a); for (const entry of state.entries) validateReferences(entry, state.entries, nextAssets); saveLocalAsset(asset);}); else {
    const client = await createSupabaseServerClient(); const {error} = await client.from("media_assets").update({source_url: asset.sourceUrl || null, rights_holder: asset.rightsHolder || null, rights_status: asset.rightsStatus, license_type: asset.licenseType || null, license_notes: asset.licenseNotes || null, attribution: asset.attribution || null, allowed_use_scope: asset.allowedUseScope}).eq("id", id).eq("owner_id", owner.id);
    if (error) throw new AppError(500, "媒体信息更新失败");
  }
  return {asset};
}
export async function deleteAsset(request: Request, id: string) {
  assertSameOrigin(request); const owner = await requireApiOwner(); z.uuid().parse(id); const asset = await getAsset(owner.id, id);
  const [entries, settings] = await Promise.all([getEntries(owner.id), getSettings(owner.id)]);
  if (entries.some(e => assetReferences(e).includes(id)) || settings.heroAssetId === id || settings.mobileHeroAssetId === id) throw new AppError(409, "媒体仍被内容或首页主视觉引用，请先解除关联", "ASSET_IN_USE");
  if (dataMode() === "local") {
    const destination = mediaPath(asset.storagePath); const temporary = `${destination}.deleting-${randomUUID()}`;
    let moved = false; try {await fsp.rename(destination, temporary); moved = true;} catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;}
    try {transaction(() => {const state = getLocalState(owner.id); if (state.entries.some(e => assetReferences(e).includes(id)) || state.settings.heroAssetId === id || state.settings.mobileHeroAssetId === id) throw new AppError(409, "媒体刚被其他内容引用，请先解除关联", "ASSET_IN_USE"); getDatabase().prepare("DELETE FROM media_assets WHERE owner_id=? AND id=?").run(owner.id, id);});} catch (error) {if (moved) await fsp.rename(temporary, destination); throw error;}
    if (moved) await fsp.unlink(temporary);
  } else {
    await removeAssetRecord(owner.id, id); const client = await createSupabaseServerClient(); const {error} = await client.storage.from(bucket).remove([asset.storagePath]);
    if (error) throw new AppError(502, "媒体记录已删除，但云端文件清理失败，请在 Storage 控制台移除孤立文件", "MEDIA_CLEANUP_FAILED");
  }
  return {ok: true};
}
export async function assetFileExists(asset: Asset): Promise<boolean> {
  if (dataMode() === "local") {try {const stat = await fsp.stat(mediaPath(asset.storagePath)); return stat.isFile() && stat.size === asset.size;} catch {return false;}}
  const client = await createSupabaseServerClient(); const prefix = asset.storagePath.slice(0, asset.storagePath.lastIndexOf("/")); const name = asset.storagePath.slice(asset.storagePath.lastIndexOf("/") + 1);
  const {data, error} = await client.storage.from(bucket).list(prefix, {search: name, limit: 100}); return !error && Boolean(data?.some(item => item.name === name && Number(item.metadata?.size) === asset.size));
}
export async function serveAsset(request: Request, id: string, head = false) {
  const owner = await requireApiOwner(); z.uuid().parse(id); const asset = await getAsset(owner.id, id);
  const headers = new Headers({"Content-Type": asset.mimeType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Security-Policy": "default-src 'none'; sandbox"});
  const range = parseRange(request.headers.get("range"), asset.size);
  if (range === "invalid") {headers.set("Content-Range", `bytes */${asset.size}`); return new Response(null, {status: 416, headers});}
  const start = range?.start || 0; const end = range?.end ?? asset.size - 1;
  headers.set("Content-Length", String(end - start + 1)); if (range) headers.set("Content-Range", `bytes ${start}-${end}/${asset.size}`);
  if (dataMode() === "local") {
    const destination = mediaPath(asset.storagePath); let stat;
    try {stat = await fsp.stat(destination);} catch {throw new AppError(404, "媒体文件不存在，请从媒体备份恢复文件", "MEDIA_FILE_MISSING");}
    if (!stat.isFile() || stat.size !== asset.size) throw new AppError(409, "媒体文件与记录不一致，请检查存储目录");
    if (head) return new Response(null, {status: range ? 206 : 200, headers});
    const stream = fs.createReadStream(destination, {start, end}); request.signal.addEventListener("abort", () => stream.destroy(), {once: true});
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {status: range ? 206 : 200, headers});
  }
  const client = await createSupabaseServerClient(); const {data, error} = await client.storage.from(bucket).createSignedUrl(asset.storagePath, 60);
  if (error || !data) throw new AppError(404, "云端媒体文件不可读取，请检查 Storage 权限或备份");
  const upstream = await fetch(data.signedUrl, {method: head ? "HEAD" : "GET", headers: range ? {Range: `bytes=${start}-${end}`} : {}, signal: request.signal, cache: "no-store"});
  if (!upstream.ok) throw new AppError(upstream.status === 404 ? 404 : 502, "媒体存储暂时无法读取");
  if (range && upstream.status !== 206) throw new AppError(502, "云端存储没有响应分段读取请求");
  return new Response(head ? null : upstream.body, {status: range ? 206 : 200, headers});
}
