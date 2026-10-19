import { api, json } from "@/lib/server/errors";
import { createEntry, listEntries } from "@/lib/server/content";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {return api(async () => json(await listEntries(request)));}
export async function POST(request: Request) {return api(async () => json(await createEntry(request), {status: 201}));}

