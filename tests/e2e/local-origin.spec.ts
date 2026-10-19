import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readFile, rename} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type Page} from "@playwright/test";
import {originalPng} from "./fixtures";

const localOrigin = "http://127.0.0.1:3002";
const evidenceDirectory = path.join(process.cwd(), "verification");
const themeMediaDirectory = path.join(process.env.STARS_DATA_DIR ?? "", "theme-media");
const themeMediaFiles = [
  {kind: "stage", fileName: "stage.jpg", contentType: "image/jpeg", signature: [255, 216, 255], orientation: "landscape"},
  {kind: "beidou", fileName: "beidou.jpg", contentType: "image/jpeg", signature: [255, 216, 255], orientation: "portrait"},
  {kind: "v-reference", fileName: "v-reference.png", contentType: "image/png", signature: [137, 80, 78, 71]},
] as const;
const publicRoutes = ["/", "/login", "/privacy", "/copyright", "/not-official"] as const;

async function checkPublicBrand(page: Page, minimumHeroSize: number) {
  let expectedSilhouette: string | null = null;
  for (const route of publicRoutes) {
    await page.goto(route);
    const marks = page.locator("svg.v-mark");
    await expect(marks.first()).toBeVisible();
    const signatures = await marks.evaluateAll(elements => elements.map(element => ({
      viewBox: element.getAttribute("viewBox"),
      silhouette: element.querySelector("path")?.getAttribute("d") ?? null,
    })));
    expect(signatures.length).toBeGreaterThan(0);
    for (const signature of signatures) {
      expect(signature.viewBox).toBe("130 270 880 750");
      expect(signature.silhouette).toBeTruthy();
      if (expectedSilhouette === null) expectedSilhouette = signature.silhouette;
      else expect(signature.silhouette).toBe(expectedSilhouette);
    }

    const heroMark = route === "/" ? page.locator(".stage-landing-v") : route === "/login" ? page.locator(".stage-login-v") : null;
    if (heroMark) {
      await expect(heroMark).toBeVisible();
      const bounds = await heroMark.evaluate(element => {
        const {width, height} = element.getBoundingClientRect();
        return {width, height};
      });
      expect(bounds.width).toBeGreaterThanOrEqual(minimumHeroSize);
      expect(bounds.height).toBeGreaterThanOrEqual(minimumHeroSize);
    }
  }
  return expectedSilhouette;
}

async function rejectSetupFromOrigin(request: APIRequestContext, origin?: string) {
  const headers: Record<string, string> = {"Content-Type": "application/json"};
  if (origin) headers.Origin = origin;
  const response = await request.post("/api/auth/setup", {headers, data: "{"});
  expect(response.status()).toBe(403);
}

