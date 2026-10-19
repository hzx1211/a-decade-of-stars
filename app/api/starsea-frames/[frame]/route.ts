import {requireApiOwner} from "@/lib/server/auth";
import {api} from "@/lib/server/errors";
import {readStarseaFrame} from "@/lib/server/starsea-frames";
import {privateImageResponse} from "@/lib/server/theme-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{frame: string}>};

async function serveFrame(context: Context, head = false) {
  await requireApiOwner();
  const {frame} = await context.params;
  return privateImageResponse(await readStarseaFrame(frame), head);
}

export async function GET(_request: Request, context: Context) {return api(() => serveFrame(context));}
export async function HEAD(_request: Request, context: Context) {
  const response = await api(() => serveFrame(context, true));
  return new Response(null, {status: response.status, headers: response.headers});
}
