import "server-only";
import type { Asset, Entry, EntryKind, SiteSettings } from "@/lib/types";
import { defaultSettings } from "@/lib/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataMode } from "./config";
import { getDatabase } from "./db";
import { AppError } from "./errors";

type EntryRow = {id: string; owner_id: string; kind: EntryKind; title: string; data: string | Entry["data"]; favorite: number | boolean; created_at: string; updated_at: string};
type AssetRow = {id: string; owner_id: string; filename: string; mime_type: string; size: number; media_type: Asset["mediaType"]; storage_path: string; metadata?: string; source_url?: string | null; rights_holder?: string | null; rights_status?: string; license_type?: string | null; license_notes?: string | null; attribution?: string | null; allowed_use_scope?: string[]; created_at: string};
function entryFromRow(row: EntryRow): Entry {return {id: row.id, ownerId: row.owner_id, kind: row.kind, title: row.title, data: typeof row.data === "string" ? JSON.parse(row.data) : row.data, favorite: Boolean(row.favorite), createdAt: row.created_at, updatedAt: row.updated_at};}
function assetFromRow(row: AssetRow): Asset {
  const metadata = row.metadata ? JSON.parse(row.metadata) : {sourceUrl: row.source_url || undefined, rightsHolder: row.rights_holder || undefined, rightsStatus: row.rights_status, licenseType: row.license_type || undefined, licenseNotes: row.license_notes || undefined, attribution: row.attribution || undefined, allowedUseScope: row.allowed_use_scope || []};
  return {id: row.id, ownerId: row.owner_id, filename: row.filename, mimeType: row.mime_type, size: row.size, mediaType: row.media_type, storagePath: row.storage_path, ...metadata, createdAt: row.created_at};
}
export function getLocalState(ownerId: string): {entries: Entry[]; assets: Asset[]; settings: SiteSettings} {
  const db = getDatabase();
  const entries = (db.prepare("SELECT * FROM entries WHERE owner_id=? ORDER BY created_at DESC").all(ownerId) as unknown as EntryRow[]).map(entryFromRow);
  const assets = (db.prepare("SELECT * FROM media_assets WHERE owner_id=? ORDER BY created_at DESC").all(ownerId) as unknown as AssetRow[]).map(assetFromRow);
  const row = db.prepare("SELECT settings FROM site_settings WHERE owner_id=?").get(ownerId) as {settings: string} | undefined;
  return {entries, assets, settings: row ? {...defaultSettings, ...JSON.parse(row.settings)} : {...defaultSettings}};
}
export function entryToRow(entry: Entry) {return {id: entry.id, owner_id: entry.ownerId, kind: entry.kind, title: entry.title, data: entry.data, favorite: entry.favorite, created_at: entry.createdAt, updated_at: entry.updatedAt};}
export function assetToRow(asset: Asset) {return {id: asset.id, owner_id: asset.ownerId, filename: asset.filename, mime_type: asset.mimeType, size: asset.size, media_type: asset.mediaType, storage_path: asset.storagePath, source_url: asset.sourceUrl || null, rights_holder: asset.rightsHolder || null, rights_status: asset.rightsStatus, license_type: asset.licenseType || null, license_notes: asset.licenseNotes || null, attribution: asset.attribution || null, allowed_use_scope: asset.allowedUseScope, created_at: asset.createdAt};}
function checkError(error: {message: string; code?: string} | null) {if (error) {console.error("[private-museum] Storage request:", error.code || "unknown"); throw new AppError(500, "数据库操作失败，请检查服务配置或重试");}}
export async function getEntries(ownerId: string, kind?: EntryKind, q?: string): Promise<Entry[]> {
  let entries: Entry[];
  if (dataMode() === "local") {
    const db = getDatabase();
    const rows = kind ? db.prepare("SELECT * FROM entries WHERE owner_id=? AND kind=? ORDER BY created_at DESC").all(ownerId, kind) : db.prepare("SELECT * FROM entries WHERE owner_id=? ORDER BY created_at DESC").all(ownerId);
    entries = (rows as unknown as EntryRow[]).map(entryFromRow);
  } else {
    const client = await createSupabaseServerClient(); let query = client.from("entries").select("*").eq("owner_id", ownerId).order("created_at", {ascending: false});
    if (kind) query = query.eq("kind", kind);
    const {data, error} = await query; checkError(error); entries = ((data || []) as EntryRow[]).map(entryFromRow);
  }
  if (q) {const query = q.toLocaleLowerCase(); entries = entries.filter(e => `${e.title} ${JSON.stringify(e.data)}`.toLocaleLowerCase().includes(query));}
  return entries;
}
export async function getEntry(ownerId: string, id: string): Promise<Entry> {
  if (dataMode() === "local") {
    const row = getDatabase().prepare("SELECT * FROM entries WHERE owner_id=? AND id=?").get(ownerId, id) as unknown as EntryRow | undefined;
    if (!row) throw new AppError(404, "记录不存在"); return entryFromRow(row);
  }
  const client = await createSupabaseServerClient(); const {data, error} = await client.from("entries").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(); checkError(error);
  if (!data) throw new AppError(404, "记录不存在"); return entryFromRow(data as EntryRow);
}
export function saveLocalEntry(entry: Entry) {
  getDatabase().prepare("INSERT INTO entries(id,owner_id,kind,title,data,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,data=excluded.data,favorite=excluded.favorite,updated_at=excluded.updated_at WHERE entries.owner_id=excluded.owner_id AND entries.kind=excluded.kind").run(entry.id, entry.ownerId, entry.kind, entry.title, JSON.stringify(entry.data), Number(entry.favorite), entry.createdAt, entry.updatedAt);
}
export async function saveEntry(entry: Entry, insert = false) {
  if (dataMode() === "local") {saveLocalEntry(entry); return;}
  const client = await createSupabaseServerClient(); const row = entryToRow(entry);
  const {error} = insert ? await client.from("entries").insert(row) : await client.from("entries").update({title: row.title, data: row.data, favorite: row.favorite, updated_at: row.updated_at}).eq("id", entry.id).eq("owner_id", entry.ownerId);
  checkError(error);
}
export async function removeEntry(ownerId: string, id: string) {
  if (dataMode() === "local") {getDatabase().prepare("DELETE FROM entries WHERE owner_id=? AND id=?").run(ownerId, id); return;}
  const client = await createSupabaseServerClient(); const {error} = await client.from("entries").delete().eq("owner_id", ownerId).eq("id", id); checkError(error);
}
export async function getAssets(ownerId: string): Promise<Asset[]> {
  if (dataMode() === "local") return (getDatabase().prepare("SELECT * FROM media_assets WHERE owner_id=? ORDER BY created_at DESC").all(ownerId) as unknown as AssetRow[]).map(assetFromRow);
  const client = await createSupabaseServerClient(); const {data, error} = await client.from("media_assets").select("*").eq("owner_id", ownerId).order("created_at", {ascending: false}); checkError(error); return ((data || []) as AssetRow[]).map(assetFromRow);
}
export async function getAsset(ownerId: string, id: string): Promise<Asset> {
  if (dataMode() === "local") {
    const row = getDatabase().prepare("SELECT * FROM media_assets WHERE owner_id=? AND id=?").get(ownerId, id) as unknown as AssetRow | undefined;
    if (!row) throw new AppError(404, "媒体不存在"); return assetFromRow(row);
  }
  const client = await createSupabaseServerClient(); const {data, error} = await client.from("media_assets").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(); checkError(error);
  if (!data) throw new AppError(404, "媒体不存在"); return assetFromRow(data as AssetRow);
}
export function saveLocalAsset(asset: Asset) {
  const metadata = {sourceUrl: asset.sourceUrl, rightsHolder: asset.rightsHolder, rightsStatus: asset.rightsStatus, licenseType: asset.licenseType, licenseNotes: asset.licenseNotes, attribution: asset.attribution, allowedUseScope: asset.allowedUseScope};
  getDatabase().prepare("INSERT INTO media_assets(id,owner_id,filename,mime_type,size,media_type,storage_path,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata WHERE media_assets.owner_id=excluded.owner_id").run(asset.id, asset.ownerId, asset.filename, asset.mimeType, asset.size, asset.mediaType, asset.storagePath, JSON.stringify(metadata), asset.createdAt);
}
export async function saveAsset(asset: Asset) {
  if (dataMode() === "local") {saveLocalAsset(asset); return;}
  const client = await createSupabaseServerClient(); const {error} = await client.from("media_assets").insert(assetToRow(asset)); checkError(error);
}
export async function removeAssetRecord(ownerId: string, id: string) {
  if (dataMode() === "local") {getDatabase().prepare("DELETE FROM media_assets WHERE owner_id=? AND id=?").run(ownerId, id); return;}
  const client = await createSupabaseServerClient(); const {error} = await client.from("media_assets").delete().eq("owner_id", ownerId).eq("id", id); checkError(error);
}
export async function getSettings(ownerId: string): Promise<SiteSettings> {
  if (dataMode() === "local") {const row = getDatabase().prepare("SELECT settings FROM site_settings WHERE owner_id=?").get(ownerId) as {settings: string} | undefined; return row ? {...defaultSettings, ...JSON.parse(row.settings)} : {...defaultSettings};}
  const client = await createSupabaseServerClient(); const {data, error} = await client.from("site_settings").select("settings").eq("owner_id", ownerId).maybeSingle(); checkError(error); return {...defaultSettings, ...data?.settings};
}
export function saveLocalSettings(ownerId: string, settings: SiteSettings) {
  getDatabase().prepare("INSERT INTO site_settings(owner_id,settings,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at").run(ownerId, JSON.stringify(settings), new Date().toISOString());
}
export async function saveSettings(ownerId: string, settings: SiteSettings) {
  if (dataMode() === "local") {saveLocalSettings(ownerId, settings); return;}
  const client = await createSupabaseServerClient(); const {error} = await client.from("site_settings").upsert({owner_id: ownerId, settings, updated_at: new Date().toISOString()}); checkError(error);
}
