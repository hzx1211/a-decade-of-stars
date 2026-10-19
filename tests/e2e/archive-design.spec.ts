import {mkdir} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type Browser, type Page} from "@playwright/test";
import type {Entry, EntryKind} from "../../lib/types";

const origin = "http://127.0.0.1:3004";
const evidenceDirectory = path.resolve("verification");
const routes = ["music", "albums", "videos", "photos", "journey", "timeline", "concerts", "journal", "letters", "memory-book", "calendar", "star-map", "archive", "admin", "search", "settings"] as const;
const desktopViewport = {width: 1440, height: 1000};
const mobileViewport = {width: 390, height: 844};
const screenshotRoutes = new Set(["music", "settings", "journey", "calendar", "star-map", "search", "archive", "admin"]);
let owner: APIRequestContext;
let email: string;
let password: string;
let albumEntry: Entry;
let musicEntry: Entry;
let secondMusicEntry: Entry;

async function create(kind: EntryKind, title: string, data: Entry["data"] = {}, favorite = false) {
  const response = await owner.post("/api/entries", {headers: {Origin: origin}, data: {kind, title, data, favorite}});
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).entry as Entry;
}

async function signIn(page: Page) {
  let loginRequestSeen = false;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/auth/login") loginRequestSeen = true;
  });
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(email);
  await page.getByLabel("密码", {exact: true}).fill(password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.locator("#main-content h1").first()).toBeVisible();
  expect(loginRequestSeen).toBe(true);
  expect((await (await page.request.get("/api/auth/status")).json()).authenticated).toBe(true);
}

async function noOverflow(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth}));
  expect(dimensions.viewport).toBe(width);
  expect(dimensions.document, `document overflowed ${width}px viewport: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(width + 1);
  expect(dimensions.body, `body overflowed ${width}px viewport: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(width + 1);
}

