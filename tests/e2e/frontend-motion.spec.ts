import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page} from "@playwright/test";
import {originalPng, originalWav} from "./fixtures";

const origin = "http://127.0.0.1:3002";
const evidenceDirectory = path.resolve("verification");
const credentials = {email: `motion-${randomUUID()}@example.test`, password: `Motion-test-${randomUUID()}-Aa9!`};
const keepTitle = "动效验收 · 保留甲";
const removeTitle = "动效验收 · 隐去乙";
const otherKeepTitle = "动效验收 · 保留丙";
let owner: APIRequestContext;
let musicId: string;

type Frame = {time: number; connected: boolean; opacity: number; transform: string; left: number; top: number; width: number; overflow: string; activeInside: boolean};
type Track = {done: boolean; frames: Frame[]};
type RouteTrack = {done: boolean; frames: {time: number; names: string[]}[]};
type MotionWindow = Window & {__frontendMotionTracks?: Record<string, Track>; __frontendMotionLogo?: Element; __frontendMotionRoute?: RouteTrack};

async function newPage(browser: Browser, mobile = false, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 7"] : devices["Desktop Chrome"]),
    ...(mobile ? {} : {viewport: {width: 1440, height: 1000}}),
    reducedMotion,
    baseURL: origin,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  return {context, page, errors};
}

async function authenticate(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
  await page.getByLabel("密码", {exact: true}).fill(credentials.password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.getByRole("heading", {name: /张杰/, level: 1})).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function settle(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(.99);
}

// Record actual rendered frames, retaining a reference even after React removes the node.
// This detects a real exit lifecycle rather than merely an exit class or a CSS declaration.
async function track(page: Page, locator: Locator, key: string, untilRemoved = true) {
  await locator.evaluate((element, options) => {
    const motionWindow = window as MotionWindow;
    motionWindow.__frontendMotionTracks ??= {};
    const result: Track = {done: false, frames: []};
    motionWindow.__frontendMotionTracks[options.key] = result;
    const started = performance.now();
    function sample() {
      const now = performance.now();
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      result.frames.push({
        time: now - started,
        connected: element.isConnected,
        opacity: Number(style.opacity),
        transform: style.transform,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        overflow: document.body.style.overflow,
        activeInside: element.contains(document.activeElement),
      });
      if ((options.untilRemoved && !element.isConnected) || now - started > 1200) result.done = true;
      else requestAnimationFrame(sample);
    }
    sample();
  }, {key, untilRemoved});
  // Force a first real frame before the input which triggers the exit.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

async function finishTrack(page: Page, key: string) {
  await expect.poll(() => page.evaluate(name => (window as MotionWindow).__frontendMotionTracks?.[name]?.done ?? false, key)).toBe(true);
  return page.evaluate(name => (window as MotionWindow).__frontendMotionTracks![name], key);
}

function expectExitFrames(result: Track) {
  const attached = result.frames.filter(frame => frame.connected);
  expect(result.frames.at(-1)?.connected).toBe(false);
  expect(attached.length).toBeGreaterThan(2);
  expect(attached.some(frame => frame.opacity > .03 && frame.opacity < .93)).toBe(true);
}

async function saveEvidence(page: Page, name: string, tracks: Record<string, Track | RouteTrack>) {
  await mkdir(evidenceDirectory, {recursive: true});
  await page.screenshot({path: path.join(evidenceDirectory, `frontend-motion-${name}.png`), fullPage: true, animations: "disabled"});
  await writeFile(path.join(evidenceDirectory, `frontend-motion-${name}.json`), JSON.stringify(tracks, null, 2), "utf8");
}

async function card(page: Page, title: string) {
  return page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: title, exact: true})});
}

