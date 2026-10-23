import { api, json } from "@/lib/server/errors";
import { currentOwner } from "@/lib/server/auth";
import { getAssets, getPublicAssets } from "@/lib/server/store";
import { uploadAsset } from "@/lib/server/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {return api(async () => {const owner = await currentOwner(); return json({assets: owner ? await getAssets(owner.id) : await getPublicAssets()});});}
export async function POST(request: Request) {return api(async () => json(await uploadAsset(request), {status: 201}));}

