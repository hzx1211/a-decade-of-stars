import {test, expect, type APIRequestContext} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import path from "node:path";
import {credentials, login, origin, originalPng, originalWav} from "./fixtures";
import type {Asset, Entry} from "../../lib/types";

let owner: APIRequestContext;
const mutationHeaders = {Origin: origin};
async function create(kind: string, title: string, data: object = {}): Promise<Entry> {
  const response = await owner.post("/api/entries", {headers: mutationHeaders, data: {kind,title,data}});
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).entry;
}
async function upload(name: string, mimeType: string, buffer: Buffer): Promise<Asset> {
  const response = await owner.post("/api/assets", {headers: mutationHeaders, multipart: {file: {name,mimeType,buffer}}});
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).asset;
}

test.beforeAll(async ({playwright}) => {
  owner = await playwright.request.newContext({baseURL: origin});
  const status = await (await owner.get("/api/auth/status")).json();
  if (status.setupRequired) {
    const rejected = await owner.post("/api/auth/setup", {headers: {...mutationHeaders,"X-Forwarded-For": "203.0.113.10"}, data: credentials});
    expect(rejected.status()).toBe(403);
  }
  await login(owner);
});
test.afterAll(async () => {await owner.dispose();});

test("anonymous and forged sessions cannot read or mutate private records", async ({request}) => {
  for (const route of ["/api/entries","/api/assets","/api/settings","/api/backup"]) expect((await request.get(route)).status()).toBe(401);
  expect((await request.post("/api/entries", {headers: mutationHeaders, data: {kind:"journal",title:"intrusion",data:{}}})).status()).toBe(401);
  expect((await request.get("/api/entries", {headers: {Cookie: "stars_owner_session=forged-token"}})).status()).toBe(401);
  const page = await request.get("/app/journal", {maxRedirects: 0});
  // Next.js may begin streaming before a server redirect, then emit a redirect meta.
  if(page.status()===200) expect(await page.text()).toMatch(/http-equiv="refresh"[^>]+\/login|NEXT_REDIRECT/);
  else {expect([302,303,307,308]).toContain(page.status());expect(page.headers().location).toContain("/login");}
});

test("the owner is unique and cross-origin writes are denied", async ({request}) => {
  expect((await owner.post("/api/auth/setup", {headers: mutationHeaders, data: credentials})).status()).toBe(409);
  expect((await request.post("/api/auth/login", {headers: mutationHeaders, data: {...credentials,email:"second-user@example.test"}})).status()).toBe(401);
  expect((await owner.post("/api/entries", {headers: {Origin:"https://evil.example"}, data:{kind:"journal",title:"bad",data:{}}})).status()).toBe(403);
  expect((await owner.post("/api/entries", {data:{kind:"journal",title:"bad",data:{}}})).status()).toBe(403);
});

test("real CRUD, ownership injection, immutable kinds and related-delete protection", async () => {
  const album = await create("albums","API 原创专辑测试");
  const music = await create("music","API 原创音调测试",{albumId:album.id,description:"仅用于自动验收"});
  expect((await owner.post("/api/entries", {headers:mutationHeaders,data:{kind:"journal",title:"bad",data:{},ownerId:randomUUID()}})).status()).toBe(400);
  expect((await owner.patch(`/api/entries/${music.id}`, {headers:mutationHeaders,data:{ownerId:randomUUID()}})).status()).toBe(400);
  expect((await owner.patch(`/api/entries/${music.id}`, {headers:mutationHeaders,data:{kind:"journal"}})).status()).toBe(400);
  expect((await owner.post("/api/entries", {headers:mutationHeaders,data:{kind:"music",title:"missing",data:{albumId:randomUUID()}}})).status()).toBe(400);
  expect((await owner.delete(`/api/entries/${album.id}`, {headers:mutationHeaders})).status()).toBe(409);
  const edited = await owner.patch(`/api/entries/${music.id}`, {headers:mutationHeaders,data:{title:"API 更新后的原创音调",favorite:true,data:{description:"更新笔记"}}});
  expect(edited.ok()).toBe(true); expect((await edited.json()).entry.ownerId).toBe(music.ownerId);
  expect((await owner.get("/api/entries?q="+encodeURIComponent("更新后的原创"))).ok()).toBe(true);
  expect((await owner.delete(`/api/entries/${album.id}`, {headers:mutationHeaders})).ok()).toBe(true);
  expect((await owner.delete(`/api/entries/${music.id}`, {headers:mutationHeaders})).ok()).toBe(true);
  expect((await owner.get(`/api/entries/${music.id}`)).status()).toBe(404);
});

