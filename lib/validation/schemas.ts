import { z } from "zod";
import { entryKinds } from "@/lib/types";
import {parseNeteaseMusic} from "@/lib/netease";

export const rightsScopes = ["metadata_only", "personal_collection", "private_storage", "private_playback", "official_embed", "public_display", "link_only"] as const;
const short = z.string().trim().max(500);
const text = z.string().max(100_000);
const id = z.string().uuid();
const ids = z.array(id).max(500).refine(v => new Set(v).size === v.length, "关联记录不能重复");
export const safeUrl = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "请填写有效的 HTTP 或 HTTPS 地址");
export function officialEmbedUrl(value: string): string | null {
  const netease = parseNeteaseMusic(value);
  if (netease) return netease.embedUrl;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (["www.youtube.com", "youtube.com", "youtu.be"].includes(url.hostname)) {
      const video = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || url.pathname.match(/^\/embed\/([^/]+)$/)?.[1];
      return video && /^[\w-]{11}$/.test(video) ? `https://www.youtube-nocookie.com/embed/${video}` : null;
    }
    if (["www.bilibili.com", "bilibili.com"].includes(url.hostname)) {
      const bvid = url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})\/?$/)?.[1];
      return bvid ? `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0` : null;
    }
  } catch { /* Invalid URL. */ }
  return null;
}

const partialDate = z.string().max(10).refine(value => {
  if (!value) return true;
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2200 || (month !== undefined && (month < 1 || month > 12))) return false;
  if (day !== undefined) { const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; }
  return true;
}, "日期应为有效的年份、年月或年月日");

export const entryDataSchema = z.object({
  description: text.optional(), notes: text.optional(), date: partialDate.optional(), datePrecision: z.enum(["day", "month", "year", "unknown"]).optional(),
  year: z.number().int().min(1900).max(2200).optional(), category: short.optional(), tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(), artist: short.optional(), albumId: id.optional(),
  lyrics: text.optional(), lyricsOffset: z.number().int().min(-600_000).max(600_000).optional(),
  assetId: id.optional(), coverAssetId: id.optional(), externalUrl: safeUrl.optional(), sourceType: z.enum(["authorized_upload", "official_embed", "external_link"]).optional(),
  sourceUrl: safeUrl.optional(), rightsHolder: short.optional(), rightsStatus: z.enum(["unknown", "personal_only", "licensed", "do_not_publish"]).optional(),
  licenseType: short.optional(), licenseNotes: z.string().max(10_000).optional(), attribution: short.optional(), allowedUseScope: z.array(z.enum(rightsScopes)).max(7).optional(),
  city: short.optional(), venue: short.optional(), attendance: short.optional(), mood: short.optional(), lifeStage: short.optional(),
  relatedIds: ids.optional(), featured: z.boolean().optional(), verified: z.boolean().optional(), featuredOrder: z.number().int().min(0).max(10000).optional(),
  status: z.enum(["draft", "saved"]).optional(), itemIds: ids.optional(), chapters: ids.optional(), scheduledDate: partialDate.optional(),
}).strict().superRefine((data, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 256 * 1024) ctx.addIssue({code: "custom", message: "单条记录内容超过 256 KB，请拆分为多条记录"});
  if (data.sourceType === "official_embed" && (!data.externalUrl || !officialEmbedUrl(data.externalUrl))) ctx.addIssue({code: "custom", path: ["externalUrl"], message: "官方嵌入仅接受允许的 YouTube、哔哩哔哩视频地址或网易云音乐单曲规范链接"});
  if (data.sourceType === "official_embed" && data.externalUrl) {
    const netease = parseNeteaseMusic(data.externalUrl);
    if (netease && data.externalUrl !== netease.url) ctx.addIssue({code: "custom", path: ["externalUrl"], message: "网易云音乐链接请先规范化为单曲地址再保存"});
  }
  if (data.date && data.datePrecision && data.datePrecision !== "unknown") {
    const length = {day: 10, month: 7, year: 4}[data.datePrecision];
    if (data.date.length !== length) ctx.addIssue({code: "custom", path: ["date"], message: "日期与所选精度不一致"});
  }
});

