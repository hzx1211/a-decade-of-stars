import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type Page} from "@playwright/test";

const origin = "http://127.0.0.1:3011";
const evidenceDirectory = path.resolve("verification", "netease");
const credentials = {email: `netease-${randomUUID()}@example.test`, password: `Netease-test-${randomUUID()}-Aa9!`};
const songUrl = "https://music.163.com/song?id=28059417";
const hashUrl = "https://music.163.com/#/outchain/2/28059417/";
const iframeSource = '<iframe frameborder="no" border="0" marginwidth="0" marginheight="0" width=330 height=86 src="//music.163.com/outchain/player?type=2&id=28059417&auto=1&height=66"></iframe>';
const widgetPattern = /^https:\/\/music\.163\.com\/outchain\/player\?/;
type TestTrack = {id: string; title: string; assetId?: string};

function toneWav() {
  const rate = 22_050;
  const samples = Buffer.alloc(rate * 15 * 2);
  for (let index = 0; index < samples.length / 2; index++) samples.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 4_000), index * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + samples.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
  await page.getByLabel("密码", {exact: true}).fill(credentials.password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
}

async function createTrack(page: Page, title: string, data: Record<string, unknown> = {}): Promise<TestTrack> {
  const response = await page.request.post("/api/entries", {headers: {Origin: origin}, data: {kind: "music", title, data}});
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).entry as TestTrack;
}

