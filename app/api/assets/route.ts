import { api, json } from "@/lib/server/errors";
import { requireApiOwner } from "@/lib/server/auth";
import { getAssets } from "@/lib/server/store";
import { uploadAsset } from "@/lib/server/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {return api(async () => {const owner = await requireApiOwner(); return json({assets: await getAssets(owner.id)});});}
export async function POST(request: Request) {return api(async () => json(await uploadAsset(request), {status: 201}));}

