import {test, expect, type APIRequestContext} from "@playwright/test";
import {credentials, originalPng, originalWav} from "./fixtures";

test("visitors read selected records and media and withdrawal works immediately", async ({page, playwright, request}, info) => {
  test.setTimeout(180_000);
  const origin = new URL(String(info.project.use.baseURL || "http://127.0.0.1:3001")).origin;
  const owner: APIRequestContext = await playwright.request.newContext({baseURL: origin});
  const suffix = info.project.name, records: string[] = [], files: string[] = [];
  const secret = `PRIVATE-NOTES-${suffix}`;
  async function create(title: string, kind: string, data: object, isPublic = false) {
    const response = await owner.post("/api/entries", {headers: {Origin: origin}, data: {kind, title, data, isPublic}});
    expect(response.status(), await response.text()).toBe(201);
    const entry = (await response.json()).entry; records.push(entry.id); return entry;
  }
  async function upload(name: string, mimeType: string, buffer: Buffer) {
    const response = await owner.post("/api/assets", {headers: {Origin: origin}, multipart: {file: {name, mimeType, buffer}}});
    expect(response.status(), await response.text()).toBe(201);
    const asset = (await response.json()).asset; files.push(asset.id); return asset;
  }
  try {
    const status = await (await owner.get("/api/auth/status")).json();
    const auth = await owner.post(status.setupRequired ? "/api/auth/setup" : "/api/auth/login", {headers: {Origin: origin}, data: credentials});
    expect(auth.ok(), await auth.text()).toBe(true);
    const publicImage = await upload(`original-selected-${suffix}.png`, "image/png", originalPng());
    const privateImage = await upload(`PRIVATE-FILENAME-${suffix}.png`, "image/png", originalPng());
    const privateEntry = await create(`未选中的私人照片-${suffix}`, "photos", {assetId: privateImage.id, description: secret});
    const draft = await create(`未发布的草稿-${suffix}`, "photos", {assetId: privateImage.id, status: "draft", description: secret}, true);
    const selected = await create(`访客精选原创照片-${suffix}`, "photos", {assetId: publicImage.id, description: "主动展示的原创测试图", notes: secret, relatedIds: [privateEntry.id], rightsHolder: "PRIVATE-RIGHTS-EVIDENCE"}, true);
    const audio = await upload(`original-selected-${suffix}.wav`, "audio/wav", originalWav());
    const song = await create(`访客精选原创音调-${suffix}`, "music", {assetId: audio.id, notes: secret}, true);
    const list = await request.get("/api/entries"); expect(list.status()).toBe(200);
    const serialized = await list.text();
    for (const hidden of [secret, privateEntry.id, privateEntry.title, draft.id, draft.title, "PRIVATE-RIGHTS-EVIDENCE", selected.ownerId]) expect(serialized).not.toContain(hidden);
    expect(serialized).toContain(selected.title);
    const publicRecord = await request.get(`/api/entries/${selected.id}`); expect(publicRecord.status()).toBe(200);
    expect((await publicRecord.json()).entry).toMatchObject({id: selected.id, ownerId: "", data: {relatedIds: []}});
    expect((await (await owner.get(`/api/entries/${selected.id}`)).json()).entry.data.notes).toBe(secret);
    for (const id of [privateEntry.id, draft.id]) expect((await request.get(`/api/entries/${id}`)).status()).toBe(404);
    expect((await (await request.get(`/api/entries?q=${secret}`)).json()).entries).toEqual([]);
    expect((await request.get(`/api/assets/${publicImage.id}`)).status()).toBe(200);
    expect((await request.head(`/api/assets/${publicImage.id}`)).status()).toBe(200);
    expect((await request.get(`/api/assets/${privateImage.id}`)).status()).toBe(404);
    expect((await request.head(`/api/assets/${privateImage.id}`)).status()).toBe(404);
    const range = await request.get(`/api/assets/${audio.id}`, {headers: {Range: "bytes=0-43"}});
    expect(range.status()).toBe(206); expect((await range.body()).length).toBe(44);
    expect(range.headers()["content-range"]).toBe(`bytes 0-43/${audio.size}`);
    const assetList = await (await request.get("/api/assets")).text();
    for (const hidden of [publicImage.filename, privateImage.id, selected.ownerId, publicImage.storagePath]) expect(assetList).not.toContain(hidden);
    expect((await request.get("/api/backup")).status()).toBe(401);
    expect((await request.post("/api/entries", {headers: {Origin: origin}, data: {kind: "journal", title: "unauthorized", data: {}}})).status()).toBe(401);
    expect((await request.patch(`/api/entries/${selected.id}`, {headers: {Origin: origin}, data: {isPublic: false}})).status()).toBe(401);
    await page.goto("/app/photos");
    await expect(page.getByRole("button", {name: selected.title, exact: true})).toBeVisible();
    await expect(page.getByTestId("entry-create")).toHaveCount(0);
    await expect(page.getByRole("button", {name: /编辑记录|删除记录/})).toHaveCount(0);
    await expect(page.getByRole("link", {name: /网站设置|数据备份/})).toHaveCount(0);
    expect(await page.content()).not.toContain(secret);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: info.outputPath("visitor-collection.png"), fullPage: true});
    await page.goto("/app/settings");
    await expect(page.getByTestId("entry-create")).toHaveCount(0);
    await expect(page.locator(".ws-settings")).toHaveCount(0);
    await expect(page.getByRole("heading", {name: "这颗星，暂时不在这里。", exact: true})).toBeVisible();
    await page.goto("/login");
    await expect(page.getByRole("link", {name: /以访客身份浏览/})).toBeVisible();
    await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
    await page.getByLabel("密码", {exact: true}).fill(credentials.password);
    await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await page.goto(`/app/photos/${selected.id}`);
    await page.getByRole("button", {name: "编辑记录", exact: true}).click();
    await page.getByRole("dialog").getByRole("checkbox", {name: "公开给访客", exact: true}).uncheck();
    await page.getByTestId("entry-save").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await request.get(`/api/entries/${selected.id}`)).status()).toBe(404);
    expect((await request.get(`/api/assets/${publicImage.id}`)).status()).toBe(404);
    expect((await owner.get(`/api/assets/${publicImage.id}`)).status()).toBe(200);
    expect((await owner.patch(`/api/entries/${selected.id}`, {headers: {Origin: origin}, data: {isPublic: true}})).ok()).toBe(true);
    expect((await request.get(`/api/entries/${selected.id}`)).status()).toBe(200);
    expect((await request.get(`/api/assets/${publicImage.id}`)).status()).toBe(200);
    expect((await request.get(`/api/entries/${song.id}`)).status()).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    for (const id of [...records].reverse()) await owner.delete(`/api/entries/${id}`, {headers: {Origin: origin}});
    for (const id of files) await owner.delete(`/api/assets/${id}`, {headers: {Origin: origin}});
    await owner.dispose();
  }
});
