import { z } from "zod";
import { api, json } from "@/lib/server/errors";
import { currentOwner } from "@/lib/server/auth";
import { getEntry, getPublicEntry } from "@/lib/server/store";
import { updateEntry, deleteEntry } from "@/lib/server/content";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{id: string}>};
export async function GET(_request: Request, context: Context) {return api(async () => {const owner = await currentOwner(); const {id} = await context.params; z.uuid().parse(id); return json({entry: owner ? await getEntry(owner.id, id) : await getPublicEntry(id)});});}
export async function PATCH(request: Request, context: Context) {return api(async () => json(await updateEntry(request, (await context.params).id)));}
export async function DELETE(request: Request, context: Context) {return api(async () => json(await deleteEntry(request, (await context.params).id)));}

