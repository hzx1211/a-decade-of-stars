import "server-only";
import {lstat, open, realpath} from "node:fs/promises";
import path from "node:path";
import {AppError} from "./errors";

const maximumFrames = 6;
const maximumManifestBytes = 64 * 1024;
const maximumFrameBytes = 12 * 1024 * 1024;
const safeFilename = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(?:webp|png|jpe?g)$/;
type Frame = {file: string; label: string};
export type StarseaFrameManifest = {version: 1; frames: {src: string; label: string}[]};

function framesDirectory() {
  return path.resolve(process.cwd(), "assets", "generated", "starsea-v2");
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

// The manifest cannot turn this endpoint into a reader for arbitrary local files,
// including through symlinks or junctions inside the generated-assets directory.
async function openGeneratedFile(filename: string, maximumBytes: number) {
  const directory = framesDirectory();
  const filenamePath = path.join(directory, filename);
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return null;
    if (path.relative(directory, await realpath(directory)) !== "") return null;
    const info = await lstat(filenamePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) return null;
    if (path.relative(directory, await realpath(filenamePath)) !== filename) return null;
    const file = await open(filenamePath, "r");
    try {
      const openedInfo = await file.stat();
      if (!openedInfo.isFile() || openedInfo.size > maximumBytes) {
        await file.close();
        return null;
      }
    } catch (error) {await file.close(); throw error;}
    return file;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readManifest(): Promise<Frame[]> {
  const file = await openGeneratedFile("manifest.json", maximumManifestBytes);
  if (!file) return [];
  try {
    let value: unknown;
    try {value = JSON.parse(await file.readFile({encoding: "utf8"}));}
    catch (error) {if (error instanceof SyntaxError) return []; throw error;}
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("frames" in value) || !Array.isArray(value.frames)) return [];
    const frames: Frame[] = [];
    const filenames = new Set<string>();
    for (const entry of value.frames.slice(0, maximumFrames)) {
      if (!entry || typeof entry !== "object" || typeof entry.file !== "string" || !safeFilename.test(entry.file) || filenames.has(entry.file)) continue;
      filenames.add(entry.file);
      frames.push({file: entry.file, label: typeof entry.label === "string" ? entry.label.trim().slice(0, 120) : "星海"});
    }
    return frames;
  } finally {await file.close();}
}

function imageContentType(filename: string, header: Buffer) {
  const extension = path.extname(filename);
  if (extension === ".png" && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if ((extension === ".jpg" || extension === ".jpeg") && header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
  if (extension === ".webp" && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function readFrame(file: string, includeBytes: boolean) {
  const handle = await openGeneratedFile(file, maximumFrameBytes);
  if (!handle) return null;
  try {
    const header = Buffer.alloc(12);
    const {bytesRead} = await handle.read({buffer: header, position: 0});
    const contentType = imageContentType(file, header.subarray(0, bytesRead));
    if (!contentType) return null;
    return {contentType, bytes: includeBytes ? await handle.readFile() : Buffer.alloc(0)};
  } finally {await handle.close();}
}

export async function readStarseaFrameManifest(): Promise<StarseaFrameManifest> {
  const frames: StarseaFrameManifest["frames"] = [];
  for (const frame of await readManifest()) {
    if (await readFrame(frame.file, false)) frames.push({src: `/api/starsea-frames/${frame.file}`, label: frame.label});
  }
  return {version: 1, frames};
}

export async function readStarseaFrame(filename: string) {
  if (!safeFilename.test(filename) || !(await readManifest()).some(frame => frame.file === filename)) throw new AppError(404, "星海背景不存在");
  const frame = await readFrame(filename, true);
  if (!frame) throw new AppError(404, "星海背景不存在");
  return frame;
}