async function inspectRoute(page: Page, route: string, width: number) {
  await page.goto(`/app/${route}`);
  await expect(page).toHaveURL(new RegExp(`/app/${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));
  const heading = page.locator("#main-content h1").first();
  await expect(heading).toBeVisible();
  expect((await heading.innerText()).trim().length).toBeGreaterThan(1);
  const mainText = await page.locator("#main-content").innerText();
  expect(mainText.trim().length, `${route} did not render meaningful page content`).toBeGreaterThan(20);
  await noOverflow(page, width);
}

async function canvasFrame(page: Page) {
  const canvas = page.locator(".starsea-backdrop canvas.starsea-audience");
  await expect(canvas).toBeVisible();
  const frame = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL("image/png"));
  expect(frame.length).toBeGreaterThan(100);
  return frame;
}

async function makeContext(browser: Browser, viewport: {width: number; height: number}, reducedMotion: "reduce" | "no-preference" = "no-preference", mobile = false) {
  const context = await browser.newContext({
    ...(mobile ? devices["iPhone 13"] : devices["Desktop Chrome"]),
    viewport,
    reducedMotion,
    baseURL: origin,
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  return {context, page, pageErrors};
}

test.describe.serial("authenticated archive redesign", () => {
  test.beforeAll(async ({playwright}) => {
    const dataDirectory = process.env.STARS_ARCHIVE_DATA_DIR;
    const relativeDirectory = dataDirectory ? path.relative(path.resolve(".test-data"), path.resolve(dataDirectory)) : "";
    if (!relativeDirectory.startsWith("archive-design-") || path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) {
      throw new Error("Archive browser checks require their isolated .test-data directory");
    }
    email = process.env.STARS_ARCHIVE_OWNER_EMAIL ?? "";
    password = process.env.STARS_ARCHIVE_OWNER_PASSWORD ?? "";
    if (!email || !password) throw new Error("The isolated archive test owner was not configured");

    owner = await playwright.request.newContext({baseURL: origin});
    const status = await (await owner.get("/api/auth/status")).json();
    expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
    const setup = await owner.post("/api/auth/setup", {headers: {Origin: origin}, data: {email, password}});
    expect(setup.ok(), await setup.text()).toBe(true);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    albumEntry = await create("albums", "界面验收样本·专辑", {description: "仅用于本地自动化界面验收的合成内容。"});
    musicEntry = await create("music", "界面验收样本·歌曲", {
      albumId: albumEntry.id,
      artist: "自动化验收占位",
      category: "单曲",
      date: "2009",
      datePrecision: "year",
      year: 2009,
      description: "合成验收记录，不代表真实作品资料或个人回忆。",
      tags: ["界面验收", "筛选样本"],
    });
    secondMusicEntry = await create("music", "界面验收样本·另一首歌曲", {category: "单曲", year: 2010, description: "仅供筛选与收藏交互的自动化占位内容。"});
    await create("journey", "界面验收样本·星途章节", {year: 2009, date: "2009", datePrecision: "year", description: "本地自动化界面验收占位内容。"});
    await create("milestones", "界面验收样本·日历事项", {date: today, datePrecision: "day", year: now.getFullYear(), scheduledDate: today, category: "纪念日", description: "仅用于日历界面的自动化验收。"});
    for (let index = 1; index <= 12; index++) {
      await create("journal", `界面验收样本·补充星点 ${String(index).padStart(2, "0")}`, {description: "仅用于星图默认星点数量与搜索的合成验收内容。"});
    }
  });

  test.afterAll(async () => {await owner?.dispose();});

  test("desktop navigation, route coverage, real filtering, details, editor and retained exits", async ({browser}) => {
    test.setTimeout(180_000);
    await mkdir(evidenceDirectory, {recursive: true});
    const {context, page, pageErrors} = await makeContext(browser, desktopViewport);
    try {
      await signIn(page);
      await noOverflow(page, desktopViewport.width);
      await page.screenshot({path: path.join(evidenceDirectory, "archive-home.png"), fullPage: true, animations: "disabled"});
      const desktopNav = page.getByRole("navigation", {name: "主导航"});
      await expect(desktopNav).toBeVisible();
      await expect(desktopNav.getByRole("link", {name: "纪念馆首页"})).toHaveAttribute("aria-current", "page");
      for (const link of await desktopNav.getByRole("link").all()) {
        await expect(link).toBeVisible();
        const style = await link.evaluate(element => ({fontSize: Number.parseFloat(getComputedStyle(element).fontSize), color: getComputedStyle(element).color}));
        expect(style.fontSize).toBeGreaterThanOrEqual(12);
        expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
      }

      const moreButton = page.getByRole("button", {name: /更多珍藏/});
      await moreButton.click();
      const moreMenu = page.locator("#archive-more-navigation");
      await expect(moreButton).toHaveAttribute("aria-expanded", "true");
      await expect(moreMenu.getByRole("link", {name: "综合典藏馆"})).toBeVisible();
      await page.screenshot({path: path.join(evidenceDirectory, "archive-nav-menu-desktop.png"), animations: "disabled"});
      await page.keyboard.press("Escape");
      await expect(moreButton).toBeFocused();
      await expect(moreButton).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => moreMenu.getAttribute("data-state"), {intervals: [5, 10, 20, 30, 40]}).toBe("closing");
      await expect(moreMenu).toHaveCount(0);

      for (const route of routes) {
        await inspectRoute(page, route, desktopViewport.width);
        await page.waitForTimeout(120);
        await page.screenshot({path: path.join(evidenceDirectory, `archive-${route}.png`), fullPage: true, animations: "disabled"});
      }

      await page.goto("/app/star-map");
      const pickerToggle = page.getByRole("button", {name: /选择星点/});
      if (await pickerToggle.getAttribute("aria-expanded") !== "true") await pickerToggle.click();
      const allStarRows = page.locator("#star-record-picker .ws-selection-list label");
      await expect(allStarRows).toHaveCount(17);
      const initialStarStates = await allStarRows.evaluateAll(rows => rows.map(row => ({text: row.textContent?.trim() || "", checked: (row.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked ?? false})));
      const initialSelectedCount = initialStarStates.filter(row => row.checked).length;
      expect(initialSelectedCount).toBe(16);
      const starSearch = page.getByRole("textbox", {name: "搜索星点记录"});
      await starSearch.fill("歌曲");
      const matchingStars = page.locator("#star-record-picker .ws-selection-list label");
      await expect(matchingStars).toHaveCount(2);
      await expect(page.locator("#star-record-picker .ws-star-selection-actions")).toContainText("2 份可选");
      const selectedInSearch = matchingStars.locator('input[type="checkbox"]');
      const initiallySelected = await selectedInSearch.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).checked));
      const selectVisible = page.getByRole("button", {name: "选择当前记录"});
      const deselectVisible = page.getByRole("button", {name: "取消当前选择"});
      if (!initiallySelected.every(Boolean)) await selectVisible.click();
      for (const checkbox of await selectedInSearch.all()) await expect(checkbox).toBeChecked();
      await expect(page.getByRole("button", {name: "取消当前选择"})).toBeEnabled();
      await page.screenshot({path: path.join(evidenceDirectory, "archive-star-map-selection.png"), fullPage: true, animations: "disabled"});
      await deselectVisible.click();
      for (const checkbox of await selectedInSearch.all()) await expect(checkbox).not.toBeChecked();
      await expect(page.getByRole("button", {name: "选择当前记录"})).toBeEnabled();
      await starSearch.fill("");
      await expect(allStarRows).toHaveCount(17);
      const afterToggleStates = await allStarRows.evaluateAll(rows => rows.map(row => ({text: row.textContent?.trim() || "", checked: (row.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked ?? false})));
      const initialByTitle = new Map(initialStarStates.map(row => [row.text, row.checked]));
      expect(afterToggleStates.filter(row => !row.text.includes("歌曲")).every(row => initialByTitle.get(row.text) === row.checked)).toBe(true);
      for (const [index, checkbox] of (await allStarRows.locator('input[type="checkbox"]').all()).entries()) {
        if (initialStarStates[index].checked) await checkbox.check();
        else await checkbox.uncheck();
      }
      await expect(page.getByRole("button", {name: new RegExp(`选择星点（${initialSelectedCount}）`)})).toBeVisible();

      await page.goto("/app/music");
      const stage = page.locator(".collection-stage-music");
      await expect(stage).toBeVisible();
      const firstStageTitle = (await stage.locator(".collection-current h2").innerText()).trim();
      await stage.getByRole("button", {name: "下一首档案"}).click();
      await expect(stage.locator(".collection-current h2")).not.toHaveText(firstStageTitle);
      const nextStageTitle = (await stage.locator(".collection-current h2").innerText()).trim();
      await stage.getByRole("button", {name: "查看这首歌"}).click();
      await expect(page.getByRole("dialog")).toContainText(nextStageTitle);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(stage).toBeVisible();

      await expect(page.getByRole("button", {name: "筛选", exact: true})).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByLabel("年份筛选")).toHaveCount(0);
      await expect(page.locator(".ws-entry-card input[type=checkbox]")).toHaveCount(0);
      await page.getByRole("button", {name: "管理记录", exact: true}).click();
      await expect(page.locator(".ws-entry-card input[type=checkbox]")).toHaveCount(2);
      await page.getByRole("button", {name: "完成管理", exact: true}).click();
      await expect(page.locator(".ws-entry-card input[type=checkbox]")).toHaveCount(0);

      const search = page.getByRole("textbox", {name: "搜索记录"});
      await search.fill("歌曲");
      await expect(page.getByTestId("entry-card")).toHaveCount(2);
      await expect(page.locator(".ws-entry-card").getByRole("heading", {name: "界面验收样本·歌曲", exact: true})).toBeVisible();
      await expect(page.locator(".ws-entry-card").getByRole("heading", {name: secondMusicEntry.title, exact: true})).toBeVisible();
      await expect(stage).toHaveCount(0);
      await page.getByRole("button", {name: "筛选", exact: true}).click();
      await expect(page.getByLabel("年份筛选")).toBeVisible();
      await expect(page.getByLabel("分类筛选")).toBeVisible();
      await expect(page.getByLabel("排序方式")).toBeVisible();
      await page.getByRole("button", {name: "筛选", exact: true}).click();
      const favoriteButton = page.getByRole("button", {name: "收藏界面验收样本·歌曲"});
      await expect(favoriteButton).toHaveAttribute("aria-pressed", "false");
      await favoriteButton.click();
      const savedFavorite = page.getByRole("button", {name: "取消收藏界面验收样本·歌曲"});
      await expect(savedFavorite).toHaveAttribute("aria-pressed", "true");
      await search.fill("");
      await page.getByRole("button", {name: /只看收藏/}).click();
      await expect(page.getByTestId("entry-card")).toHaveCount(1);
      await expect(page.locator(".ws-entry-card").getByRole("heading", {name: "界面验收样本·歌曲", exact: true})).toBeVisible();

      await page.goto(`/app/music/${musicEntry.id}`);
      await expect(page.locator("#main-content h1")).toHaveText("界面验收样本·歌曲");
      await expect(page.getByText("合成验收记录，不代表真实作品资料或个人回忆。", {exact: true})).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.screenshot({path: path.join(evidenceDirectory, "archive-detail-desktop.png"), fullPage: true, animations: "disabled"});
      const editDetail = page.getByRole("button", {name: "编辑记录"});
      await editDetail.click();
      const editDialog = page.getByRole("dialog", {name: "编辑音乐馆"});
      await expect(editDialog).toBeVisible();
      await page.screenshot({path: path.join(evidenceDirectory, "archive-editor-desktop.png"), animations: "disabled"});
      await page.keyboard.press("Escape");
      await expect(editDialog).toHaveCount(0);
      await expect(editDetail).toBeFocused();
      await expect(page.locator("#main-content h1")).toHaveText("界面验收样本·歌曲");

      await page.goto("/app/music");
      const musicHeading = await page.locator("#main-content h1").innerText();
      const addRecord = page.getByRole("button", {name: "添加记录"});
      await addRecord.click();
      const createDialog = page.getByRole("dialog", {name: "新增音乐馆"});
      await expect(createDialog).toBeVisible();
      await createDialog.getByLabel("标题", {exact: true}).fill("未保存的界面验收草稿");
      await page.keyboard.press("Escape");
      await expect(createDialog).toHaveCount(0);
      await expect(addRecord).toBeFocused();
      await expect(page.getByText("未保存的界面验收草稿", {exact: true})).toHaveCount(0);
      await expect(page.locator("#main-content h1")).toHaveText(musicHeading);

      await addRecord.click();
      const quickCreate = page.getByRole("dialog", {name: "新增音乐馆"});
      await expect(quickCreate.locator(".simple-more input[type=checkbox]")).toHaveCount(0);
      const moreSettings = quickCreate.getByRole("button", {name: /更多设置/});
      await moreSettings.click();
      await expect(quickCreate.locator(".simple-more input[type=checkbox]")).toHaveCount(2);
      await moreSettings.click();
      await expect(quickCreate.locator(".simple-more input[type=checkbox]")).toHaveCount(0);
      const quickTitle = "界面验收样本·快速新建歌曲";
      await quickCreate.getByLabel("标题", {exact: true}).fill(quickTitle);
      const createResponsePromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/entries");
      await quickCreate.getByRole("button", {name: "保存记录", exact: true}).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      expect(createResponse.request().postDataJSON()).toMatchObject({kind: "music", title: quickTitle});
      await expect(quickCreate).toHaveCount(0);
      await expect(page.getByRole("status").filter({hasText: "这份记录已妥善保存。"})).toBeVisible();
      await expect(page.locator(".ws-entry-card").getByRole("heading", {name: quickTitle, exact: true})).toBeVisible();
      const savedEntries = await page.request.get("/api/entries");
      expect(savedEntries.ok()).toBe(true);
      const savedQuickEntry = ((await savedEntries.json()).entries as Entry[]).find(entry => entry.title === quickTitle);
      expect(savedQuickEntry).toMatchObject({kind: "music", title: quickTitle, data: {status: "saved"}});

      await page.goto(`/app/music/${musicEntry.id}`);
      await page.getByRole("button", {name: "编辑记录"}).click();
      const preserveDataDialog = page.getByRole("dialog", {name: "编辑音乐馆"});
      await preserveDataDialog.getByLabel("标题", {exact: true}).fill("界面验收样本·编辑后歌曲");
      const updateResponsePromise = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/entries/${musicEntry.id}`);
      await preserveDataDialog.getByRole("button", {name: "保存记录", exact: true}).click();
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok()).toBe(true);
      const updatedEntry = ((await updateResponse.json()).entry as Entry);
      expect(updatedEntry).toMatchObject({title: "界面验收样本·编辑后歌曲", data: {albumId: albumEntry.id, category: "单曲", tags: ["界面验收", "筛选样本"], year: 2009}});
      expect(pageErrors).toEqual([]);
    } finally {await context.close();}
  });

  test("mobile navigation and all routes fit the narrow viewport", async ({browser}) => {
    test.setTimeout(180_000);
    const {context, page, pageErrors} = await makeContext(browser, mobileViewport, "no-preference", true);
    try {
      await signIn(page);
      await noOverflow(page, mobileViewport.width);
      const menuButton = page.getByRole("button", {name: "打开菜单"});
      await menuButton.click();
      const mobileNav = page.locator("#archive-mobile-navigation");
      await expect(mobileNav).toBeVisible();
      await expect(mobileNav.getByRole("link", {name: "网站设置"})).toBeVisible();
      await page.screenshot({path: path.join(evidenceDirectory, "archive-nav-menu-mobile.png"), animations: "disabled"});
      await page.keyboard.press("Escape");
      await expect(menuButton).toBeFocused();
      await expect.poll(() => mobileNav.evaluate(element => element.parentElement?.getAttribute("data-state") ?? null), {intervals: [5, 10, 20, 30, 40]}).toBe("closing");
      await expect(mobileNav).toHaveCount(0);

      await menuButton.click();
      await mobileNav.getByRole("link", {name: "我的星途"}).click();
      await expect(page).toHaveURL(/\/app\/journey\/?$/);
      await expect(mobileNav).toHaveCount(0);
      await noOverflow(page, mobileViewport.width);
      await page.screenshot({path: path.join(evidenceDirectory, "archive-journey-mobile.png"), fullPage: true, animations: "disabled"});

      for (const route of routes) {
        await inspectRoute(page, route, mobileViewport.width);
        if (route === "star-map") {
          const mobileBrowser = page.getByRole("region", {name: "星点记录浏览"});
          await expect(mobileBrowser).toBeVisible();
          const songShortcut = mobileBrowser.getByRole("button", {name: `查看${musicEntry.title}，音乐馆`, exact: true});
          await expect(songShortcut).toBeVisible();
          await songShortcut.click();
          const songDetail = page.getByRole("dialog");
          await expect(songDetail).toContainText(musicEntry.title);
          await page.keyboard.press("Escape");
          await expect(songDetail).toHaveCount(0);
          await expect(mobileBrowser).toBeVisible();
          await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
          await page.screenshot({path: path.join(evidenceDirectory, `archive-${route}-mobile.png`), fullPage: true, animations: "disabled"});
        } else if (screenshotRoutes.has(route)) {
          await page.screenshot({path: path.join(evidenceDirectory, `archive-${route}-mobile.png`), fullPage: true, animations: "disabled"});
        }
      }
      expect(pageErrors).toEqual([]);
    } finally {await context.close();}
  });

  test("reduced motion keeps navigation usable without page overflow", async ({browser}) => {
    await mkdir(evidenceDirectory, {recursive: true});
    const {context, page, pageErrors} = await makeContext(browser, desktopViewport, "reduce");
    try {
      await signIn(page);
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      const reducedBackdrop = page.locator(".starsea-backdrop");
      await expect(reducedBackdrop).toHaveAttribute("data-motion-state", "paused");
      const reducedFrame = await canvasFrame(page);
      await page.waitForTimeout(700);
      expect(await canvasFrame(page)).toBe(reducedFrame);
      await page.getByRole("button", {name: /更多珍藏/}).click();
      await expect(page.locator("#archive-more-navigation")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", {name: /更多珍藏/})).toBeFocused();
      await expect(page.locator("#archive-more-navigation")).toHaveCount(0);
      await page.goto("/app/settings");
      await expect(page.getByRole("heading", {name: "网站设置", exact: true})).toBeVisible();
      await expect(page.getByLabel("开始喜欢张杰的年份")).toHaveValue("2009");
      for (const tab of ["日常", "首页编排", "管理与备份"]) await expect(page.getByRole("tab", {name: tab})).toBeVisible();
      await page.getByRole("tab", {name: "管理与备份"}).click();
      const advancedSettings = page.getByRole("button", {name: /存储与时间设置/});
      await expect(advancedSettings).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByLabel("图片上限（MB）")).toHaveCount(0);
      await advancedSettings.click();
      await expect(page.getByLabel("图片上限（MB）")).toBeVisible();
      await expect(page.getByLabel("音频上限（MB）")).toBeVisible();
      await expect(page.getByLabel("视频上限（MB）")).toBeVisible();
      await page.getByRole("tab", {name: "日常"}).click();
      await noOverflow(page, desktopViewport.width);

      const siteName = page.getByLabel("网站名称", {exact: true});
      const savedName = "界面验收样本·设置持久化";
      await siteName.fill(savedName);
      await expect(page.getByText("调整完成后，点一下保存", {exact: true})).toBeVisible();
      const saveSettings = page.getByRole("button", {name: "保存设置", exact: true});
      await expect(saveSettings).toBeEnabled();
      await saveSettings.click();
      await expect(page.getByRole("status").filter({hasText: "网站设置已保存。"})).toBeVisible();
      await expect(page.getByText("已为你保存", {exact: true})).toBeVisible();
      await expect(saveSettings).toBeEnabled();
      await page.reload();
      await expect(page.getByLabel("网站名称", {exact: true})).toHaveValue(savedName);
      await expect(page.getByText("已为你保存", {exact: true})).toBeVisible();
      const persistedSettings = await page.request.get("/api/settings");
      expect(persistedSettings.ok()).toBe(true);
      expect((await persistedSettings.json()).settings.siteName).toBe(savedName);
      await page.screenshot({path: path.join(evidenceDirectory, "archive-reduced-motion.png"), fullPage: true, animations: "disabled"});
      expect(pageErrors).toEqual([]);
    } finally {await context.close();}
  });

  test("ambient star sea follows the saved motion preference", async ({browser}) => {
    const {context, page, pageErrors} = await makeContext(browser, desktopViewport);
    try {
      await signIn(page);
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-motion-state", "running");
      const movingFrame = await canvasFrame(page);
      await page.waitForTimeout(900);
      expect(await canvasFrame(page)).not.toBe(movingFrame);

      await page.goto("/app/settings");
      const animation = page.getByLabel("开启动效");
      await page.locator(".secondary-switch").click();
      await expect(animation).not.toBeChecked();
      await page.getByRole("button", {name: "保存设置", exact: true}).click();
      await expect(page.getByRole("status").filter({hasText: "网站设置已保存。"})).toBeVisible();
      await expect(backdrop).toHaveAttribute("data-motion-state", "paused");
      const pausedFrame = await canvasFrame(page);
      await page.waitForTimeout(900);
      expect(await canvasFrame(page)).toBe(pausedFrame);

      await page.locator(".secondary-switch").click();
      await expect(animation).toBeChecked();
      await page.getByRole("button", {name: "保存设置", exact: true}).click();
      await expect(page.getByRole("status").filter({hasText: "网站设置已保存。"})).toBeVisible();
      await expect(backdrop).toHaveAttribute("data-motion-state", "running");
      const resumedFrame = await canvasFrame(page);
      await page.waitForTimeout(900);
      expect(await canvasFrame(page)).not.toBe(resumedFrame);
      await page.screenshot({path: path.join(evidenceDirectory, "archive-motion-desktop.png"), fullPage: true, animations: "disabled"});
      expect(pageErrors).toEqual([]);
    } finally {await context.close();}
  });
});
