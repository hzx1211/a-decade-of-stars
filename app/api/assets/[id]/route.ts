import { api, json } from "@/lib/server/errors";
import { serveAsset, updateAsset, deleteAsset } from "@/lib/server/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{id: string}>};
export async function GET(request: Request, context: Context) {return api(async () => serveAsset(request, (await context.params).id));}
export async function HEAD(request: Request, context: Context) {return api(async () => serveAsset(request, (await context.params).id, true));}
export async function PATCH(request: Request, context: Context) {return api(async () => json(await updateAsset(request, (await context.params).id)));}
export async function DELETE(request: Request, context: Context) {return api(async () => json(await deleteAsset(request, (await context.params).id)));}

