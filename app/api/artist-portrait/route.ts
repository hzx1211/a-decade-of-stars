import {readFile} from "node:fs/promises";
import path from "node:path";
import {currentOwner} from "@/lib/server/auth";
import {api} from "@/lib/server/errors";
import {privateImageResponse, readThemeMedia} from "@/lib/server/theme-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function servePortrait(head = false) {
  if (await currentOwner()) {
    const stage = await readThemeMedia("stage");
    if (stage) return privateImageResponse(stage, head);
  }
  const bytes = await readFile(path.join(process.cwd(), "assets/licensed/zhang-jie.jpg"));
  return privateImageResponse({bytes, contentType: "image/jpeg"}, head);
}
export async function GET() {return api(() => servePortrait());}
export async function HEAD() {return api(() => servePortrait(true));}