async function verifyListTransitions(page: Page, prefix: string) {
  await page.goto("/app/journal");
  const leaving = await card(page, removeTitle);
  const staying = await card(page, keepTitle);
  await settle(leaving);
  await settle(staying);
  const titleContrast = await staying.evaluate(element => {
    const title = element.querySelector("h2 button")!;
    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    const foreground = luminance(getComputedStyle(title).color), background = luminance(getComputedStyle(element).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(titleContrast).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await track(page, leaving, `${prefix}-filter-exit`);
  await track(page, staying, `${prefix}-filter-layout`, false);
  await staying.evaluate(element => {element.setAttribute("data-motion-identity-test", "preserved");});
  await page.getByLabel("搜索记录", {exact: true}).fill("保留");
  await expect(leaving).toHaveCount(0);
  await expect(page.getByTestId("entry-card")).toHaveCount(2);
  await expect(staying).toHaveAttribute("data-motion-identity-test", "preserved");
  const exit = await finishTrack(page, `${prefix}-filter-exit`);
  expectExitFrames(exit);
  const layout = await finishTrack(page, `${prefix}-filter-layout`);
  expect(layout.frames.every(frame => frame.connected)).toBe(true);
  const positions = new Set(layout.frames.map(frame => `${frame.left.toFixed(1)},${frame.top.toFixed(1)}`));
  expect(positions.size).toBeGreaterThan(2);
  await noOverflow(page);
  await page.getByLabel("搜索记录", {exact: true}).fill("");
  await expect(page.getByTestId("entry-card")).toHaveCount(3);
  return {exit, layout};
}

async function verifyModal(page: Page, prefix: string) {
  const create = page.getByTestId("entry-create");
  await create.click();
  const dialog = page.getByRole("dialog");
  await settle(dialog);
  await expect(dialog.getByRole("button", {name: "关闭弹窗", exact: true})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", {name: "关闭弹窗", exact: true})).toBeFocused();
  await track(page, dialog, `${prefix}-modal-exit`);
  await page.keyboard.press("Escape");
  const exit = await finishTrack(page, `${prefix}-modal-exit`);
  expectExitFrames(exit);
  const exiting = exit.frames.filter(frame => frame.connected && frame.opacity < .93 && frame.opacity > .03);
  expect(exiting.every(frame => frame.overflow === "hidden")).toBe(true);
  expect(exiting.every(frame => frame.activeInside)).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await noOverflow(page);
  return exit;
}

test.describe.serial("production frontend motion with a separate fictional owner", () => {
  test.beforeAll(async ({playwright}) => {
    const dataDirectory = process.env.STARS_MOTION_DATA_DIR;
    if (!dataDirectory || !path.relative(path.resolve(".test-data"), dataDirectory).startsWith("frontend-motion-")) {
      throw new Error("Run with playwright.motion.config.ts and a fresh isolated frontend-motion data directory");
    }
    owner = await playwright.request.newContext({baseURL: origin});
    expect((await (await owner.get("/api/auth/status")).json()).setupRequired).toBe(true);
    const setup = await owner.post("/api/auth/setup", {headers: {Origin: origin}, data: credentials});
    expect(setup.ok()).toBe(true);
    for (const title of [keepTitle, removeTitle, otherKeepTitle]) {
      const created = await owner.post("/api/entries", {headers: {Origin: origin}, data: {
        kind: "journal", title, data: {description: "浏览器自动验收的虚构记录，不代表真实私人记忆。", date: "2009", datePrecision: "year"},
      }});
      expect(created.ok()).toBe(true);
    }
    const uploaded = await owner.post("/api/assets", {headers: {Origin: origin}, multipart: {
      file: {name: "frontend-motion-original.png", mimeType: "image/png", buffer: originalPng()},
    }});
    expect(uploaded.ok()).toBe(true);
    const assetId = (await uploaded.json()).asset.id as string;
    for (const title of ["动效验收 · 原创甲图", "动效验收 · 原创乙图"]) {
      const created = await owner.post("/api/entries", {headers: {Origin: origin}, data: {kind: "photos", title, data: {assetId}}});
      expect(created.ok()).toBe(true);
    }
    const audio = await owner.post("/api/assets", {headers: {Origin: origin}, multipart: {
      file: {name: "frontend-motion-original.wav", mimeType: "audio/wav", buffer: originalWav()},
    }});
    expect(audio.ok()).toBe(true);
    const music = await owner.post("/api/entries", {headers: {Origin: origin}, data: {
      kind: "music", title: "动效验收 · 原创音调", data: {assetId: (await audio.json()).asset.id, sourceType: "authorized_upload"},
    }});
    expect(music.ok()).toBe(true);
    musicId = (await music.json()).entry.id as string;
  });

  test.afterAll(async () => {await owner?.dispose();});

  test("desktop retained menu and modal exits, stable route branding, list morph and controls", async ({browser}) => {
    test.setTimeout(120_000);
    const {context, page, errors} = await newPage(browser);
    try {
      await authenticate(page);
      await noOverflow(page);
      const more = page.getByRole("button", {name: "更多珍藏", exact: true});
      await more.focus();
      await page.keyboard.press("Enter");
      const menu = page.locator(".nav-dropdown");
      await settle(menu);
      await track(page, menu, "desktop-menu-exit");
      await page.keyboard.press("Escape");
      const menuExit = await finishTrack(page, "desktop-menu-exit");
      expectExitFrames(menuExit);
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();

      await page.locator(".stage-wordmark .v-mark").evaluate(element => {(window as MotionWindow).__frontendMotionLogo = element;});
      await page.evaluate(() => {
        const result: RouteTrack = {done: false, frames: []};
        (window as MotionWindow).__frontendMotionRoute = result;
        const started = performance.now();
        function sample() {
          result.frames.push({time: performance.now() - started, names: document.getAnimations().flatMap(animation => animation instanceof CSSAnimation ? [animation.animationName] : [])});
          if (performance.now() - started > 1500) result.done = true;
          else requestAnimationFrame(sample);
        }
        sample();
      });
      await page.getByRole("link", {name: "音乐馆", exact: true}).click();
      await expect(page).toHaveURL(/\/app\/music\/?$/);
      await expect(page.getByRole("heading", {name: "那些年，循环的歌。", exact: true, level: 1})).toBeVisible();
      expect(await page.locator(".stage-wordmark .v-mark").evaluate(element => element === (window as MotionWindow).__frontendMotionLogo)).toBe(true);
      await expect.poll(() => page.evaluate(() => (window as MotionWindow).__frontendMotionRoute?.done)).toBe(true);
      const route = await page.evaluate(() => (window as MotionWindow).__frontendMotionRoute!);
      expect(route.frames.some(frame => frame.names.some(name => name === "archive-arrive" || name === "archive-leave"))).toBe(true);

      const list = await verifyListTransitions(page, "desktop");
      const create = page.getByTestId("entry-create");
      await settle(create);
      await page.mouse.move(0, 0);
      const normalTransform = await create.evaluate(element => getComputedStyle(element).scale);
      await create.hover();
      await expect.poll(() => create.evaluate(element => getComputedStyle(element).scale)).not.toBe(normalTransform);
      const modalExit = await verifyModal(page, "desktop");

      await page.goto("/app/photos");
      await page.getByRole("button", {name: "在灯箱查看动效验收 · 原创甲图", exact: true}).click();
      await expect(page.getByRole("dialog").getByRole("img", {name: "动效验收 · 原创甲图", exact: true})).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("dialog").getByRole("img", {name: "动效验收 · 原创乙图", exact: true})).toBeVisible();
      await page.keyboard.press("ArrowLeft");
      await expect(page.getByRole("dialog").getByRole("img", {name: "动效验收 · 原创甲图", exact: true})).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await noOverflow(page);
      await saveEvidence(page, "desktop", {menuExit, modalExit, filterExit: list.exit, listLayout: list.layout, route});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("mobile navigation, dialogs and filtered cards complete their exits without overflow", async ({browser}) => {
    test.setTimeout(120_000);
    const {context, page, errors} = await newPage(browser, true);
    try {
      await authenticate(page);
      await page.getByRole("button", {name: "打开菜单", exact: true}).click();
      const menu = page.getByRole("navigation", {name: "移动端导航", exact: true});
      await settle(menu);
      await noOverflow(page);
      await track(page, page.locator(".mobile-nav-presence"), "mobile-menu-exit");
      await page.getByRole("button", {name: "关闭菜单", exact: true}).click();
      const menuExit = await finishTrack(page, "mobile-menu-exit");
      expectExitFrames(menuExit);
      await expect(menu).toHaveCount(0);
      const list = await verifyListTransitions(page, "mobile");
      const modalExit = await verifyModal(page, "mobile");
      await saveEvidence(page, "mobile", {menuExit, modalExit, filterExit: list.exit, listLayout: list.layout});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("layout changes preserve playing media and SVG exports exclude exiting unselected nodes", async ({browser}) => {
    const {context, page, errors} = await newPage(browser);
    try {
      await authenticate(page);
      await page.goto(`/app/music/${musicId}`);
      const audio = page.locator("audio");
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).duration)).toBeGreaterThan(.8);
      await audio.evaluate(async element => {
        const media = element as HTMLAudioElement;
        media.setAttribute("data-playback-identity-test", "preserved");
        media.muted = true; await media.play();
      });
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.1);
      const playhead = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
      await page.getByRole("button", {name: "加入收藏", exact: true}).click();
      await expect(page.getByRole("button", {name: "取消收藏", exact: true})).toBeVisible();
      await expect(audio).toHaveAttribute("data-playback-identity-test", "preserved");
      expect(await audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(playhead);

      await page.goto("/app/star-map");
      await page.getByRole("checkbox", {name: `${keepTitle} 追星日记`, exact: true}).check();
      const removeCheckbox = page.getByRole("checkbox", {name: `${removeTitle} 追星日记`, exact: true});
      await removeCheckbox.check();
      const star = page.locator("[data-star-node]").filter({hasText: removeTitle});
      await settle(star);
      await track(page, star, "unselected-star-exit");
      const downloadPromise = page.waitForEvent("download");
      await removeCheckbox.uncheck();
      // Export during the retained exit so visual presence cannot become an export selection.
      await page.getByRole("button", {name: "导出所选星系", exact: true}).evaluate(element => (element as HTMLButtonElement).click());
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      if (!stream) throw new Error("The SVG download did not expose its bytes");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const svg = Buffer.concat(chunks).toString("utf8");
      expect(svg).toContain(keepTitle);
      expect(svg).not.toContain(removeTitle);
      const starExit = await finishTrack(page, "unselected-star-exit");
      expectExitFrames(starExit);
      await expect(star).toHaveCount(0);

      await page.goto("/app/settings");
      const moduleRow = page.locator(".ws-module-order > div").filter({has: page.getByRole("button", {name: "下移journey", exact: true})});
      await moduleRow.scrollIntoViewIfNeeded();
      await moduleRow.evaluate(element => element.setAttribute("data-module-identity-test", "preserved"));
      await track(page, moduleRow, "module-order-layout", false);
      await moduleRow.getByRole("button", {name: "下移journey", exact: true}).click();
      await expect(moduleRow).toHaveAttribute("data-module-identity-test", "preserved");
      const moduleLayout = await finishTrack(page, "module-order-layout");
      expect(moduleLayout.frames.every(frame => frame.connected)).toBe(true);
      expect(new Set(moduleLayout.frames.map(frame => frame.top.toFixed(1))).size).toBeGreaterThan(2);
      await noOverflow(page);
      await saveEvidence(page, "layout-safety", {starExit, moduleLayout});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("system reduced motion and the saved animation toggle suppress spatial motion", async ({browser}) => {
    const check = async (context: BrowserContext, page: Page, label: string) => {
      await page.goto("/app/journal");
      const create = page.getByTestId("entry-create");
      await settle(create);
      const normalTransform = await create.evaluate(element => getComputedStyle(element).scale);
      await create.hover();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await create.evaluate(element => getComputedStyle(element).scale)).toBe(normalTransform);
      await create.click();
      await settle(page.getByRole("dialog"));
      await track(page, page.getByRole("dialog"), `${label}-modal-exit`);
      await page.keyboard.press("Escape");
      const modalExit = await finishTrack(page, `${label}-modal-exit`);
      expect(modalExit.frames.filter(frame => frame.connected && frame.opacity < .93 && frame.opacity > .03).length).toBeLessThanOrEqual(1);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(create).toBeFocused();
      await noOverflow(page);
      await saveEvidence(page, label, {modalExit});
      await context.close();
    };
    const reduced = await newPage(browser, false, "reduce");
    try {
      await authenticate(reduced.page);
      expect(await reduced.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      await check(reduced.context, reduced.page, "reduced");
      expect(reduced.errors).toEqual([]);
    } finally {await reduced.context.close();}

    const disabled = await newPage(browser);
    try {
      await authenticate(disabled.page);
      await disabled.page.goto("/app/settings");
      await disabled.page.getByRole("checkbox", {name: "开启动效", exact: true}).uncheck();
      await disabled.page.getByRole("button", {name: "保存网站设置", exact: true}).click();
      await expect(disabled.page.getByRole("status")).toContainText("网站设置已保存。");
      expect((await (await disabled.page.request.get("/api/settings")).json()).settings.animation).toBe(false);
      await check(disabled.context, disabled.page, "disabled");
      expect(disabled.errors).toEqual([]);
    } finally {await disabled.context.close();}
  });
});
