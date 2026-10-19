import "server-only";
import { statSync } from "node:fs";
import type { Asset, Entry } from "@/lib/types";
import { restoreSchema, rightsSchema, type Backup } from "@/lib/validation/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireApiOwner } from "./auth";
import { assertSameOrigin, readJson } from "./security";
import { getAssets, getEntries, getSettings, getLocalState, saveLocalAsset, saveLocalEntry, saveLocalSettings, assetToRow, entryToRow } from "./store";
import { assetFileExists } from "./media";
import { transaction } from "./db";
import { dataMode, mediaPath } from "./config";
import { AppError } from "./errors";
import { validateReferences, validateSettingsReferences } from "./references";

export async function exportBackup() {
  const owner = await requireApiOwner(); const [entries, assets, settings] = await Promise.all([getEntries(owner.id), getAssets(owner.id), getSettings(owner.id)]);
  return {version: 1, entries, settings, assets, mediaFilesIncluded: false, exportedAt: new Date().toISOString()};
}
async function prepareRestore(ownerId: string, backup: Backup) {
  const [existingEntries, existingAssets] = await Promise.all([getEntries(ownerId), getAssets(ownerId)]);
  const entriesById = new Map(existingEntries.map(e => [e.id, e])); const assetsById = new Map(existingAssets.map(a => [a.id, a]));
  const entries: Entry[] = backup.entries.map(incoming => {
    const existing = entriesById.get(incoming.id);
    if (existing && existing.kind !== incoming.kind) throw new AppError(400, "恢复不能改变已有记录的类型");
    return {...incoming, ownerId, createdAt: existing?.createdAt || incoming.createdAt, updatedAt: new Date().toISOString()};
  });
  const missingMedia: string[] = []; const assets: Asset[] = [];
  for (const incoming of backup.assets) {
    const metadata = rightsSchema.parse({sourceUrl: incoming.sourceUrl, rightsHolder: incoming.rightsHolder, rightsStatus: incoming.rightsStatus, licenseType: incoming.licenseType, licenseNotes: incoming.licenseNotes, attribution: incoming.attribution, allowedUseScope: incoming.allowedUseScope});
    const existing = assetsById.get(incoming.id);
    if (!existing || !await assetFileExists(existing)) {missingMedia.push(incoming.id); continue;}
    if (incoming.storagePath !== existing.storagePath || incoming.mimeType !== existing.mimeType || incoming.size !== existing.size || incoming.mediaType !== existing.mediaType) throw new AppError(400, "备份媒体身份与当前文件不一致，不能用元信息替换实际文件");
    // Merge restores keep historical metadata when an older/simplified backup
    // omits optional fields. An omitted form field is not a deletion request.
    assets.push({...existing, ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined))});
  }
  const allEntries = [...existingEntries.filter(e => !entries.some(i => i.id === e.id)), ...entries];
  const allAssets = [...existingAssets.filter(a => !assets.some(i => i.id === a.id)), ...assets];
  // Missing binary files are shown in preview. Restore is rejected rather than creating dangling private-media references.
  if (!missingMedia.length) {for (const entry of allEntries) validateReferences(entry, allEntries, allAssets); validateSettingsReferences(ownerId, backup.settings, allEntries, allAssets);}
  return {entries, assets, existingEntries, missingMedia};
}
export async function importBackup(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); const input = restoreSchema.parse(await readJson(request, 16 * 1024 * 1024));
  const prepared = await prepareRestore(owner.id, input.backup);
  const preview = {entries: {new: prepared.entries.filter(e => !prepared.existingEntries.some(old => old.id === e.id)).length, updated: prepared.entries.filter(e => prepared.existingEntries.some(old => old.id === e.id)).length}, assets: {updated: prepared.assets.length, missing: prepared.missingMedia.length}, missingMedia: prepared.missingMedia, mediaFilesIncluded: false, settingsWillUpdate: true, mode: "merge"};
  if (input.action === "preview") return {preview};
  if (input.confirmed !== true) throw new AppError(400, "请先预览并确认恢复操作", "CONFIRMATION_REQUIRED");
  if (prepared.missingMedia.length) throw new AppError(409, "此备份仅包含媒体元信息；部分实际媒体文件缺失，恢复媒体目录后再重试", "MEDIA_FILES_MISSING");
  if (dataMode() === "local") {
    transaction(() => {
      const state = getLocalState(owner.id);
      for (const incoming of prepared.entries) {const current = state.entries.find(e => e.id === incoming.id); if (current && current.kind !== incoming.kind) throw new AppError(409, "记录类型在恢复前发生变化，请重新预览");}
      for (const incoming of prepared.assets) {
        const current = state.assets.find(a => a.id === incoming.id);
        if (!current || current.storagePath !== incoming.storagePath || current.size !== incoming.size) throw new AppError(409, "媒体在恢复前发生变化，请重新预览");
        try {const stat = statSync(mediaPath(current.storagePath)); if (!stat.isFile() || stat.size !== current.size) throw new Error("Missing media");} catch {throw new AppError(409, "恢复所需媒体文件缺失，请重新预览", "MEDIA_FILES_MISSING");}
      }
      const allEntries = [...state.entries.filter(e => !prepared.entries.some(i => i.id === e.id)), ...prepared.entries];
      const allAssets = [...state.assets.filter(a => !prepared.assets.some(i => i.id === a.id)), ...prepared.assets];
      for (const entry of allEntries) validateReferences(entry, allEntries, allAssets);
      validateSettingsReferences(owner.id, input.backup.settings, allEntries, allAssets);
      for (const entry of prepared.entries) saveLocalEntry(entry); for (const asset of prepared.assets) saveLocalAsset(asset); saveLocalSettings(owner.id, input.backup.settings);
    });
  } else {
    const client = await createSupabaseServerClient(); const {error} = await client.rpc("restore_backup", {p_entries: prepared.entries.map(entryToRow), p_settings: input.backup.settings, p_assets: prepared.assets.map(assetToRow)});
    if (error) throw new AppError(500, "恢复事务失败，原有数据保持不变；请检查迁移与 RLS 策略");
  }
  return {ok: true, restored: preview};
}