export const createEntrySchema = z.object({kind: z.enum(entryKinds), title: z.string().trim().min(1).max(300), data: entryDataSchema, favorite: z.boolean().optional(), isPublic: z.boolean().optional()}).strict();
export const patchEntrySchema = z.object({title: z.string().trim().min(1).max(300).optional(), data: entryDataSchema.optional(), favorite: z.boolean().optional(), isPublic: z.boolean().optional()}).strict().refine(v => Object.keys(v).length > 0, "请提供需要更新的字段");
export const authSchema = z.object({email: z.email().max(254).transform(v => v.toLowerCase().trim()), password: z.string().min(12, "密码至少需要 12 个字符").max(256)}).strict();
const modules = z.enum(["journey", "music", "videos", "photos", "journal", "concerts", "star-map"]);
export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(100), subtitle: z.string().max(300), startYear: z.number().int().min(1900).max(2200).nullable(), animation: z.boolean(), theme: z.enum(["midnight", "paper"]),
  timezone: z.string().max(100).refine(v => {try {new Intl.DateTimeFormat("zh-CN", {timeZone: v}); return true;} catch {return false;}}, "无效的时区"),
  heroAssetId: id.optional(), mobileHeroAssetId: id.optional(), heroPosition: z.enum(["center", "top", "bottom", "left", "right"]),
  moduleOrder: z.array(modules).max(7).refine(v => new Set(v).size === v.length, "首页模块不能重复"), hiddenModules: z.array(modules).max(7), featuredIds: ids,
  imageLimitMb: z.number().int().min(1).max(100), audioLimitMb: z.number().int().min(1).max(500), videoLimitMb: z.number().int().min(1).max(2048),
}).strict();
export const patchSettingsSchema = settingsSchema.partial().strict();
export const rightsSchema = z.object({
  sourceUrl: safeUrl.optional(), rightsHolder: short.optional(), rightsStatus: z.enum(["unknown", "personal_only", "licensed", "do_not_publish"]).optional(),
  licenseType: short.optional(), licenseNotes: z.string().max(10_000).optional(), attribution: short.optional(),
  allowedUseScope: z.array(z.enum(rightsScopes)).max(7).optional(),
}).strict();
export const backupEntrySchema = z.object({id, ownerId: z.string().optional(), kind: z.enum(entryKinds), title: z.string().trim().min(1).max(300), data: entryDataSchema, favorite: z.boolean(), isPublic: z.boolean().optional(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime()}).strict();
export const backupAssetSchema = z.object({id, ownerId: z.string().optional(), filename: z.string().max(255), mimeType: z.string().max(100), size: z.number().int().min(1), mediaType: z.enum(["image", "audio", "video"]), storagePath: z.string().max(500), sourceUrl: safeUrl.optional(), rightsHolder: short.optional(), rightsStatus: z.enum(["unknown", "personal_only", "licensed", "do_not_publish"]), licenseType: short.optional(), licenseNotes: z.string().max(10_000).optional(), attribution: short.optional(), allowedUseScope: z.array(z.enum(rightsScopes)).max(7), createdAt: z.iso.datetime()}).strict();
export const backupSchema = z.object({version: z.literal(1), entries: z.array(backupEntrySchema).max(10000), settings: settingsSchema, assets: z.array(backupAssetSchema).max(10000), mediaFilesIncluded: z.literal(false).optional(), exportedAt: z.iso.datetime().optional()}).strict().superRefine((backup, ctx) => {
  if (new Set(backup.entries.map(e => e.id)).size !== backup.entries.length) ctx.addIssue({code: "custom", path: ["entries"], message: "备份中的记录 ID 不能重复"});
  if (new Set(backup.assets.map(e => e.id)).size !== backup.assets.length) ctx.addIssue({code: "custom", path: ["assets"], message: "备份中的媒体 ID 不能重复"});
});
export const restoreSchema = z.object({action: z.enum(["preview", "restore"]), backup: backupSchema, confirmed: z.boolean().optional()}).strict();
export type Backup = z.infer<typeof backupSchema>;
