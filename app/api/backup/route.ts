import { api, json } from "@/lib/server/errors";
import { exportBackup, importBackup } from "@/lib/server/backup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {return api(async () => json(await exportBackup(), {headers: {"Content-Disposition": `attachment; filename="stars-metadata-backup-${new Date().toISOString().slice(0,10)}.json"`}}));}
export async function POST(request: Request) {return api(async () => json(await importBackup(request)));}