async function checkNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function saveHomeVisual(page: Page, desktopId: string, mobileId = "", position = "center") {
  await page.goto("/app/settings#home-visual");
  await page.getByLabel("桌面背景照片", {exact: true}).selectOption(desktopId);
  await page.getByLabel("手机背景照片", {exact: true}).selectOption(mobileId);
  await page.getByLabel("背景裁剪对齐", {exact: true}).selectOption(position);
  await page.getByRole("button", {name: "保存网站设置", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("网站设置已保存。");
  await page.goto("/app/dashboard");
}

async function assertServerSession(email: string, expectedCount: number) {
  const directory = process.env.STARS_DATA_DIR;
  if (!directory) throw new Error("The isolated local-origin data directory is not configured");
  const db = new DatabaseSync(path.join(directory, "museum.sqlite"), {readOnly: true});
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM sessions JOIN owners ON owners.id=sessions.owner_id WHERE owners.email=?").get(email) as {count: number};
    expect(row.count).toBe(expectedCount);
  } finally {
    db.close();
  }
}

async function signIn(page: Page, email: string, password: string, creatingOwner: boolean) {
  await page.goto("/login");
  await checkNoHorizontalOverflow(page);
  await page.getByLabel("邮箱", {exact: true}).fill(email);
  await page.getByLabel("密码", {exact: true}).fill(password);
  await page.getByRole("button", {name: creatingOwner ? "创建我的私人纪念馆" : "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.getByRole("heading", {name: /张杰/, level: 1})).toBeVisible();
  await checkNoHorizontalOverflow(page);
}

test("empty APP_ORIGIN accepts the real local origin and rejects untrusted origins", async ({browser, playwright}) => {
  test.setTimeout(120_000);
  await mkdir(evidenceDirectory, {recursive: true});

  const anonymous = await playwright.request.newContext({baseURL: localOrigin});
  const initialStatus = await (await anonymous.get("/api/auth/status")).json();
  expect(initialStatus).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
  expect((await anonymous.get("/api/entries")).status()).toBe(401);
  expect((await anonymous.get("/api/artist-portrait")).status()).toBe(401);
  expect((await anonymous.head("/api/artist-portrait")).status()).toBe(401);
  expect((await anonymous.get("/api/artist-portrait", {headers: {Cookie: "stars_owner_session=forged-token"}})).status()).toBe(401);
  for (const {kind} of themeMediaFiles) {
    const route = `/api/theme-media/${kind}`;
    expect((await anonymous.get(route)).status()).toBe(401);
    expect((await anonymous.head(route)).status()).toBe(401);
    expect((await anonymous.get(route, {headers: {Cookie: "stars_owner_session=forged-token"}})).status()).toBe(401);
    expect((await anonymous.head(route, {headers: {Cookie: "stars_owner_session=forged-token"}})).status()).toBe(401);
  }
  for (const kind of ["poster", "original-poster", "original-beidou", "original-stage", "original-companion"]) {
    expect((await anonymous.get(`/api/theme-media/${kind}`)).status()).toBe(401);
    expect((await anonymous.head(`/api/theme-media/${kind}`)).status()).toBe(401);
  }
  for (const publicPath of [
    "/theme-media/poster.jpg",
    "/theme-media/stage.jpg",
    "/theme-media/beidou.jpg",
    "/theme-media/v-reference.png",
    "/theme-media/original-poster.png",
    "/theme-media/original-beidou.png",
    "/theme-media/original-stage.png",
    "/theme-media/original-companion.png",
    "/assets/theme-media/stage.jpg",
  ]) {
    expect((await anonymous.get(publicPath)).status()).toBe(404);
  }
  expect((await anonymous.get("/assets/licensed/zhang-jie.jpg")).status()).toBe(404);

  // Malformed bodies ensure these probes cannot create an owner if origin validation regresses.
  await rejectSetupFromOrigin(anonymous);
  await rejectSetupFromOrigin(anonymous, "https://evil.example");
  await rejectSetupFromOrigin(anonymous, "http://127.0.0.1:3003");
  await rejectSetupFromOrigin(anonymous, "http://localhost:3002");
  expect((await (await anonymous.get("/api/auth/status")).json()).setupRequired).toBe(true);

  // These fictional values exist only in memory during this run and are never printed or captured.
  const email = `owner-${randomUUID()}@example.test`;
  const password = `Local-test-${randomUUID()}-Aa9!`;
  const desktopContext = await browser.newContext({...devices["Desktop Chrome"], viewport: {width: 1440, height: 1000}, baseURL: localOrigin});
  const desktop = await desktopContext.newPage();
  const mobileContext = await browser.newContext({...devices["Pixel 7"], baseURL: localOrigin});
  const mobile = await mobileContext.newPage();
  try {
    const desktopSilhouette = await checkPublicBrand(desktop, 260);
    expect(await checkPublicBrand(mobile, 160)).toBe(desktopSilhouette);
    await signIn(desktop, email, password, true);
    expect((await (await desktop.request.get("/api/auth/status")).json()).authenticated).toBe(true);
    expect(await desktop.evaluate(() => document.cookie)).not.toContain("stars_owner_session=");
    await assertServerSession(email, 1);
    for (const kind of ["poster", "original-poster", "original-poster.png", "original-beidou", "original-beidou.png", "original-stage", "original-companion", "original-stage.png", "original-companion.png"]) {
      expect((await desktop.request.get(`/api/theme-media/${kind}`)).status()).toBe(404);
      expect((await desktop.request.head(`/api/theme-media/${kind}`)).status()).toBe(404);
    }
    const portrait = await desktop.request.get("/api/artist-portrait");
    expect(portrait.ok()).toBe(true);
    expect(portrait.headers()["content-type"]).toBe("image/jpeg");
    expect(portrait.headers()["cache-control"]).toBe("private, no-store");
    expect((await portrait.body()).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));

    const availableThemeMedia: string[] = [];
    for (const item of themeMediaFiles) {
      const response = await desktop.request.get(`/api/theme-media/${item.kind}`);
      const fileExists = existsSync(path.join(themeMediaDirectory, item.fileName));
      if (!fileExists) {
        expect(response.status()).toBe(404);
        continue;
      }
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toBe(item.contentType);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      const bytes = await response.body();
      expect([...bytes.subarray(0, item.signature.length)]).toEqual(item.signature);
      expect((await desktop.request.head(`/api/theme-media/${item.kind}`)).status()).toBe(200);
      availableThemeMedia.push(`/api/theme-media/${item.kind}`);
    }
    if (existsSync(path.join(themeMediaDirectory, "stage.jpg"))) {
      const privateStage = await desktop.request.get("/api/theme-media/stage");
      expect(await portrait.body()).toEqual(await privateStage.body());
    }
    if (availableThemeMedia.length) {
      const decodedThemeImages = await desktop.evaluate(async (sources) => Promise.all(sources.map(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return {src, width: image.naturalWidth, height: image.naturalHeight};
      })), availableThemeMedia);
      expect(decodedThemeImages).toHaveLength(availableThemeMedia.length);
      for (const image of decodedThemeImages) {
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        const item = themeMediaFiles.find(themeImage => `/api/theme-media/${themeImage.kind}` === image.src);
        if (item && "orientation" in item) {
          if (item.orientation === "landscape") expect(image.width).toBeGreaterThan(image.height);
          if (item.orientation === "portrait") expect(image.height).toBeGreaterThan(image.width);
        }
      }
    }
    const hero = desktop.locator(".concert-portrait img");
    await expect.poll(() => hero.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(300);
    if (existsSync(path.join(themeMediaDirectory, "stage.jpg"))) {
      expect(await hero.evaluate(element => getComputedStyle(element).objectFit)).toBe("contain");
    }
    if (existsSync(path.join(themeMediaDirectory, "beidou.jpg"))) {
      const companion = desktop.locator(".concert-beidou-photo img");
      await companion.scrollIntoViewIfNeeded();
      await expect.poll(() => companion.evaluate(element => (element as HTMLImageElement).naturalHeight)).toBeGreaterThan(0);
      const dimensions = await companion.evaluate(element => ({
        width: (element as HTMLImageElement).naturalWidth,
        height: (element as HTMLImageElement).naturalHeight,
        objectFit: getComputedStyle(element).objectFit,
      }));
      expect(dimensions.height).toBeGreaterThan(dimensions.width);
      expect(dimensions.objectFit).toBe("contain");
    }

    const stagePath = path.join(themeMediaDirectory, "stage.jpg");
    if (existsSync(stagePath)) {
      const parkedStagePath = path.join(themeMediaDirectory, `.stage-temporarily-unavailable-${randomUUID()}`);
      await rename(stagePath, parkedStagePath);
      try {
        const fallback = await desktop.request.get("/api/artist-portrait");
        expect(fallback.ok()).toBe(true);
        expect(await fallback.body()).toEqual(await readFile(path.join(process.cwd(), "assets", "licensed", "zhang-jie.jpg")));
        if (existsSync(path.join(themeMediaDirectory, "beidou.jpg"))) {
          expect((await desktop.request.get("/api/theme-media/beidou")).status()).toBe(200);
        }
      } finally {
        await rename(parkedStagePath, stagePath);
      }
    }

    await desktop.getByRole("button", {name: "退出登录", exact: true}).click();
    await expect(desktop).toHaveURL(/\/login\/?$/);
    expect((await (await desktop.request.get("/api/auth/status")).json()).authenticated).toBe(false);
    await assertServerSession(email, 0);

    await signIn(desktop, email, password, false);
    expect((await (await desktop.request.get("/api/auth/status")).json()).authenticated).toBe(true);
    await assertServerSession(email, 1);
    await expect.poll(() => desktop.locator(".concert-portrait img").evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(300);
    await desktop.screenshot({path: path.join(evidenceDirectory, "local-origin-desktop-dashboard.png"), fullPage: true, animations: "disabled"});
    await desktop.screenshot({path: path.join(evidenceDirectory, "concert-desktop.png"), animations: "disabled"});

    const uploadFixture = async (name: string) => {
      const response = await desktop.request.post("/api/assets", {headers: {Origin: localOrigin}, multipart: {file: {name, mimeType: "image/png", buffer: originalPng()}}});
      expect(response.ok()).toBe(true);
      return (await response.json()).asset.id as string;
    };
    const desktopImage = await uploadFixture("original-home-desktop.png");
    const mobileImage = await uploadFixture("original-home-mobile.png");
    await saveHomeVisual(desktop, desktopImage, mobileImage, "right");
    await expect.poll(() => desktop.locator(".concert-portrait img").evaluate(element => (element as HTMLImageElement).currentSrc)).toContain(`/api/assets/${desktopImage}`);
    expect(await desktop.locator(".concert-portrait img").evaluate(element => getComputedStyle(element).objectPosition)).toBe("100% 50%");
    await checkNoHorizontalOverflow(desktop);

    await signIn(mobile, email, password, false);
    expect((await (await mobile.request.get("/api/auth/status")).json()).authenticated).toBe(true);
    await expect.poll(() => mobile.locator(".concert-portrait img").evaluate(element => (element as HTMLImageElement).currentSrc)).toContain(`/api/assets/${mobileImage}`);
    await saveHomeVisual(desktop, "");
    const persisted = (await (await desktop.request.get("/api/settings")).json()).settings;
    expect(persisted.heroAssetId).toBeUndefined();
    expect(persisted.mobileHeroAssetId).toBeUndefined();
    await expect.poll(() => desktop.locator(".concert-portrait img").evaluate(element => (element as HTMLImageElement).currentSrc)).toContain("/api/artist-portrait");
    await mobile.reload();
    await expect.poll(() => mobile.locator(".concert-portrait img").evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(300);
    await expect.poll(() => mobile.locator(".concert-portrait img").evaluate(element => (element as HTMLImageElement).currentSrc)).toContain("/api/artist-portrait");
    await checkNoHorizontalOverflow(mobile);
    await mobile.screenshot({path: path.join(evidenceDirectory, "local-origin-mobile-dashboard.png"), fullPage: true, animations: "disabled"});
    await mobile.screenshot({path: path.join(evidenceDirectory, "concert-mobile.png"), animations: "disabled"});
    await desktop.goto("/app/settings#home-visual");
    await expect.poll(() => desktop.getByRole("img", {name: /桌面背景预览/}).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(300);
    await desktop.screenshot({path: path.join(evidenceDirectory, "concert-photo-settings.png"), animations: "disabled"});
    await desktop.getByLabel("界面主题", {exact: true}).selectOption("paper");
    await desktop.getByRole("button", {name: "保存网站设置", exact: true}).click();
    await expect(desktop.getByRole("status")).toContainText("网站设置已保存。");
    await desktop.goto("/app/dashboard");
    await checkNoHorizontalOverflow(desktop);
    await desktop.screenshot({path: path.join(evidenceDirectory, "concert-paper.png"), animations: "disabled"});
  } finally {
    await desktopContext.close();
    await mobileContext.close();
    await anonymous.dispose();
  }
});
