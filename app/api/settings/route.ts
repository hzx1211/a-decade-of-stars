import { api, json } from "@/lib/server/errors";
import { requireApiOwner } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/store";
import { updateSettings } from "@/lib/server/content";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {return api(async () => {const owner = await requireApiOwner(); return json({settings: await getSettings(owner.id)});});}
export async function PATCH(request: Request) {return api(async () => json(await updateSettings(request)));}

