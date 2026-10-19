import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type BrowserContext, type Page} from "@playwright/test";

const origin = "http://127.0.0.1:3009";
const evidenceDirectory = path.resolve("verification", "lyrics");
const credentials = {email: `lyrics-${randomUUID()}@example.test`, password: `Lyrics-test-${randomUUID()}-Aa9!`};

type TestTrack = {id: string; title: string; assetId: string};

function toneWav(frequency: number) {
  const sampleRate = 22_050;
  const sampleCount = sampleRate * 30;
  const samples = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) samples.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / sampleRate) * 4_000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + samples.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
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

async function createTrack(page: Page, title: string, frequency: number): Promise<TestTrack> {
  const uploaded = await page.request.post("/api/assets", {
    headers: {Origin: origin},
    multipart: {file: {name: `${frequency}hz-synthetic.wav`, mimeType: "audio/wav", buffer: toneWav(frequency)}},
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const asset = (await uploaded.json()).asset as {id: string};
  const created = await page.request.post("/api/entries", {
    headers: {Origin: origin},
    data: {kind: "music", title, data: {artist: "本地合成音调", year: 2026, tags: ["歌词浏览器验收"], description: "合成测试曲目，检查歌词保存不会覆盖歌曲资料。", assetId: asset.id, sourceType: "authorized_upload"}},
  });
  expect(created.ok(), await created.text()).toBe(true);
  const entry = (await created.json()).entry as {id: string};
  return {id: entry.id, title, assetId: asset.id};
}

async function openLyricsFromStage(page: Page) {
  const stage = page.getByRole("region", {name: "星轨唱片台", exact: true});
  await stage.locator(".lyrics-open-button").click();
  const dialog = page.getByRole("dialog", {name: "正在听 · 歌词", exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", {name: "歌词播放器", exact: true})).toBeVisible();
  return {stage, dialog, lyrics: dialog.getByRole("region", {name: "歌词播放器", exact: true})};
}

async function chooseTrack(page: Page, track: TestTrack) {
  const stage = page.getByRole("region", {name: "星轨唱片台", exact: true});
  const selection = stage.getByRole("combobox", {name: "唱片台选曲", exact: true});
  const heading = (title: string) => stage.getByRole("heading", {level: 2, name: title, exact: true});
  await expect(selection).toBeEnabled();
  await selection.selectOption(track.id);
  await expect(selection).toHaveValue(track.id);
  await expect(heading(track.title)).toBeVisible();
  return stage;
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe.configure({mode: "serial"});

let tracks: {first: TestTrack; second: TestTrack};
let setupContext: APIRequestContext | undefined;

test.beforeAll(async ({playwright}) => {
  setupContext = await playwright.request.newContext({baseURL: origin});
  const status = await (await setupContext.get("/api/auth/status")).json();
  expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
  const response = await setupContext.post("/api/auth/setup", {headers: {Origin: origin}, data: credentials});
  expect(response.ok(), await response.text()).toBe(true);
});

test.afterAll(async () => {await setupContext?.dispose();});

test("LRC follows real playback, seeks both ways, persists per track, and keeps archive data private", async ({browser, playwright}) => {
  test.setTimeout(180_000);
  await mkdir(evidenceDirectory, {recursive: true});
  const context = await browser.newContext({...devices["Desktop Chrome"], viewport: {width: 1440, height: 960}, baseURL: origin});
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  let anonymous: Awaited<ReturnType<typeof playwright.request.newContext>> | undefined;
  try {
    await signIn(page);
    const first = await createTrack(page, "合成旋律 A · 同步歌词验收", 440);
    const second = await createTrack(page, "合成旋律 B · 文本歌词验收", 660);
    tracks = {first, second};

    await page.goto("/app/music");
    const stage = await chooseTrack(page, first);
    await stage.getByRole("button", {name: `唱片台播放${first.title}`, exact: true}).click();
    const audio = page.getByTestId("global-audio");
    await expect(audio).toHaveCount(1);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${first.assetId}`);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.35);

    const opened = await openLyricsFromStage(page);
    const {dialog, lyrics} = opened;
    await expect(lyrics).toHaveAttribute("data-synced", "false");
    const audioHandle = await audio.elementHandle();
    const lrc = [
      "[ar:本地合成音调]",
      "[00:00.00]合成歌词第一句",
      "[00:03.00]合成歌词第二句",
      "[00:06.00]合成歌词第三句",
      "[00:09.00]合成歌词第四句",
    ].join("\n");
    await dialog.getByLabel("选择歌词文件", {exact: true}).setInputFiles({name: "synthetic-test.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc, "utf8")});
    const lines = dialog.locator(".lyrics-line[data-time]");
    await expect(lines).toHaveCount(4);
    await expect(lyrics).toHaveAttribute("data-synced", "true");
    const firstLine = lines.filter({hasText: "合成歌词第一句"});
    const secondLine = lines.filter({hasText: "合成歌词第二句"});
    const thirdLine = lines.filter({hasText: "合成歌词第三句"});
    const fourthLine = lines.filter({hasText: "合成歌词第四句"});
    const progress = dialog.getByRole("slider", {name: "歌词页播放进度", exact: true});
    await progress.focus();
    await progress.press("Home");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeLessThan(.2);
    await expect(firstLine).toHaveAttribute("aria-current", "true");
    await expect.poll(() => secondLine.getAttribute("aria-current"), {timeout: 8_000}).toBe("true");

    // A half-second calibration is saved with the lyrics and changes the seek target.
    await dialog.getByRole("button", {name: "歌词提前 0.5 秒", exact: true}).click();
    await expect(dialog.getByLabel("歌词时间偏移", {exact: true})).toHaveText("提前 0.5 秒");
    await dialog.getByRole("button", {name: "保存校准", exact: true}).click();
    await expect(dialog.locator('.lyrics-feedback [role="status"]')).toContainText("歌词已保存");
    await secondLine.click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(2.6);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeLessThan(3.2);
    await expect(secondLine).toHaveAttribute("aria-current", "true");
    await thirdLine.click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(5.4);
    await expect(thirdLine).toHaveAttribute("aria-current", "true");

    await dialog.getByRole("button", {name: `歌词页暂停${first.title}`, exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await fourthLine.click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(8.4);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeLessThan(8.8);
    await expect(fourthLine).toHaveAttribute("aria-current", "true");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);

    await progress.focus();
    await progress.press("Home");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeLessThan(.15);
    await expect(firstLine).toHaveAttribute("aria-current", "true");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await page.mouse.move(10, 10);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-synchronized-lyrics.png"), animations: "disabled"});

    const saved = (await (await page.request.get(`/api/entries/${first.id}`)).json()).entry;
    expect(saved.data).toMatchObject({assetId: first.assetId, artist: "本地合成音调", year: 2026, tags: ["歌词浏览器验收"], lyrics: lrc, lyricsOffset: 500});
    const overlong = await page.request.patch(`/api/entries/${first.id}`, {headers: {Origin: origin}, data: {data: {...saved.data, lyrics: "x".repeat(100_001)}}});
    expect(overlong.status()).toBe(400);
    const invalidOffset = await page.request.patch(`/api/entries/${first.id}`, {headers: {Origin: origin}, data: {data: {...saved.data, lyricsOffset: 600_001}}});
    expect(invalidOffset.status()).toBe(400);
    const backup = await (await page.request.get("/api/backup")).json();
    const backedUp = backup.entries.find((entry: {id: string}) => entry.id === first.id);
    expect(backedUp.data).toMatchObject({lyrics: lrc, lyricsOffset: 500});
    anonymous = await playwright.request.newContext({baseURL: origin});
    expect((await anonymous.get(`/api/entries/${first.id}`)).status()).toBe(401);
    expect((await anonymous.get("/api/backup")).status()).toBe(401);

    // Closing with Escape restores focus to the opener while leaving the same audio node playing.
    await dialog.getByRole("button", {name: `歌词页播放${first.title}`, exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    const beforeClose = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opened.stage.locator(".lyrics-open-button")).toBeFocused();
    const audioAfterClose = page.getByTestId("global-audio");
    await expect(audioAfterClose).toHaveCount(1);
    expect(await audioAfterClose.evaluate((element, previous) => element === previous, audioHandle)).toBe(true);
    await expect.poll(() => audioAfterClose.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(beforeClose + .2);

    // Next track replaces the lyric document; a TXT import stays readable without timed highlights.
    await opened.stage.getByRole("button", {name: `下一首唱片`, exact: true}).click();
    await expect.poll(() => audioAfterClose.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${second.assetId}`);
    const secondLyrics = await openLyricsFromStage(page);
    await expect(secondLyrics.dialog.getByRole("heading", {name: second.title, exact: true})).toBeVisible();
    await expect(secondLyrics.lyrics).toHaveAttribute("data-synced", "false");
    await expect(secondLyrics.dialog.getByText("合成歌词第一句", {exact: true})).toHaveCount(0);
    const plainText = "合成文本歌词第一行\n合成文本歌词第二行";
    await secondLyrics.dialog.getByLabel("选择歌词文件", {exact: true}).setInputFiles({name: "synthetic-test.txt", mimeType: "text/plain", buffer: Buffer.from(plainText, "utf8")});
    await expect(secondLyrics.dialog.getByText("合成文本歌词第一行", {exact: true})).toBeVisible();
    await expect(secondLyrics.lyrics).toHaveAttribute("data-synced", "false");
    await expect(secondLyrics.dialog.locator(".lyrics-line[data-time]")).toHaveCount(0);
    await expect(secondLyrics.dialog.locator(".lyrics-line[aria-current=true]")).toHaveCount(0);
    const secondSaved = (await (await page.request.get(`/api/entries/${second.id}`)).json()).entry;
    expect(secondSaved.data).toMatchObject({assetId: second.assetId, artist: "本地合成音调", year: 2026, tags: ["歌词浏览器验收"], lyrics: plainText});

    // Track switches from inside the lyrics view must replace its per-song document immediately.
    await secondLyrics.dialog.getByRole("button", {name: "歌词页上一首", exact: true}).click();
    await expect(secondLyrics.dialog.getByRole("heading", {name: first.title, exact: true})).toBeVisible();
    await expect(secondLyrics.dialog.getByText("合成歌词第一句", {exact: true})).toBeVisible();
    await expect(secondLyrics.dialog.getByText("合成文本歌词第一行", {exact: true})).toHaveCount(0);
    await secondLyrics.dialog.getByRole("button", {name: "歌词页下一首", exact: true}).click();
    await expect(secondLyrics.dialog.getByRole("heading", {name: second.title, exact: true})).toBeVisible();
    await expect(secondLyrics.dialog.getByText("合成文本歌词第一行", {exact: true})).toBeVisible();
    await expect(secondLyrics.lyrics).toHaveAttribute("data-synced", "false");

    // Reload proves the LRC and calibration were rendered from persisted entry data.
    await page.reload();
    const reloadedStage = await chooseTrack(page, first);
    await reloadedStage.getByRole("button", {name: `唱片台播放${first.title}`, exact: true}).click();
    const reopened = await openLyricsFromStage(page);
    await expect(reopened.lyrics).toHaveAttribute("data-synced", "true");
    await expect(reopened.dialog.locator(".lyrics-line[data-time]")).toHaveCount(4);
    await expect(reopened.dialog.getByLabel("歌词时间偏移", {exact: true})).toHaveText("提前 0.5 秒");
    await assertNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);

    // The newly added lyrics control must still fit the existing desktop dock just above its mobile breakpoint.
    await page.keyboard.press("Escape");
    await expect(reopened.dialog).toHaveCount(0);
    await page.setViewportSize({width: 840, height: 960});
    const shell = page.getByTestId("music-dock-shell");
    if (await shell.getAttribute("data-state") === "collapsed") await page.getByRole("button", {name: "展开音乐播放器", exact: true}).click();
    const dock = page.getByRole("region", {name: "音乐播放器", exact: true});
    await expect(dock).toBeVisible();
    const dockMetrics = await dock.evaluate(element => {
      const panel = element.getBoundingClientRect();
      const tools = element.querySelector(".music-dock-tools")!.getBoundingClientRect();
      return {viewport: window.innerWidth, panelLeft: Math.round(panel.left), panelRight: Math.round(panel.right), panelClientWidth: element.clientWidth, panelScrollWidth: element.scrollWidth, toolsLeft: Math.round(tools.left), toolsRight: Math.round(tools.right)};
    });
    console.info(`[lyrics-e2e] dock at 840px: ${JSON.stringify(dockMetrics)}`);
    expect(dockMetrics.panelScrollWidth).toBeLessThanOrEqual(dockMetrics.panelClientWidth + 1);
    expect(dockMetrics.toolsRight).toBeLessThanOrEqual(dockMetrics.panelRight + 1);

    // A dock opener may disappear during its idle collapse while the lyrics dialog is active.
    await dock.getByRole("button", {name: "打开歌词", exact: true}).click();
    const dockOpenedLyrics = page.getByRole("dialog", {name: "正在听 · 歌词", exact: true});
    await expect(dockOpenedLyrics).toBeVisible();
    await page.mouse.move(10, 10);
    await expect(shell).toHaveAttribute("data-state", "collapsed", {timeout: 8_000});
    await page.keyboard.press("Escape");
    await expect(dockOpenedLyrics).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement;
      const dockShell = document.querySelector(".music-dock-shell");
      return !!active && active !== document.body && active.isConnected && !!dockShell?.contains(active);
    })).toBe(true);
  } finally {
    await anonymous?.dispose();
    await context.close();
  }
});

