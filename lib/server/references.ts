import "server-only";
import type { Asset, Entry, SiteSettings } from "@/lib/types";
import { AppError } from "./errors";

export function entryReferences(entry: Entry): string[] {const d = entry.data; return [...(d.albumId ? [d.albumId] : []), ...(d.relatedIds || []), ...(d.itemIds || []), ...(d.chapters || [])];}
export function assetReferences(entry: Entry): string[] {return [entry.data.assetId, entry.data.coverAssetId].filter(Boolean) as string[];}
export function validateReferences(entry: Entry, entries: Entry[], assets: Asset[]) {
  const entriesById = new Map(entries.map(e => [e.id, e])); const assetsById = new Map(assets.map(a => [a.id, a]));
  for (const id of entryReferences(entry)) {
    if (id === entry.id) throw new AppError(400, "记录不能关联自身");
    const target = entriesById.get(id); if (!target || target.ownerId !== entry.ownerId) throw new AppError(400, "关联记录不存在或不属于当前所有者");
  }
  if (entry.data.albumId && entriesById.get(entry.data.albumId)?.kind !== "albums") throw new AppError(400, "关联专辑必须是专辑记录");
  for (const id of entry.data.chapters || []) if (entriesById.get(id)?.kind !== "journey") throw new AppError(400, "章节必须关联星途记录");
  for (const id of assetReferences(entry)) {const asset = assetsById.get(id); if (!asset || asset.ownerId !== entry.ownerId) throw new AppError(400, "关联媒体不存在或不属于当前所有者");}
  if (entry.data.coverAssetId && assetsById.get(entry.data.coverAssetId)?.mediaType !== "image") throw new AppError(400, "封面必须使用图片");
  if (entry.data.assetId) {
    const asset = assetsById.get(entry.data.assetId)!;
    const expected = {music: "audio", videos: "video", photos: "image"}[entry.kind as "music" | "videos" | "photos"];
    if (expected && asset.mediaType !== expected) throw new AppError(400, "媒体类型与当前内容不匹配");
  }
}
export function validateSettingsReferences(ownerId: string, settings: SiteSettings, entries: Entry[], assets: Asset[]) {
  for (const id of settings.featuredIds) if (!entries.some(e => e.id === id && e.ownerId === ownerId)) throw new AppError(400, "精选记录不存在");
  for (const id of [settings.heroAssetId, settings.mobileHeroAssetId].filter(Boolean)) if (!assets.some(a => a.id === id && a.ownerId === ownerId && a.mediaType === "image")) throw new AppError(400, "首页主视觉必须关联当前所有者的图片");
}
