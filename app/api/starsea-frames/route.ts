import {requireApiOwner} from "@/lib/server/auth";
import {api, json} from "@/lib/server/errors";
import {readStarseaFrameManifest} from "@/lib/server/starsea-frames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serveManifest() {
  await requireApiOwner();
  return json(await readStarseaFrameManifest(), {headers: {"Cross-Origin-Resource-Policy": "same-origin"}});
}

export async function GET() {return api(serveManifest);}
export async function HEAD() {
  const response = await api(serveManifest);
  return new Response(null, {status: response.status, headers: response.headers});
}
