import type { Asset, Entry, SiteSettings } from "@/lib/types";
import { defaultSettings } from "@/lib/types";

const publicDataKeys = [
  "description", "date", "datePrecision", "year", "category", "tags", "artist", "lyrics", "lyricsOffset",
  "assetId", "coverAssetId", "externalUrl", "sourceType", "city", "venue", "attendance", "mood", "lifeStage",
  "featured", "verified", "scheduledDate", "albumId", "relatedIds", "itemIds", "chapters",
] as const;

export function isPublicEntry(entry: Entry): boolean {
  return entry.isPublic === true && entry.data.status !== "draft";
}

export function publicEntries(entries: Entry[]): Entry[] {
  return entries.filter(isPublicEntry);
}

export function publicAssetIds(entries: Entry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!isPublicEntry(entry)) continue;
    if (entry.data.assetId) ids.add(entry.data.assetId);
    if (entry.data.coverAssetId) ids.add(entry.data.coverAssetId);
  }
  return ids;
}

export function sanitizePublicEntry(entry: Entry, visibleEntryIds?: Set<string>): Entry {
  const data: Entry["data"] = {};
  for (const key of publicDataKeys) {
    if (key === "albumId") {
      const value = entry.data.albumId;
      if (value !== undefined && (!visibleEntryIds || visibleEntryIds.has(value))) data.albumId = value;
      continue;
    }
    if (key === "relatedIds" || key === "itemIds" || key === "chapters") {
      const values = entry.data[key];
      if (values !== undefined) data[key] = visibleEntryIds ? values.filter(id => visibleEntryIds.has(id)) : values;
      continue;
    }
    const value = entry.data[key];
    if (value !== undefined) Object.assign(data, {[key]: value});
  }
  return {
    id: entry.id,
    ownerId: "",
    kind: entry.kind,
    title: entry.title,
    data,
    favorite: false,
    isPublic: true,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function sanitizePublicAsset(asset: Asset): Asset {
  return {
    id: asset.id,
    ownerId: "",
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    mediaType: asset.mediaType,
    storagePath: "",
    rightsStatus: "",
    allowedUseScope: [],
    createdAt: asset.createdAt,
  };
}

export function sanitizePublicSettings(settings: SiteSettings, entries: Entry[], assets: Asset[]): SiteSettings {
  const entryIds = new Set(entries.map(entry => entry.id));
  const assetIds = new Set(assets.map(asset => asset.id));
  return {
    ...defaultSettings,
    siteName: settings.siteName,
    subtitle: settings.subtitle,
    startYear: settings.startYear,
    animation: settings.animation,
    theme: settings.theme,
    timezone: settings.timezone,
    heroAssetId: settings.heroAssetId && assetIds.has(settings.heroAssetId) ? settings.heroAssetId : undefined,
    mobileHeroAssetId: settings.mobileHeroAssetId && assetIds.has(settings.mobileHeroAssetId) ? settings.mobileHeroAssetId : undefined,
    heroPosition: settings.heroPosition,
    moduleOrder: settings.moduleOrder.filter(module => !settings.hiddenModules.includes(module)),
    hiddenModules: [],
    featuredIds: settings.featuredIds.filter(id => entryIds.has(id)),
  };
}