test("upload rejects forged file signatures, unsupported content and configured size", async () => {
  const bad = {name:"pretend.png",mimeType:"image/png",buffer:Buffer.from("this is not a PNG")};
  expect((await owner.post("/api/assets", {headers:mutationHeaders,multipart:{file:bad}})).status()).toBe(415);
  expect((await owner.post("/api/assets", {headers:mutationHeaders,multipart:{file:{name:"script.svg",mimeType:"image/svg+xml",buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')}}})).status()).toBe(415);
  const previous=(await (await owner.get("/api/settings")).json()).settings;
  expect((await owner.patch("/api/settings", {headers:mutationHeaders,data:{imageLimitMb:1}})).ok()).toBe(true);
  const large=Buffer.concat([originalPng(),Buffer.alloc(1024*1024+1)]);
  expect((await owner.post("/api/assets", {headers:mutationHeaders,multipart:{file:{name:"large.png",mimeType:"image/png",buffer:large}}})).status()).toBe(413);
  expect((await owner.patch("/api/settings", {headers:mutationHeaders,data:{imageLimitMb:previous.imageLimitMb}})).ok()).toBe(true);
});

test("file-only uploads stay private without invented proof and retain legacy metadata", async () => {
  const image = await upload("private-file-only.png", "image/png", originalPng());
  expect(image).toMatchObject({rightsStatus: "personal_only"});
  expect(image.rightsHolder).toBeUndefined(); expect(image.licenseNotes).toBeUndefined();
  expect(image.allowedUseScope).toContain("private_storage");
  const legacy = await owner.post("/api/assets", {headers: mutationHeaders, multipart: {rightsStatus: "unknown", file: {name: "legacy-unknown.png", mimeType: "image/png", buffer: originalPng()}}});
  expect(legacy.status(), await legacy.text()).toBe(201);
  expect((await legacy.json()).asset.rightsStatus).toBe("unknown");
});

test("original media bytes remain private, support real Range reads and guard references", async ({request}) => {
  const audio=await upload("original-tone.wav","audio/wav",originalWav());
  const image=await upload("original-stars.png","image/png",originalPng());
  const response=await owner.get(`/api/assets/${audio.id}`,{headers:{Range:"bytes=0-43"}});
  expect(response.status()).toBe(206); expect(response.headers()["content-range"]).toBe(`bytes 0-43/${audio.size}`);
  expect((await response.body()).subarray(0,4).toString()).toBe("RIFF"); expect((await response.body()).length).toBe(44);
  expect((await owner.get(`/api/assets/${audio.id}`,{headers:{Range:`bytes=${audio.size}-`}})).status()).toBe(416);
  expect((await request.get(`/api/assets/${audio.id}`)).status()).toBe(401);
  const photo=await create("photos","API 原创照片测试",{assetId:image.id});
  expect((await owner.delete(`/api/assets/${image.id}`,{headers:mutationHeaders})).status()).toBe(409);
  expect((await owner.patch(`/api/assets/${image.id}`,{headers:mutationHeaders,data:{rightsHolder:"原创测试作者",licenseNotes:"原创图形，仅测试用途"}})).ok()).toBe(true);
  expect((await owner.delete(`/api/entries/${photo.id}`,{headers:mutationHeaders})).ok()).toBe(true);
  expect((await owner.delete(`/api/assets/${image.id}`,{headers:mutationHeaders})).ok()).toBe(true);
  expect((await owner.get(`/api/assets/${image.id}`)).status()).toBe(404);
});

test("backup preview, confirmation, merge restore and missing binaries are real", async () => {
  const journal=await create("journal","API 备份恢复原创日记",{description:"恢复前的原始内容",year:2009});
  const backup=await (await owner.get("/api/backup")).json();
  expect(backup.version).toBe(1); expect(backup.mediaFilesIncluded).toBe(false);
  const preview=await owner.post("/api/backup",{headers:mutationHeaders,data:{action:"preview",backup}});
  expect(preview.ok()).toBe(true); expect((await preview.json()).preview.entries.updated).toBeGreaterThan(0);
  expect((await owner.post("/api/backup",{headers:mutationHeaders,data:{action:"restore",backup}})).status()).toBe(400);
  const invalid=structuredClone(backup); invalid.entries.find((e:Entry)=>e.id===journal.id).data.relatedIds=[randomUUID()];
  expect((await owner.post("/api/backup",{headers:mutationHeaders,data:{action:"restore",backup:invalid,confirmed:true}})).status()).toBe(400);
  const missing=structuredClone(backup); const absent={...missing.assets[0],id:randomUUID()}; absent.storagePath=`${journal.ownerId}/${absent.id}.wav`; missing.assets.push(absent);
  const missingPreview=await owner.post("/api/backup",{headers:mutationHeaders,data:{action:"preview",backup:missing}});
  expect((await missingPreview.json()).preview.missingMedia).toContain(absent.id);
  expect((await owner.post("/api/backup",{headers:mutationHeaders,data:{action:"restore",backup:missing,confirmed:true}})).status()).toBe(409);
  await owner.patch(`/api/entries/${journal.id}`,{headers:mutationHeaders,data:{title:"临时修改"}});
  expect((await owner.post("/api/backup",{headers:mutationHeaders,data:{action:"restore",backup,confirmed:true}})).ok()).toBe(true);
  expect((await (await owner.get(`/api/entries/${journal.id}`)).json()).entry.title).toBe(journal.title);
  const connection=new DatabaseSync(path.join(process.env.STARS_E2E_DATA_DIR!,"museum.sqlite"),{readOnly:true});
  const disk=connection.prepare("select title,owner_id from entries where id=?").get(journal.id); connection.close();
  expect(disk).toEqual({title:journal.title,owner_id:journal.ownerId});
});

test("logout invalidates the actual server session", async () => {
  expect((await owner.post("/api/auth/logout",{headers:mutationHeaders,data:{}})).ok()).toBe(true);
  expect((await owner.get("/api/entries")).status()).toBe(401);
});