test("mobile lyrics remain readable and synchronized with reduced motion", async ({browser}) => {
  test.setTimeout(90_000);
  const context: BrowserContext = await browser.newContext({...devices["Pixel 7"], viewport: {width: 390, height: 844}, reducedMotion: "reduce", baseURL: origin});
  const page = await context.newPage();
  try {
    await signIn(page);
    await page.goto("/app/music");
    const stage = await chooseTrack(page, tracks.first);
    await stage.getByRole("button", {name: `唱片台播放${tracks.first.title}`, exact: true}).click();
    const opened = await openLyricsFromStage(page);
    await expect(opened.lyrics).toHaveAttribute("data-synced", "true");
    const firstLine = opened.dialog.locator('.lyrics-line[data-time="0"]');
    await expect(firstLine).toBeVisible();
    await expect(firstLine).toHaveAttribute("aria-current", "true");
    await assertNoHorizontalOverflow(page);
    expect(await opened.dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
    await expect(page.locator(".lyrics-sleeve")).not.toHaveClass(/is-playing/);
    expect(await page.locator(".lyrics-disc").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
    await page.mouse.move(10, 10);
    await page.screenshot({path: path.join(evidenceDirectory, "mobile-synchronized-lyrics-reduced-motion.png"), animations: "disabled"});
  } finally { await context.close(); }
});
