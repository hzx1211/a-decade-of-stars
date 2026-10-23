import { api, json } from "@/lib/server/errors";
import { currentOwner } from "@/lib/server/auth";
import { getSettings, getPublicSettings } from "@/lib/server/store";
import { updateSettings } from "@/lib/server/content";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {return api(async () => {const owner = await currentOwner(); return json({settings: owner ? await getSettings(owner.id) : await getPublicSettings()});});}
export async function PATCH(request: Request) {return api(async () => json(await updateSettings(request)));}

