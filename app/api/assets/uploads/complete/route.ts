import {api, json} from "@/lib/server/errors";
import {completeAssetUpload} from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {return api(async () => json(await completeAssetUpload(request), {status: 201}));}
