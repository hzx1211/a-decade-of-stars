export const entryKinds = ["music", "albums", "videos", "photos", "journey", "timeline", "concerts", "letters", "journal", "milestones", "memory-book"] as const;
export type EntryKind = typeof entryKinds[number];
export type EntryData = {
  description?: string; notes?: string; date?: string; datePrecision?: "day" | "month" | "year" | "unknown";
  year?: number; category?: string; tags?: string[]; artist?: string; albumId?: string;
  lyrics?: string; lyricsOffset?: number;
  assetId?: string; coverAssetId?: string; externalUrl?: string; sourceType?: "authorized_upload" | "official_embed" | "external_link";
  sourceUrl?: string; rightsHolder?: string; rightsStatus?: "unknown" | "personal_only" | "licensed" | "do_not_publish";
  licenseType?: string; licenseNotes?: string; attribution?: string; allowedUseScope?: string[];
  city?: string; venue?: string; attendance?: string; mood?: string; lifeStage?: string;
  relatedIds?: string[]; featured?: boolean; verified?: boolean; featuredOrder?: number;
  status?: "draft" | "saved"; itemIds?: string[]; chapters?: string[]; scheduledDate?: string;
};
export type Entry = { id: string; ownerId: string; kind: EntryKind; title: string; data: EntryData; favorite: boolean; createdAt: string; updatedAt: string };
export type Asset = { id: string; ownerId: string; filename: string; mimeType: string; size: number; mediaType: "image" | "audio" | "video"; storagePath: string; sourceUrl?: string; rightsHolder?: string; rightsStatus: string; licenseType?: string; licenseNotes?: string; attribution?: string; allowedUseScope: string[]; createdAt: string };
export type SiteSettings = { siteName: string; subtitle: string; startYear: number | null; animation: boolean; theme: "midnight" | "paper"; timezone: string; heroAssetId?: string; mobileHeroAssetId?: string; heroPosition: string; moduleOrder: string[]; hiddenModules: string[]; featuredIds: string[]; imageLimitMb: number; audioLimitMb: number; videoLimitMb: number };
export const defaultSettings: SiteSettings = { siteName: "十余年星途纪念馆", subtitle: "十余年热爱，一路星光。", startYear: 2009, animation: true, theme: "midnight", timezone: "Asia/Shanghai", heroPosition: "center", moduleOrder: ["journey", "music", "videos", "photos", "journal", "concerts", "star-map"], hiddenModules: [], featuredIds: [], imageLimitMb: 10, audioLimitMb: 50, videoLimitMb: 100 };
export const kindLabels: Record<EntryKind, string> = { music: "音乐馆", albums: "专辑馆", videos: "影像馆", photos: "照片馆", journey: "十余年星途", timeline: "时光长廊", concerts: "演唱会回忆", letters: "写给张杰的信", journal: "追星日记", milestones: "纪念日", "memory-book": "十余年纪念册" };
