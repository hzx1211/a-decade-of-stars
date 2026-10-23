import {test, expect, type APIRequestContext} from "@playwright/test";
import {credentials, login, origin, originalPng} from "./fixtures";

test("public flags never expose an entry or its media to anonymous requests", async ({page, playwright, request}) => {
  test.setTimeout(120_000);
  const owner: APIRequestContext = await playwright.request.newContext({baseURL: origin});
  const suffix = test.info().project.name;

  try {
    await login(owner);

    const upload = await owner.post("/api/assets", {
      headers: {Origin: origin},
      multipart: {file: {name: `private-${suffix}.png`, mimeType: "image/png", buffer: originalPng()}},
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const assetId = (await upload.json() as {asset: {id: string}}).asset.id;

    const createEntry = await owner.post("/api/entries", {
      headers: {Origin: origin},
      data: {
        kind: "photos",
        title: `标记公开但仍属私人的照片-${suffix}`,
        data: {assetId, description: "访问控制回归数据", notes: "仅所有者可读"},
        isPublic: true,
      },
    });
    expect(createEntry.status(), await createEntry.text()).toBe(201);
    const entryId = (await createEntry.json() as {entry: {id: string; isPublic: boolean; data: {assetId: string}}}).entry.id;

    const ownerEntry = await owner.get(`/api/entries/${entryId}`);
    expect(ownerEntry.status()).toBe(200);
    expect((await ownerEntry.json()).entry).toMatchObject({id: entryId, isPublic: true, data: {assetId}});
    expect((await owner.get(`/api/assets/${assetId}`)).status()).toBe(200);
    expect((await owner.head(`/api/assets/${assetId}`)).status()).toBe(200);

    expect((await request.get(`/api/entries/${entryId}`)).status()).toBe(401);
    expect((await request.head(`/api/entries/${entryId}`)).status()).toBe(401);
    expect((await request.get(`/api/assets/${assetId}`)).status()).toBe(401);
    expect((await request.head(`/api/assets/${assetId}`)).status()).toBe(401);

    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);

    await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
    await page.getByLabel("密码", {exact: true}).fill(credentials.password);
    await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", {name: "张杰", level: 1})).toBeVisible();
    expect((await owner.get(`/api/entries/${entryId}`)).status()).toBe(200);
    expect((await owner.get(`/api/assets/${assetId}`)).status()).toBe(200);
  } finally {
    await owner.dispose();
  }
});
