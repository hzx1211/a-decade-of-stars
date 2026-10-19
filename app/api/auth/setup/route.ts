import { api, json } from "@/lib/server/errors";
import { setupOwner } from "@/lib/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {return api(async () => {await setupOwner(request); return json({ok: true}, {status: 201});});}

