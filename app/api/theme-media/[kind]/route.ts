import {requireApiOwner} from "@/lib/server/auth";
import {api, AppError} from "@/lib/server/errors";
import {privateImageResponse, readThemeMedia} from "@/lib/server/theme-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{kind: string}>};

async function serveThemeMedia(context: Context, head = false) {
  await requireApiOwner();
  const {kind} = await context.params;
  const media = await readThemeMedia(kind);
  if (!media) throw new AppError(404, "主题图片不存在");
  return privateImageResponse(media, head);
}
export async function GET(_request: Request, context: Context) {return api(() => serveThemeMedia(context));}
export async function HEAD(_request: Request, context: Context) {return api(() => serveThemeMedia(context, true));}
