import { api, json } from "@/lib/server/errors";
import { loginOwner } from "@/lib/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {return api(async () => {await loginOwner(request); return json({ok: true});});}

