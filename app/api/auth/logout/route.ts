import { api, json } from "@/lib/server/errors";
import { logoutOwner } from "@/lib/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {return api(async () => {await logoutOwner(request); return json({ok: true});});}