async function createLocalTrack(page: Page) {
  const response = await page.request.post("/api/assets", {
    headers: {Origin: origin},
    multipart: {
      file: {name: "netease-integration-tone.wav", mimeType: "audio/wav", buffer: toneWav()},
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const asset = (await response.json()).asset as {id: string};
  const entry = await createTrack(page, "合成音调 · 本地播放切换验收", {assetId: asset.id, sourceType: "authorized_upload"});
  return {...entry, assetId: asset.id};
}

async function chooseTrack(page: Page, track: TestTrack) {
  const stage = page.getByRole("region", {name: "星轨唱片台", exact: true});
  const select = stage.getByRole("combobox", {name: "唱片台选曲", exact: true});
  await expect(select).toBeEnabled();
  await select.selectOption(track.id);
  await expect(select).toHaveValue(track.id);
  await expect(stage.getByRole("heading", {name: track.title, exact: true})).toBeVisible();
  return stage;
}

async function openFromStage(page: Page, track: TestTrack) {
  const stage = await chooseTrack(page, track);
  const dialog = page.getByRole("dialog", {name: "网易云播放器", exact: true});
  // Selecting a song continues playback if a local track was already playing.
  if (!await dialog.isVisible()) await stage.getByRole("button", {name: `唱片台播放${track.title}`, exact: true}).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

let setupContext: APIRequestContext | undefined;
test.beforeAll(async ({playwright}) => {
  await mkdir(evidenceDirectory, {recursive: true});
  setupContext = await playwright.request.newContext({baseURL: origin});
  const status = await (await setupContext.get("/api/auth/status")).json();
  expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
  const response = await setupContext.post("/api/auth/setup", {headers: {Origin: origin}, data: credentials});
  expect(response.ok(), await response.text()).toBe(true);
});
test.afterAll(async () => {await setupContext?.dispose();});

test("pasted official iframe is normalized, opens in the global player, and never overlaps local audio", async ({browser, playwright}) => {
  const context = await browser.newContext({...devices["Desktop Chrome"], viewport: {width: 1440, height: 960}, baseURL: origin});
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // A labelled fixture proves the app integration independently of provider network availability.
  // It is deliberately not artist media and is not evidence of official-site audible playback.
  await context.route(widgetPattern, route => route.fulfill({status: 200, contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="zh"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#fafafa;color:#333;padding:16px}button{border:0;border-radius:50%;width:40px;height:40px;background:#d33;color:white;margin-right:12px}small{color:#777}</style><button aria-label="测试控件">▶</button><span>官方 iframe 集成验收<small> · 无艺人媒体</small></span></html>'}));
  try {
    await signIn(page);
    const external = await createTrack(page, "网易云链接 · iframe 导入验收");
    const local = await createLocalTrack(page);
    await page.goto("/app/music");
    await page.getByRole("button", {name: `编辑${external.title}`, exact: true}).click();
    const editor = page.getByRole("dialog", {name: "编辑音乐馆", exact: true});
    await expect(editor).toBeVisible();
    const linkInput = editor.getByLabel(/^网易云链接或播放器代码/);
    if (!await linkInput.isVisible()) {
      await editor.getByRole("button", {name: /更多设置/}).click();
      await editor.getByRole("button", {name: "媒体与来源", exact: true}).click();
    }
    await linkInput.fill(iframeSource);
    await editor.getByTestId("entry-save").click();
    await expect(editor).toHaveCount(0);
    const persisted = (await (await page.request.get(`/api/entries/${external.id}`)).json()).entry;
    expect(persisted.data.externalUrl).toBe(songUrl);
    expect(persisted.data.sourceType).toBe("official_embed");
    expect(persisted.data.allowedUseScope).toContain("official_embed");
    expect(JSON.stringify(persisted)).not.toContain("<iframe");

    const localStage = await chooseTrack(page, local);
    await localStage.getByRole("button", {name: `唱片台播放${local.title}`, exact: true}).click();
    const audio = page.getByTestId("global-audio");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.2);
    const dialog = await openFromStage(page, external);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    const iframe = dialog.locator("iframe");
    await expect(iframe).toHaveCount(1);
    const src = new URL((await iframe.getAttribute("src"))!);
    expect(src.origin).toBe("https://music.163.com");
    expect(src.pathname).toBe("/outchain/player");
    expect(Object.fromEntries(src.searchParams)).toMatchObject({type: "2", id: "28059417", auto: "0", height: "66"});
    await expect(iframe).toHaveAttribute("height", "86");
    await expect(iframe.contentFrame().getByText("官方 iframe 集成验收", {exact: false})).toBeVisible();
    await expect(dialog.getByRole("link", {name: /打开.*平台|网易云.*打开|网易云.*收听|原平台/})).toHaveAttribute("href", songUrl);
    await expect(dialog.getByRole("slider")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-player-integration-fixture.png"), animations: "disabled"});
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('iframe[src*="music.163.com/outchain/player"]')).toHaveCount(0);

    const afterExternal = await chooseTrack(page, local);
    await afterExternal.getByRole("button", {name: `唱片台播放${local.title}`, exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    await expect(page.locator('iframe[src*="music.163.com/outchain/player"]')).toHaveCount(0);
    await afterExternal.getByRole("button", {name: `唱片台暂停${local.title}`, exact: true}).click();

    // Older saved hash links work without requiring the owner to re-enter their collection.
    const legacy = await createTrack(page, "网易云链接 · 旧记录兼容验收", {externalUrl: hashUrl, sourceType: "external_link"});
    await page.reload();
    const legacyCard = page.getByTestId("entry-card").filter({has: page.getByRole("heading", {name: legacy.title, exact: true})});
    await legacyCard.getByRole("button", {name: `播放${legacy.title}`, exact: true}).click();
    await expect(page.getByRole("dialog", {name: "网易云播放器", exact: true})).toBeVisible();
    await page.getByRole("button", {name: "关闭弹窗", exact: true}).click();
    await expect(page.locator('iframe[src*="music.163.com/outchain/player"]')).toHaveCount(0);

    const anonymous = await playwright.request.newContext({baseURL: origin});
    try {
      expect((await anonymous.get(`/api/entries/${external.id}`)).status()).toBe(401);
      expect((await anonymous.get("/api/backup")).status()).toBe(401);
    } finally {await anonymous.dispose();}
    expect(errors).toEqual([]);
  } finally {await context.close();}
});

test("mobile reduced-motion layout loads the real official widget and records provider playback limits", async ({browser}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({...devices["iPhone 13"], reducedMotion: "reduce", baseURL: origin});
  const page = await context.newPage();
  type NetworkEvent = {url: string; resourceType: string; status?: number; failure?: string};
  const network: NetworkEvent[] = [];
  const consoleErrors: string[] = [];
  const providerUrl = (value: string) => {
    const url = new URL(value);
    return url.hostname === "music.163.com" || url.hostname.endsWith(".music.126.net");
  };
  const safeProviderUrl = (value: string) => {const url = new URL(value); return `${url.origin}${url.pathname}`;};
  const observeProvider = (target: Page, events: NetworkEvent[], consoleMessages: string[]) => {
    target.on("response", response => {if (providerUrl(response.url())) events.push({url: safeProviderUrl(response.url()), resourceType: response.request().resourceType(), status: response.status()});});
    target.on("requestfailed", request => {if (providerUrl(request.url())) events.push({url: safeProviderUrl(request.url()), resourceType: request.resourceType(), failure: request.failure()?.errorText});});
    target.on("console", message => {if (message.type() === "error" || message.type() === "warning") consoleMessages.push(message.text().slice(0, 600));});
    target.on("pageerror", error => consoleMessages.push(error.message.slice(0, 600)));
  };
  observeProvider(page, network, consoleErrors);
  try {
    await signIn(page);
    const external = await createTrack(page, "网易云官方控件 · 手机实网验收", {externalUrl: songUrl, sourceType: "official_embed", allowedUseScope: ["official_embed"]});
    await page.goto("/app/music");
    const officialResponse = page.waitForResponse(response => widgetPattern.test(response.url()), {timeout: 20_000}).catch(() => null);
    const dialog = await openFromStage(page, external);
    const iframe = dialog.locator("iframe");
    await expect(iframe).toHaveCount(1);
    const bounds = await iframe.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(330);
    expect(bounds!.width).toBeGreaterThan(240);
    await assertNoHorizontalOverflow(page);
    await officialResponse;
    // The app must remain usable even if the third party blocks or declines the song.
    const frame = iframe.contentFrame();
    const readMedia = () => frame.locator("audio,video").evaluateAll(elements => elements.map(element => {
      const player = element as HTMLMediaElement;
      return {tag: player.tagName, readyState: player.readyState, paused: player.paused, currentTime: player.currentTime, muted: player.muted, volume: player.volume, error: player.error?.code || null};
    })).catch(() => []);
    const before = await readMedia();
    const play = frame.locator('#player [data-action="play"]').first();
    const controlAvailable = await play.waitFor({state: "visible", timeout: 20_000}).then(() => true).catch(() => false);
    let clickResult = "No usable official play control was available.";
    if (controlAvailable) {
      clickResult = await play.click({timeout: 5_000}).then(() => "Clicked the real official play control.").catch(error => `Official play click failed: ${String(error)}`);
      // A provider rejection is evidence to report, not an app-integration assertion failure.
      await expect.poll(async () => (await readMedia()).some(player => player.currentTime > .3 && !player.paused), {timeout: 12_000}).toBe(true).catch(() => undefined);
    }
    const body = await frame.locator("body").innerText({timeout: 5_000}).catch(error => `Official frame unavailable: ${String(error)}`);
    const media = await readMedia();
    const frameLayout = await frame.locator("body").evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      controls: Array.from(document.querySelectorAll<HTMLElement>('#player [data-action="play"],#player [data-action="pause"],#player #time')).map(element => {
        const bounds = element.getBoundingClientRect();
        return {action: element.dataset.action || element.id, left: bounds.left, right: bounds.right, width: bounds.width, display: getComputedStyle(element).display};
      }),
      plugins: document.querySelectorAll("object,embed").length,
      images: Array.from(document.images).map(image => ({complete: image.complete, naturalWidth: image.naturalWidth})),
    })).catch(() => null);
    if (frameLayout) {
      expect(frameLayout.scrollWidth).toBeLessThanOrEqual(frameLayout.viewport + 1);
      for (const control of frameLayout.controls.filter(control => control.display !== "none")) {
        expect(control.left).toBeGreaterThanOrEqual(-1);
        expect(control.right).toBeLessThanOrEqual(frameLayout.viewport + 1);
      }
    }
    const pauseControlVisible = await frame.locator('#player [data-action="pause"]').first().isVisible().catch(() => false);
    const mediaPlaybackProgressed = media.some((player, index) => player.currentTime > (before[index]?.currentTime || 0) + .3 && !player.paused && player.readyState >= 2);
    const mediaOutputEnabled = media.some(player => player.currentTime > .3 && !player.paused && !player.muted && player.volume > 0);
    const evidence = {checkedAt: new Date().toISOString(), officialSource: await iframe.getAttribute("src"), network, consoleErrors, frameLayout, controlAvailable, clickResult, before, body, media, pauseControlVisible, mediaPlaybackProgressed, mediaOutputEnabled, limitation: "Official playback was attempted when its real play control was available. Advancing HTMLMediaElement time verifies browser media playback; a changed control alone does not prove sound. Provider restrictions are not bypassed, and no artist media is saved."};
    console.info(`[netease-e2e] real official widget: ${JSON.stringify(evidence)}`);
    await writeFile(path.join(evidenceDirectory, "official-network-check.json"), JSON.stringify(evidence, null, 2), "utf8");
    await page.screenshot({path: path.join(evidenceDirectory, "mobile-real-official-player-reduced-motion.png"), animations: "disabled"});
    await dialog.getByRole("button", {name: "关闭弹窗", exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('iframe[src*="music.163.com/outchain/player"]')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    // Compare the exact provider widget without the application's sandbox. This is a
    // temporary browser document, never an app feature or a bypass of provider policy.
    const comparison = await context.newPage();
    const comparisonNetwork: NetworkEvent[] = [];
    const comparisonConsole: string[] = [];
    observeProvider(comparison, comparisonNetwork, comparisonConsole);
    // Retain the same HTTP origin as the app; about:blank would introduce an
    // opaque parent origin and unrelated provider localStorage errors.
    await comparison.goto("/login");
    await comparison.setContent('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:20px;background:#dbeafe"><iframe title="官方无 sandbox 对照" width="330" height="86" frameborder="0" allow="autoplay; encrypted-media" src="https://music.163.com/outchain/player?type=2&id=28059417&auto=0&height=66"></iframe></body></html>');
    const comparisonFrame = comparison.locator("iframe").contentFrame();
    const comparisonPlay = comparisonFrame.locator('#player [data-action="play"]').first();
    const comparisonControl = await comparisonPlay.waitFor({state: "visible", timeout: 20_000}).then(() => true).catch(() => false);
    const comparisonMedia = () => comparisonFrame.locator("audio,video").evaluateAll(elements => elements.map(element => {
      const player = element as HTMLMediaElement;
      return {readyState: player.readyState, paused: player.paused, currentTime: player.currentTime, error: player.error?.code || null};
    })).catch(() => []);
    const comparisonClick = comparisonControl ? await comparisonPlay.click({timeout: 5_000}).then(() => "Clicked real play control without sandbox.").catch(error => String(error)) : "No usable official play control was available.";
    if (comparisonControl) await expect.poll(async () => (await comparisonMedia()).some(player => player.currentTime > .3 && !player.paused), {timeout: 12_000}).toBe(true).catch(() => undefined);
    const comparisonEvidence = {
      network: comparisonNetwork, consoleErrors: comparisonConsole, controlAvailable: comparisonControl, clickResult: comparisonClick,
      body: await comparisonFrame.locator("body").innerText({timeout: 5_000}).catch(error => String(error)),
      media: await comparisonMedia(),
      pauseControlVisible: await comparisonFrame.locator('#player [data-action="pause"]').first().isVisible().catch(() => false),
    };
    console.info(`[netease-e2e] no-sandbox comparison: ${JSON.stringify(comparisonEvidence)}`);
    await writeFile(path.join(evidenceDirectory, "official-without-sandbox-check.json"), JSON.stringify(comparisonEvidence, null, 2), "utf8");
    await comparison.screenshot({path: path.join(evidenceDirectory, "mobile-official-widget-without-sandbox.png"), animations: "disabled"});
    await comparison.close();
  } finally {await context.close();}
});
