import type { Asset, Entry, EntryData, SiteSettings } from "./types";

export type ImportKind = "music" | "videos" | "photos";

export const mediaImportOptions = {
  music: { label: "歌曲", fileLabel: "音频", mediaType: "audio", accept: ".mp3,.wav,.ogg,.oga,.opus,.flac,.m4a", formats: "MP3 · WAV · OGG · OPUS · FLAC · M4A", extensions: ["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a"] },
  videos: { label: "演唱会视频", fileLabel: "视频", mediaType: "video", accept: ".mp4,.m4v,.webm", formats: "MP4 · M4V · WEBM", extensions: ["mp4", "m4v", "webm"] },
  photos: { label: "照片", fileLabel: "照片", mediaType: "image", accept: ".jpg,.jpeg,.png,.webp,.gif,.avif", formats: "JPG · PNG · WEBP · GIF · AVIF", extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"] },
} as const;

export function importTitle(filename: string) {
  return filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim().slice(0, 300);
}

export function importLimitMb(kind: ImportKind, settings: SiteSettings) {
  return kind === "music" ? settings.audioLimitMb : kind === "videos" ? settings.videoLimitMb : settings.imageLimitMb;
}

export function importFileError(kind: ImportKind, file: Pick<File, "name" | "size">, limitMb: number): string | null {
  if (!file.size) return "文件是空的，请重新选择。";
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (!(mediaImportOptions[kind].extensions as readonly string[]).includes(extension)) return `请选择支持的${mediaImportOptions[kind].fileLabel}格式。`;
  if (file.size > limitMb * 1024 * 1024) return `文件超过当前 ${limitMb} MB 上限，可在设置中调整。`;
  return null;
}

export function importEntryPayload(kind: ImportKind, title: string, asset: Asset, targetEntry?: Entry) {
  const data: EntryData = {
    ...targetEntry?.data,
    assetId: asset.id,
    status: "saved",
    rightsStatus: asset.rightsStatus as EntryData["rightsStatus"],
    ...(asset.rightsHolder !== undefined ? {rightsHolder: asset.rightsHolder} : {}),
    ...(asset.licenseNotes !== undefined ? {licenseNotes: asset.licenseNotes} : {}),
    ...(asset.sourceUrl !== undefined ? {sourceUrl: asset.sourceUrl} : {}),
    ...(asset.licenseType !== undefined ? {licenseType: asset.licenseType} : {}),
    ...(asset.attribution !== undefined ? {attribution: asset.attribution} : {}),
    allowedUseScope: [...asset.allowedUseScope],
    ...(kind === "music" ? { artist: targetEntry?.data.artist || "张杰", sourceType: "authorized_upload" as const } : {}),
    ...(kind === "videos" ? { category: targetEntry?.data.category || "演唱会现场", sourceType: "authorized_upload" as const } : {}),
    ...(kind === "photos" ? { category: targetEntry?.data.category || "照片" } : {}),
  };
  return { kind, title: title.trim(), data, favorite: targetEntry?.favorite || false };
}

export function importFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
