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
type CloudClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Rights = z.infer<typeof rightsSchema>;
const uploadIntentSchema = z.object({
  filename: z.string().min(1).max(1024), mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  signature: z.string().min(4).max(5500).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  metadata: rightsSchema.optional(),
}).strict();
const intentIdSchema = z.object({intentId: z.uuid()}).strict();
type UploadIntent = {id: string; owner_id: string; filename: string; mime_type: string; size: number; media_type: Asset["mediaType"]; storage_path: string; metadata: Rights; created_at: string; expires_at: string};

function privateRights(mediaType: Asset["mediaType"], rights: Rights) {
  const scopes: Asset["allowedUseScope"] = mediaType === "image" ? ["private_storage"] : ["private_storage", "private_playback"];
  return {...rights, rightsStatus: rights.rightsStatus ?? "personal_only" as const, allowedUseScope: [...new Set([...(rights.allowedUseScope || []), ...scopes])]};
}
function cleanFilename(filename: string) {
  return path.basename(filename.replaceAll("\\", "/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255);
}
export function cloudUploadLimit(mediaType: Asset["mediaType"], configured: number) {
  const cloudMb = Number(process.env.CLOUD_UPLOAD_LIMIT_MB || 50);
  if (!Number.isFinite(cloudMb) || cloudMb <= 0 || cloudMb > 50) throw new AppError(503, "云端上传限制配置无效，请设置不超过 50 MB 的 CLOUD_UPLOAD_LIMIT_MB");
  return Math.min(uploadLimit(mediaType, configured), cloudMb * 1024 * 1024);
}
function assertCloudUploads() {
  if (dataMode() !== "supabase") throw new AppError(400, "当前使用本地媒体上传");
}
async function existingAsset(ownerId: string, id: string) {
  try {return await getAsset(ownerId, id);} catch (error) {if (error instanceof AppError && error.status === 404) return null; throw error;}
}
async function removeUploadIntent(client: CloudClient, ownerId: string, id: string) {
  const {error} = await client.from("media_upload_intents").delete().eq("owner_id", ownerId).eq("id", id);
  if (error) throw new AppError(502, "上传状态清理失败，请重试", "UPLOAD_CLEANUP_FAILED");
}
async function getUploadIntent(client: CloudClient, ownerId: string, id: string): Promise<UploadIntent> {
  const {data, error} = await client.from("media_upload_intents").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw new AppError(502, "无法读取上传状态，请重试");
  if (!data) throw new AppError(404, "上传状态不存在，请重新选择文件上传", "UPLOAD_INTENT_MISSING");
  return data as UploadIntent;
}

// Only this small JSON request passes through the hosting function; file bytes go
// directly to Storage. A signed upload cannot overwrite an existing object.
export async function initializeAssetUpload(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); assertCloudUploads();
  const input = uploadIntentSchema.parse(await readJson(request, 24 * 1024));
  const filename = cleanFilename(input.filename);
  const descriptor = identifyMedia(filename, input.mimeType, Buffer.from(input.signature, "base64"));
  if (!descriptor) throw new AppError(415, "文件扩展名、MIME 类型或实际内容不匹配", "UNSUPPORTED_MEDIA");
  const settings = await getSettings(owner.id);
  const maximum = cloudUploadLimit(descriptor.mediaType, settings[`${descriptor.mediaType}LimitMb`]);
  if (input.size > maximum) throw new AppError(413, `文件过大，此类媒体云端当前上限为 ${maximum / 1024 / 1024} MB`, "MEDIA_TOO_LARGE");
  const id = randomUUID(); const storagePath = `${owner.id}/${id}.${descriptor.extension}`;
  const now = new Date(); const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const client = await createSupabaseServerClient();
  const {error} = await client.from("media_upload_intents").insert({id, owner_id: owner.id, filename, mime_type: descriptor.mimeType, size: input.size, media_type: descriptor.mediaType, storage_path: storagePath, metadata: privateRights(descriptor.mediaType, input.metadata || {}), created_at: now.toISOString(), expires_at: expiresAt});
  if (error) throw new AppError(502, "无法创建上传，请检查云端存储配置");
  const signed = await client.storage.from(bucket).createSignedUploadUrl(storagePath, {upsert: false});
  if (signed.error || !signed.data) {await removeUploadIntent(client, owner.id, id); throw new AppError(502, "无法创建上传地址，请检查云端存储权限");}
  return {intentId: id, signedUrl: signed.data.signedUrl, mimeType: descriptor.mimeType, maximumBytes: maximum, expiresAt};
}

// Read a bounded prefix even if an upstream incorrectly ignores Range. Never
// buffer an entire audio/video file in a serverless function for validation.
async function readUploadSignature(response: Response, maximum: number) {
  if (!response.body) throw new AppError(502, "媒体存储返回了空内容");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new AppError(502, "媒体存储没有正确响应文件校验请求");
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(() => {});}
  return Buffer.concat(chunks);
}
export async function completeAssetUpload(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); assertCloudUploads();
  const {intentId} = intentIdSchema.parse(await readJson(request, 1024));
  const alreadySaved = await existingAsset(owner.id, intentId);
  if (alreadySaved) return {asset: alreadySaved};
  const client = await createSupabaseServerClient();
  const intent = await getUploadIntent(client, owner.id, intentId);
  const storage = client.storage.from(bucket);
  let descriptor: ReturnType<typeof identifyMedia>;
  try {
    if (intent.owner_id !== owner.id || intent.id !== intentId || !intent.storage_path.startsWith(`${owner.id}/${intentId}.`)) throw new AppError(409, "上传路径与授权不匹配");
    if (!Number.isFinite(Date.parse(intent.expires_at)) || Date.parse(intent.expires_at) <= Date.now()) throw new AppError(410, "上传已过期，请重新上传", "UPLOAD_EXPIRED");
    const settings = await getSettings(owner.id);
    if (!Number.isSafeInteger(intent.size) || intent.size <= 0 || intent.size > cloudUploadLimit(intent.media_type, settings[`${intent.media_type}LimitMb`])) throw new AppError(413, "文件超过当前云端上传上限", "MEDIA_TOO_LARGE");
    const {data: info, error} = await storage.info(intent.storage_path);
    if (error || !info) throw new AppError(409, "文件尚未完成上传，请重新上传", "UPLOAD_NOT_FOUND");
    const actualSize = Number(info.size ?? info.metadata?.size);
    const actualMime = String(info.contentType ?? info.metadata?.mimetype ?? "").toLowerCase().split(";")[0].trim();
    if (actualSize !== intent.size || actualMime !== intent.mime_type) throw new AppError(415, "云端文件大小或类型与上传声明不一致", "UPLOAD_CONTENT_MISMATCH");
    const {data: signed, error: signError} = await storage.createSignedUrl(intent.storage_path, 60);
    if (signError || !signed) throw new AppError(502, "无法校验云端文件，请重试");
    const prefixEnd = Math.min(intent.size, 4096) - 1;
    const upstream = await fetch(signed.signedUrl, {headers: {Range: `bytes=0-${prefixEnd}`}, signal: request.signal, cache: "no-store"});
    if (upstream.status !== 206 || upstream.headers.get("content-range") !== `bytes 0-${prefixEnd}/${intent.size}`) {
      await upstream.body?.cancel(); throw new AppError(502, "媒体存储没有正确响应文件校验请求");
    }
    const signature = await readUploadSignature(upstream, prefixEnd + 1);
    descriptor = identifyMedia(intent.filename, intent.mime_type, signature);
    if (!descriptor || descriptor.mediaType !== intent.media_type || descriptor.mimeType !== intent.mime_type || intent.storage_path !== `${owner.id}/${intentId}.${descriptor.extension}`) throw new AppError(415, "云端文件实际内容与上传类型不一致", "UPLOAD_CONTENT_MISMATCH");
  } catch (error) {
    // Preserve temporary files on transient storage errors so completion can be
    // retried. Invalid or expired objects can never become library assets.
    if (error instanceof AppError && [410, 413, 415].includes(error.status)) {
      const cleanup = await storage.remove([intent.storage_path]);
      if (!cleanup.error) await removeUploadIntent(client, owner.id, intentId);
    }
    throw error;
  }
  const rights = privateRights(descriptor.mediaType, rightsSchema.parse(intent.metadata));
  const asset: Asset = {id: intentId, ownerId: owner.id, filename: intent.filename, mimeType: descriptor.mimeType, size: intent.size, mediaType: descriptor.mediaType, storagePath: intent.storage_path, ...rights, createdAt: intent.created_at};
  try {await saveAsset(asset);} catch (error) {
    // Two completion requests may race, or a response may be lost after INSERT.
    const saved = await existingAsset(owner.id, intentId); if (!saved) throw error;
    return {asset: saved};
  }
  // A saved asset remains usable even if deleting the temporary intent fails.
  await removeUploadIntent(client, owner.id, intentId).catch(() => {});
  return {asset};
}
export async function cancelAssetUpload(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); assertCloudUploads();
  const {intentId} = intentIdSchema.parse(await readJson(request, 1024));
  if (await existingAsset(owner.id, intentId)) return {ok: true, retained: true};
  const client = await createSupabaseServerClient();
  let intent: UploadIntent;
  try {intent = await getUploadIntent(client, owner.id, intentId);} catch (error) {if (error instanceof AppError && error.status === 404) return {ok: true}; throw error;}
  if (!intent.storage_path.startsWith(`${owner.id}/${intentId}.`)) throw new AppError(409, "上传路径与授权不匹配");
  const {error} = await client.storage.from(bucket).remove([intent.storage_path]);
  if (error) throw new AppError(502, "临时文件清理失败，请重试", "UPLOAD_CLEANUP_FAILED");
  await removeUploadIntent(client, owner.id, intentId);
  return {ok: true};
}

export async function uploadAsset(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); const settings = await getSettings(owner.id);
  if (dataMode() === "supabase") throw new AppError(400, "请使用云端直传上传媒体", "DIRECT_UPLOAD_REQUIRED");
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
  const destination = mediaPath(storagePath); await fsp.mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
  try {await fsp.writeFile(destination, Buffer.from(await file.arrayBuffer()), {flag: "wx", mode: 0o600}); if (request.signal.aborted) throw new AppError(499, "上传已取消"); await saveAsset(asset);} catch (error) {await fsp.unlink(destination).catch(() => {}); throw error;}
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
