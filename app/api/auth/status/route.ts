import { api, json } from "@/lib/server/errors";
import { getAuthStatus } from "@/lib/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {return api(async () => json(await getAuthStatus()));}

