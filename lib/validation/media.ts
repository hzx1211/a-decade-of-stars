import path from "node:path";

export type MediaDescriptor = {mediaType: "image" | "audio" | "video"; mimeType: string; extension: string};
type Format = MediaDescriptor & {extensions: string[]; aliases: string[]; matches: (bytes: Buffer) => boolean};
const ascii = (bytes: Buffer, offset: number, length: number) => bytes.toString("ascii", offset, offset + length);
const ftyp = (bytes: Buffer) => bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp";
const formats: Format[] = [
  {mediaType: "image", mimeType: "image/jpeg", extension: "jpg", extensions: [".jpg", ".jpeg"], aliases: ["image/jpeg"], matches: b => b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255},
  {mediaType: "image", mimeType: "image/png", extension: "png", extensions: [".png"], aliases: ["image/png"], matches: b => b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && ascii(b, 12, 4) === "IHDR"},
  {mediaType: "image", mimeType: "image/gif", extension: "gif", extensions: [".gif"], aliases: ["image/gif"], matches: b => ["GIF87a", "GIF89a"].includes(ascii(b, 0, 6))},
  {mediaType: "image", mimeType: "image/webp", extension: "webp", extensions: [".webp"], aliases: ["image/webp"], matches: b => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP"},
  {mediaType: "image", mimeType: "image/avif", extension: "avif", extensions: [".avif"], aliases: ["image/avif"], matches: b => ftyp(b) && /avif|avis/.test(ascii(b, 8, Math.min(b.length - 8, 56)))},
  {mediaType: "audio", mimeType: "audio/mpeg", extension: "mp3", extensions: [".mp3"], aliases: ["audio/mpeg", "audio/mp3"], matches: b => ascii(b, 0, 3) === "ID3" || (b.length >= 4 && b[0] === 255 && (b[1] & 224) === 224 && (b[1] & 24) !== 8 && (b[1] & 6) !== 0 && (b[2] & 240) > 0 && (b[2] & 240) < 240)},
  {mediaType: "audio", mimeType: "audio/wav", extension: "wav", extensions: [".wav"], aliases: ["audio/wav", "audio/x-wav", "audio/wave"], matches: b => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE"},
  {mediaType: "audio", mimeType: "audio/ogg", extension: "ogg", extensions: [".ogg", ".oga", ".opus"], aliases: ["audio/ogg", "audio/opus"], matches: b => ascii(b, 0, 4) === "OggS" && /OpusHead|vorbis|fLaC/.test(b.subarray(0, 4096).toString("latin1"))},
  {mediaType: "audio", mimeType: "audio/flac", extension: "flac", extensions: [".flac"], aliases: ["audio/flac", "audio/x-flac"], matches: b => ascii(b, 0, 4) === "fLaC"},
  {mediaType: "audio", mimeType: "audio/mp4", extension: "m4a", extensions: [".m4a"], aliases: ["audio/mp4", "audio/x-m4a"], matches: b => ftyp(b) && /M4A |M4B |isom|mp42/.test(ascii(b, 8, Math.min(b.length - 8, 56)))},
  {mediaType: "video", mimeType: "video/mp4", extension: "mp4", extensions: [".mp4", ".m4v"], aliases: ["video/mp4", "video/x-m4v"], matches: b => ftyp(b) && /isom|iso[2-6]|mp4[12]|avc1|M4V |dash/.test(ascii(b, 8, Math.min(b.length - 8, 56)))},
  {mediaType: "video", mimeType: "video/webm", extension: "webm", extensions: [".webm"], aliases: ["video/webm"], matches: b => b.length > 8 && b.subarray(0,4).equals(Buffer.from([26,69,223,163])) && b.subarray(0,4096).includes(Buffer.from("webm"))},
];
export function identifyMedia(filename: string, mimeType: string, bytes: Buffer): MediaDescriptor | null {
  const extension = path.extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  const format = formats.find(f => f.extensions.includes(extension) && f.aliases.includes(mime) && f.matches(bytes));
  return format ? {mediaType: format.mediaType, mimeType: format.mimeType, extension: format.extension} : null;
}
export function parseRange(value: string | null, size: number): {start: number; end: number} | "invalid" | null {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  if (!match[1]) {const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid"; return {start: Math.max(0, size - suffix), end: size - 1};}
  const start = Number(match[1]); const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return {start, end: Math.min(end, size - 1)};
}
