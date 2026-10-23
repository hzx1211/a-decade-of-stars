import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Entry, EntryKind } from "@/lib/types";
import { entryKinds } from "@/lib/types";
import { createEntrySchema, patchEntrySchema, patchSettingsSchema, settingsSchema } from "@/lib/validation/schemas";
import { assertSameOrigin, readJson } from "./security";
import { requireApiOwner } from "./auth";
import { getAssets, getEntries, getEntry, getSettings, getLocalState, removeEntry, saveEntry, saveSettings, saveLocalEntry, saveLocalSettings } from "./store";
import { entryReferences, validateReferences, validateSettingsReferences } from "./references";
import { AppError } from "./errors";
import { dataMode } from "./config";
import { getDatabase, transaction } from "./db";

export async function listEntries(request: Request) {
  const owner = await requireApiOwner(); const params = new URL(request.url).searchParams;
  const kind = params.get("kind"); if (kind && !entryKinds.includes(kind as EntryKind)) throw new AppError(400, "内容类型无效");
  const q = params.get("q") || undefined; if (q && q.length > 300) throw new AppError(400, "搜索条件过长");
  return {entries: await getEntries(owner.id, kind as EntryKind | undefined, q)};
}
export async function createEntry(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); const input = createEntrySchema.parse(await readJson(request));
  const now = new Date().toISOString(); const entry: Entry = {id: randomUUID(), ownerId: owner.id, kind: input.kind, title: input.title, data: input.data, favorite: input.favorite || false, isPublic: input.isPublic ?? false, createdAt: now, updatedAt: now};
  if (dataMode() === "local") {transaction(() => {const {entries, assets} = getLocalState(owner.id); validateReferences(entry, entries, assets); saveLocalEntry(entry);});}
  else {const [entries, assets] = await Promise.all([getEntries(owner.id), getAssets(owner.id)]); validateReferences(entry, entries, assets); await saveEntry(entry, true);}
  return {entry};
}
export async function updateEntry(request: Request, id: string) {
  assertSameOrigin(request); const owner = await requireApiOwner(); z.uuid().parse(id); const input = patchEntrySchema.parse(await readJson(request));
  const current = await getEntry(owner.id, id); const entry: Entry = {...current, ...input, updatedAt: new Date().toISOString()};
  if (dataMode() === "local") {transaction(() => {const {entries, assets} = getLocalState(owner.id); if (!entries.some(e => e.id === id)) throw new AppError(404, "记录不存在"); validateReferences(entry, entries, assets); saveLocalEntry(entry);});}
  else {const [entries, assets] = await Promise.all([getEntries(owner.id), getAssets(owner.id)]); validateReferences(entry, entries, assets); await saveEntry(entry);}
  return {entry};
}
export async function deleteEntry(request: Request, id: string) {
  assertSameOrigin(request); const owner = await requireApiOwner(); z.uuid().parse(id); await getEntry(owner.id, id);
  const check = (entries: Entry[], settings: Awaited<ReturnType<typeof getSettings>>) => {if (entries.some(e => e.id !== id && entryReferences(e).includes(id)) || settings.featuredIds.includes(id)) throw new AppError(409, "此记录仍被其他内容或首页精选引用，请先解除关联", "ENTRY_IN_USE");};
  if (dataMode() === "local") transaction(() => {const {entries, settings} = getLocalState(owner.id); check(entries, settings); getDatabase().prepare("DELETE FROM entries WHERE owner_id=? AND id=?").run(owner.id, id);});
  else {const [entries, settings] = await Promise.all([getEntries(owner.id), getSettings(owner.id)]); check(entries, settings); await removeEntry(owner.id, id);}
  return {ok: true};
}
export async function updateSettings(request: Request) {
  assertSameOrigin(request); const owner = await requireApiOwner(); const input = patchSettingsSchema.parse(await readJson(request));
  const complete = settingsSchema.safeParse(input);
  // A complete settings form replaces optional choices too, allowing the owner to return to the built-in portrait.
  const settings = complete.success ? complete.data : settingsSchema.parse({...await getSettings(owner.id), ...input}); const [entries, assets] = await Promise.all([getEntries(owner.id), getAssets(owner.id)]);
  if (dataMode() === "local") transaction(() => {const state = getLocalState(owner.id); validateSettingsReferences(owner.id, settings, state.entries, state.assets); saveLocalSettings(owner.id, settings);});
  else {validateSettingsReferences(owner.id, settings, entries, assets); await saveSettings(owner.id, settings);}
  return {settings};
}
