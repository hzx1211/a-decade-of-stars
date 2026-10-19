import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type Browser, type BrowserContext, type Page} from "@playwright/test";
import {expectNoUploadRightsFields, originalPng} from "./fixtures";

const origin = "http://127.0.0.1:3005";
const evidenceDirectory = path.resolve("verification", "media-library");
const credentials = {email: `media-${randomUUID()}@example.test`, password: `Media-test-${randomUUID()}-Aa9!`};

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

async function syntheticWebm(page: Page) {
  const bytes = await page.evaluate(async () => {
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find(candidate => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("此浏览器不支持生成合成 WebM 测试文件");
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 WebM 测试画面");
    let frame = 0;
    const draw = () => {
      context.fillStyle = "#07152e"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#b9ddfc"; context.beginPath(); context.arc(48 + (frame % 220), 90, 18, 0, Math.PI * 2); context.fill(); frame++;
    };
    draw();
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, {mimeType});
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, {type: "video/webm"})); });
    recorder.start();
    const ticker = window.setInterval(draw, 80);
    await new Promise(resolve => window.setTimeout(resolve, 1_400));
    window.clearInterval(ticker);
    recorder.stop();
    const blob = await stopped;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
  await page.getByLabel("密码", {exact: true}).fill(credentials.password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.getByRole("heading", {name: /张杰/, level: 1})).toBeVisible();
}

async function openMusicDock(page: Page) {
  const shell = page.getByTestId("music-dock-shell");
  if (await shell.getAttribute("data-state") === "collapsed") {
    await page.getByRole("button", {name: "展开音乐播放器", exact: true}).click();
  }
  await expect(shell).toHaveAttribute("data-state", "expanded");
  const dock = page.getByRole("region", {name: "音乐播放器", exact: true});
  await expect(dock).toBeVisible();
  return dock;
}

async function clearDockHoverAndFocus(page: Page) {
  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur();});
  await page.mouse.move(12, 12);
}

async function uploadFromLibrary(page: Page, options: {
  route: string; action: string; fileLabel: string; filename: string; mimeType: string; buffer: Buffer; title: string;
}) {
  await page.goto(options.route);
  const action = page.getByRole("button", {name: options.action, exact: true});
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const fileInput = dialog.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles({name: options.filename, mimeType: options.mimeType, buffer: options.buffer});
  await expect(dialog.locator(".media-import-file strong")).toHaveText(options.filename);
  await dialog.getByLabel("标题", {exact: true}).fill(options.title);
  await expectNoUploadRightsFields(dialog);
  await dialog.getByRole("button", {name: "上传并保存", exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", {name: options.title, exact: true})).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function reducedMotionMobile(browser: Browser) {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    reducedMotion: "reduce",
    baseURL: origin,
  });
  return {context, page: await context.newPage()};
}

test("private media import, playback continuity, lightbox, and real browser decoding", async ({browser, playwright}) => {
  test.setTimeout(240_000);
  await mkdir(evidenceDirectory, {recursive: true});
  const dataDirectory = process.env.STARS_MEDIA_E2E_DATA_DIR;
  if (!dataDirectory || !path.relative(path.resolve(".test-data"), dataDirectory).startsWith("media-library-")) {
    throw new Error("Run this suite with playwright.media.config.ts and its isolated local data directory");
  }

  const setup = await playwright.request.newContext({baseURL: origin});
  const initial = await (await setup.get("/api/auth/status")).json();
  expect(initial).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
  const created = await setup.post("/api/auth/setup", {headers: {Origin: origin}, data: credentials});
  expect(created.ok(), await created.text()).toBe(true);

  const desktopContext = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: {width: 1440, height: 1000},
    baseURL: origin,
  });
  const page = await desktopContext.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  let anonymous: Awaited<ReturnType<typeof playwright.request.newContext>> | undefined;
  let mobile: {context: BrowserContext; page: Page} | undefined;

  try {
    await signIn(page);
    await noHorizontalOverflow(page);
    const meteor = page.locator(".starsea-backdrop");
    await expect(meteor).toHaveAttribute("data-meteor-state", "passing", {timeout: 22_000});
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-starsea-meteor-passing.png"), animations: "disabled"});

    const targetTitle = "素材补传验收 · 保留原记录";
    const targetCreate = await page.request.post("/api/entries", {
      headers: {Origin: origin},
      data: {kind: "music", title: targetTitle, data: {artist: "张杰", year: 2014, tags: ["补传后保留", "原有标签"], description: "用于验收给既有记录补上音频。"}},
    });
    expect(targetCreate.ok(), await targetCreate.text()).toBe(true);
    const targetEntry = (await targetCreate.json()).entry as {id: string};
    const initialMusic = (await (await page.request.get("/api/entries?kind=music")).json()).entries as Array<{id: string}>;
    expect(initialMusic.filter(entry => entry.id === targetEntry.id)).toHaveLength(1);
    await page.goto("/app/music");
    const stage = page.getByRole("region", {name: "星轨唱片台", exact: true});
    await expect(stage).toBeVisible();
    await expect(stage.getByRole("heading", {level: 2, name: targetTitle, exact: true})).toBeVisible();
    await expect(stage.getByText("添加音频，让唱片转起来", {exact: true})).toBeVisible();
    await expect(stage.getByRole("button", {name: "添加音频", exact: true})).toBeVisible();
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-stage-player-empty.png"), fullPage: true, animations: "disabled"});
    // The large record itself must open the importer for this exact record.
    await stage.getByRole("button", {name: `为${targetTitle}添加音频`, exact: true}).click();
    const targetDialog = page.getByRole("dialog");
    await expect(targetDialog.getByLabel("标题", {exact: true})).toHaveValue(targetTitle);
    await targetDialog.locator('input[type="file"]').setInputFiles({name: "synthetic-target.wav", mimeType: "audio/wav", buffer: toneWav(330)});
    await expect(targetDialog.locator(".media-import-file strong")).toHaveText("synthetic-target.wav");
    await expectNoUploadRightsFields(targetDialog);
    await targetDialog.getByTestId("media-import-submit").click();
    await expect(targetDialog).toHaveCount(0);
    const updatedTarget = (await (await page.request.get(`/api/entries/${targetEntry.id}`)).json()).entry;
    expect(updatedTarget.id).toBe(targetEntry.id);
    expect(updatedTarget.title).toBe(targetTitle);
    expect(updatedTarget.data).toMatchObject({year: 2014, tags: ["补传后保留", "原有标签"], sourceType: "authorized_upload"});
    expect(updatedTarget.data.assetId).toBeTruthy();
    const afterMusic = (await (await page.request.get("/api/entries?kind=music")).json()).entries as Array<{id: string}>;
    expect(afterMusic.filter(entry => entry.id === targetEntry.id)).toHaveLength(1);
    expect(afterMusic).toHaveLength(initialMusic.length);
    const targetAssetId = updatedTarget.data.assetId as string;
    await expect(stage.getByRole("button", {name: `播放唱片 ${targetTitle}`, exact: true})).toBeVisible();
    await stage.getByRole("button", {name: `播放唱片 ${targetTitle}`, exact: true}).click();
    const audio = page.getByTestId("global-audio");
    const dock = page.getByRole("region", {name: "音乐播放器", exact: true});
    await expect(audio).toHaveCount(1);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${targetAssetId}`);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.2);
    await expect(stage).toHaveAttribute("data-playing", "true");
    await expect(dock.getByRole("link", {name: targetTitle, exact: true})).toBeVisible();
    await expect.poll(() => stage.locator(".collection-record").evaluate(element => getComputedStyle(element).animationPlayState)).toBe("running");
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-stage-player-playing.png"), fullPage: true, animations: "disabled"});

    await stage.getByRole("button", {name: `暂停唱片 ${targetTitle}`, exact: true}).click();
    await expect(stage).toHaveAttribute("data-playing", "false");
    await expect.poll(() => stage.locator(".collection-record").evaluate(element => getComputedStyle(element).animationPlayState)).toBe("paused");
    const stagePausedAt = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await page.waitForTimeout(300);
    expect(Math.abs((await audio.evaluate(element => (element as HTMLAudioElement).currentTime)) - stagePausedAt)).toBeLessThan(.03);

    const stageProgress = stage.getByRole("slider", {name: "唱片台播放进度", exact: true});
    await stageProgress.focus(); await stageProgress.press("Home");
    for (let step = 0; step < 4; step++) await stageProgress.press("ArrowRight");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.25);
    const dockProgress = dock.getByRole("slider", {name: "播放进度", exact: true});
    await expect.poll(async () => Math.abs(Number(await stageProgress.inputValue()) - Number(await dockProgress.inputValue()))).toBeLessThan(.11);
    await expect.poll(async () => stageProgress.getAttribute("aria-valuetext")).toBe(await dockProgress.getAttribute("aria-valuetext"));

    const stageVolume = stage.getByRole("slider", {name: "唱片台音量", exact: true});
    const dockVolume = dock.getByRole("slider", {name: "音量", exact: true});
    await stageVolume.focus(); await stageVolume.press("End");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).volume)).toBeGreaterThan(.95);
    await expect.poll(async () => Number(await dockVolume.inputValue())).toBeGreaterThan(.95);
    await stageVolume.press("Home");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).volume)).toBeLessThan(.05);
    await expect.poll(async () => Number(await dockVolume.inputValue())).toBeLessThan(.05);
    await stageVolume.press("End");

    const firstTitle = "本地合成音调 · A";
    const secondTitle = "本地合成音调 · B";
    await uploadFromLibrary(page, {
      route: "/app/music", action: "上传歌曲", fileLabel: "选择音频文件", filename: "synthetic-tone-a.wav",
      mimeType: "audio/wav", buffer: toneWav(440), title: firstTitle,
    });
    await uploadFromLibrary(page, {
      route: "/app/music", action: "上传歌曲", fileLabel: "选择音频文件", filename: "synthetic-tone-b.wav",
      mimeType: "audio/wav", buffer: toneWav(660), title: secondTitle,
    });

    const assetsResponse = await page.request.get("/api/assets");
    expect(assetsResponse.ok()).toBe(true);
    const assets = (await assetsResponse.json()).assets as Array<{id: string; filename: string; size: number}>;
    const firstAsset = assets.find(asset => asset.filename === "synthetic-tone-a.wav");
    const secondAsset = assets.find(asset => asset.filename === "synthetic-tone-b.wav");
    expect(firstAsset).toBeTruthy(); expect(secondAsset).toBeTruthy();
    const uploadedEntries = (await (await page.request.get("/api/entries?kind=music")).json()).entries as Array<{id: string; title: string}>;
    const firstEntry = uploadedEntries.find(entry => entry.title === firstTitle);
    const secondEntry = uploadedEntries.find(entry => entry.title === secondTitle);
    expect(firstEntry).toBeTruthy(); expect(secondEntry).toBeTruthy();
    const entryTitles = new Map(uploadedEntries.map(entry => [entry.id, entry.title]));

    const stageSelection = stage.getByRole("combobox", {name: "唱片台选曲", exact: true});
    const stageChoices = await stageSelection.locator("option").evaluateAll(options => options.map(option => ({value: (option as HTMLOptionElement).value, title: option.textContent?.trim() || ""})));
    expect(stageChoices.map(option => option.value)).toEqual(expect.arrayContaining([targetEntry.id, firstEntry!.id, secondEntry!.id]));
    const currentIndex = stageChoices.findIndex(option => option.value === targetEntry.id);
    const nextChoice = stageChoices[(currentIndex + 1) % stageChoices.length];
    const nextAfterChoice = stageChoices[(currentIndex + 2) % stageChoices.length];
    const trackAssetIds = new Map<string, string>([[targetEntry.id, targetAssetId], [firstEntry!.id, firstAsset!.id], [secondEntry!.id, secondAsset!.id]]);
    await stageSelection.selectOption(targetEntry.id);
    await expect(stage.getByRole("heading", {level: 2, name: targetTitle, exact: true})).toBeVisible();
    await stage.getByRole("button", {name: `播放唱片 ${targetTitle}`, exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${targetAssetId}`);
    await stage.getByRole("button", {name: "下一首唱片", exact: true}).click();
    await expect(stage.getByRole("heading", {level: 2, name: entryTitles.get(nextChoice.value), exact: true})).toBeVisible();
    await expect(stageSelection).toHaveValue(nextChoice.value);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${trackAssetIds.get(nextChoice.value)}`);
    await stage.getByRole("button", {name: "上一首唱片", exact: true}).click();
    await expect(stage.getByRole("heading", {level: 2, name: targetTitle, exact: true})).toBeVisible();
    await expect(stageSelection).toHaveValue(targetEntry.id);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${targetAssetId}`);
    await stage.getByRole("button", {name: "下一首唱片", exact: true}).click();
    await expect(stage.getByRole("heading", {level: 2, name: entryTitles.get(nextChoice.value), exact: true})).toBeVisible();
    await expect(stageSelection).toHaveValue(nextChoice.value);
    await openMusicDock(page);
    await dock.getByRole("button", {name: "下一首", exact: true}).click();
    await expect(stage.getByRole("heading", {level: 2, name: entryTitles.get(nextAfterChoice.value), exact: true})).toBeVisible();
    await expect(stageSelection).toHaveValue(nextAfterChoice.value);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${trackAssetIds.get(nextAfterChoice.value)}`);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-stage-player-track-sync.png"), fullPage: true, animations: "disabled"});

    // Add enough metadata-only songs to exercise the real second page without
    // changing the three-track order assertions above.
    const metadataOnlyTitles = Array.from({length: 17}, (_, index) => `E2E 元数据记录 ${String(index + 1).padStart(2, "0")}`);
    for (const [index, title] of metadataOnlyTitles.entries()) {
      const response = await page.request.post("/api/entries", {
        headers: {Origin: origin},
        data: {kind: "music", title, data: {artist: "E2E 合成记录", year: 2026, category: "E2E 元数据测试", description: `仅用于验证唱片台与分页联动的测试记录 ${index + 1}。`}},
      });
      expect(response.ok(), await response.text()).toBe(true);
      await page.waitForTimeout(5);
    }
    const allMusicEntries = (await (await page.request.get("/api/entries?kind=music")).json()).entries as Array<{id: string; title: string}>;
    expect(allMusicEntries).toHaveLength(20);
    expect(allMusicEntries.filter(entry => metadataOnlyTitles.includes(entry.title))).toHaveLength(17);

    // A hard reload picks up the API-created entries in the server-rendered page.
    await page.reload();
    const pagedStage = page.getByRole("region", {name: "星轨唱片台", exact: true});
    const pagedSelection = pagedStage.getByRole("combobox", {name: "唱片台选曲", exact: true});
    await expect(pagedSelection.locator("option")).toHaveCount(20);
    const secondPage = page.getByRole("navigation", {name: "记录分页", exact: true});
    await expect(secondPage).toContainText("第 1 / 2 页");
    await secondPage.getByRole("button", {name: "下一页", exact: true}).click();
    await expect(secondPage).toContainText("第 2 / 2 页");

    const firstCardOnSecondPage = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: firstTitle, exact: true})});
    const firstCardTitle = firstCardOnSecondPage.locator("h2 > button");
    await expect(firstCardTitle).toBeVisible();
    await firstCardTitle.click();
    await expect(firstCardTitle).toHaveAttribute("aria-pressed", "true");
    await expect(pagedStage.getByRole("heading", {level: 2, name: firstTitle, exact: true})).toBeVisible();
    await expect(pagedSelection).toHaveValue(firstEntry!.id);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${firstAsset!.id}`);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);

    const metadataTitleButton = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: metadataOnlyTitles[0], exact: true})}).locator("h2 > button");
    await expect(metadataTitleButton).toBeVisible();
    await metadataTitleButton.click();
    await expect(metadataTitleButton).toHaveAttribute("aria-pressed", "true");
    await expect(pagedStage.getByRole("heading", {level: 2, name: metadataOnlyTitles[0], exact: true})).toBeVisible();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${firstAsset!.id}`);

    // Selecting A from its cover must restore it even though A is still the
    // global currentId and the metadata-only selection paused that audio.
    const firstCardCover = firstCardOnSecondPage.getByRole("button", {name: `选择${firstTitle}`, exact: true});
    await firstCardCover.click();
    await expect(firstCardTitle).toHaveAttribute("aria-pressed", "true");
    await expect(pagedStage.getByRole("heading", {level: 2, name: firstTitle, exact: true})).toBeVisible();
    await expect(pagedSelection).toHaveValue(firstEntry!.id);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${firstAsset!.id}`);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);

    // Idle collapse must leave the one global audio element playing. The
    // collapsed shell must also leave archive controls clickable above its handle.
    const dockShell = page.getByTestId("music-dock-shell");
    const playingBeforeIdleCollapse = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await clearDockHoverAndFocus(page);
    await expect(dockShell).toHaveAttribute("data-state", "collapsed", {timeout: 8_000});
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(playingBeforeIdleCollapse + .4);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    await metadataTitleButton.evaluate(element => element.scrollIntoView({block: "center"}));
    const clickThroughHit = await metadataTitleButton.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return !!hit && (hit === element || element.contains(hit)) && bounds.bottom < window.innerHeight - 48;
    });
    expect(clickThroughHit).toBe(true);
    await metadataTitleButton.click();
    await expect(metadataTitleButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);

    // Keyboard activation of the collapsed handle opens and focuses the dock.
    await firstCardTitle.click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    const keyboardHandle = page.getByRole("button", {name: "展开音乐播放器", exact: true});
    await expect(dockShell).toHaveAttribute("data-state", "collapsed");
    await keyboardHandle.focus();
    await keyboardHandle.press("Enter");
    await expect(dockShell).toHaveAttribute("data-state", "expanded");
    const keyboardDock = await openMusicDock(page);
    await expect(keyboardDock.getByRole("button", {name: "暂停音乐", exact: true})).toBeFocused();
    // Keyboard focus inside the controls protects the expanded panel past its idle delay.
    await page.waitForTimeout(4_300);
    await expect(dockShell).toHaveAttribute("data-state", "expanded");
    await firstCardTitle.focus();
    await expect(dockShell).toHaveAttribute("data-state", "collapsed", {timeout: 8_000});

    // Scrolling outside the dock collapses it, with playback continuing.
    const scrollDock = await openMusicDock(page);
    await expect(scrollDock.getByRole("button", {name: "暂停音乐", exact: true})).toBeVisible();
    await clearDockHoverAndFocus(page);
    const playingBeforeScroll = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await page.evaluate(() => window.scrollBy(0, 120));
    await expect(dockShell).toHaveAttribute("data-state", "collapsed");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(playingBeforeScroll + .2);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-music-player-collapsed.png"), animations: "disabled"});

    anonymous = await playwright.request.newContext({baseURL: origin});
    expect((await anonymous.get(`/api/assets/${firstAsset!.id}`)).status()).toBe(401);
    const ranged = await page.request.get(`/api/assets/${firstAsset!.id}`, {headers: {Range: "bytes=0-43"}});
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-range"]).toBe(`bytes 0-43/${firstAsset!.size}`);
    expect((await ranged.body()).subarray(0, 4).toString()).toBe("RIFF");

    // Stop whichever track the order-derived dock-next selected so the known card always exposes its play action.
    await openMusicDock(page);
    await dock.getByRole("button", {name: "暂停音乐", exact: true}).click();
    const firstCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: firstTitle, exact: true})});
    await firstCard.getByRole("button", {name: `播放${firstTitle}`, exact: true}).click();
    const player = await openMusicDock(page);
    await expect(audio).toHaveCount(1);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${firstAsset!.id}`);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.2);
    await expect(player.getByRole("button", {name: "暂停音乐", exact: true})).toBeVisible();
    const firstSource = await audio.evaluate(element => (element as HTMLAudioElement).currentSrc);
    await player.getByRole("button", {name: "下一首", exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).not.toBe(firstSource);
    const knownAudioIds = assets.filter(asset => asset.filename.endsWith(".wav")).map(asset => asset.id);
    const nextSource = await audio.evaluate(element => (element as HTMLAudioElement).currentSrc);
    expect(knownAudioIds.some(id => nextSource.endsWith(`/api/assets/${id}`))).toBe(true);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.15);
    await player.getByRole("button", {name: "上一首", exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${firstAsset!.id}`);
    await player.getByRole("button", {name: "下一首", exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).not.toBe(firstSource);

    await player.getByRole("button", {name: "暂停音乐", exact: true}).click();
    const pausedAt = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await page.waitForTimeout(300);
    expect(Math.abs((await audio.evaluate(element => (element as HTMLAudioElement).currentTime)) - pausedAt)).toBeLessThan(.03);
    const progress = player.getByRole("slider", {name: "播放进度", exact: true});
    await progress.focus(); await progress.press("Home");
    for (let step = 0; step < 4; step++) await progress.press("ArrowRight");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.25);
    await player.getByRole("button", {name: "播放音乐", exact: true}).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.4);

    const volume = player.getByRole("slider", {name: "音量", exact: true});
    await volume.focus(); await volume.press("End");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).volume)).toBeGreaterThan(.95);
    await volume.press("Home");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).volume)).toBeLessThan(.05);
    await volume.press("End");

    const audioHandle = await audio.elementHandle();
    const sourceAtRoute = await audio.evaluate(element => (element as HTMLAudioElement).currentSrc);
    const activeAtRoute = [...trackAssetIds].find(([, assetId]) => sourceAtRoute.endsWith(`/api/assets/${assetId}`));
    expect(activeAtRoute).toBeTruthy();
    const [expectedReturnId, expectedReturnAssetId] = activeAtRoute!;
    const expectedReturnTitle = entryTitles.get(expectedReturnId)!;
    const beforeRoute = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await page.getByRole("link", {name: "照片馆", exact: true}).click();
    await expect(page).toHaveURL(/\/app\/photos\/?$/);
    const audioAfterNavigation = page.getByTestId("global-audio");
    await expect(audioAfterNavigation).toHaveCount(1);
    expect(await audioAfterNavigation.evaluate((element, previous) => element === previous, audioHandle)).toBe(true);
    await expect.poll(() => audioAfterNavigation.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(beforeRoute + .15);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-music-player.png"), fullPage: true, animations: "disabled"});
    await page.getByRole("link", {name: "音乐馆", exact: true}).click();
    await expect(page).toHaveURL(/\/app\/music\/?$/);
    const returnedStage = page.getByRole("region", {name: "星轨唱片台", exact: true});
    await expect(returnedStage.getByRole("heading", {level: 2, name: expectedReturnTitle, exact: true})).toBeVisible();
    await expect(returnedStage.getByRole("combobox", {name: "唱片台选曲", exact: true})).toHaveValue(expectedReturnId);
    const audioAfterReturn = page.getByTestId("global-audio");
    await expect(audioAfterReturn).toHaveCount(1);
    expect(await audioAfterReturn.evaluate((element, previous) => element === previous, audioHandle)).toBe(true);
    await expect.poll(() => audioAfterReturn.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${expectedReturnAssetId}`);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-stage-player-return-sync.png"), fullPage: true, animations: "disabled"});
    await page.getByRole("link", {name: "照片馆", exact: true}).click();
    await expect(page).toHaveURL(/\/app\/photos\/?$/);

    const firstPhotoTitle = "本地合成星点 · A";
    const secondPhotoTitle = "本地合成星点 · B";
    await uploadFromLibrary(page, {
      route: "/app/photos", action: "添加照片", fileLabel: "选择照片文件", filename: "synthetic-stars-a.png",
      mimeType: "image/png", buffer: originalPng(), title: firstPhotoTitle,
    });
    await uploadFromLibrary(page, {
      route: "/app/photos", action: "添加照片", fileLabel: "选择照片文件", filename: "synthetic-stars-b.png",
      mimeType: "image/png", buffer: originalPng(), title: secondPhotoTitle,
    });
    const photo = page.getByRole("button", {name: `在灯箱查看${firstPhotoTitle}`, exact: true});
    await photo.click();
    const lightbox = page.getByRole("dialog");
    await expect(lightbox.getByRole("img", {name: firstPhotoTitle, exact: true})).toBeVisible();
    await expect.poll(() => lightbox.getByRole("img", {name: firstPhotoTitle, exact: true}).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press("ArrowRight");
    await expect(lightbox.getByRole("img", {name: secondPhotoTitle, exact: true})).toBeVisible();
    await expect.poll(() => lightbox.getByRole("img", {name: secondPhotoTitle, exact: true}).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press("ArrowLeft");
    await expect(lightbox.getByRole("img", {name: firstPhotoTitle, exact: true})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-photo-library.png"), fullPage: true, animations: "disabled"});

    const videoTitle = "本地合成现场短片";
    const videoBytes = await syntheticWebm(page);
    await uploadFromLibrary(page, {
      route: "/app/videos", action: "上传演唱会视频", fileLabel: "选择视频文件", filename: "synthetic-concert.webm",
      mimeType: "video/webm", buffer: videoBytes, title: videoTitle,
    });
    await page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: videoTitle, exact: true})}).getByRole("link", {name: "展开记忆", exact: true}).click();
    const video = page.locator("video");
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).duration)).toBeGreaterThan(.6);
    await video.evaluate(async element => {const media = element as HTMLVideoElement; media.muted = true; await media.play();});
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(.15);
    await video.evaluate(element => {const media = element as HTMLVideoElement; media.pause(); media.currentTime = .45;});
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(.35);
    expect(await video.evaluate(element => (element as HTMLVideoElement).error)).toBeNull();
    await noHorizontalOverflow(page);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-video-playback.png"), fullPage: true, animations: "disabled"});

    mobile = await reducedMotionMobile(browser);
    const mobilePage = mobile.page;
    await signIn(mobilePage);
    await mobilePage.goto("/app/dashboard");
    await expect(mobilePage.locator(".starsea-backdrop")).toHaveAttribute("data-meteor-state", "disabled");
    await expect(mobilePage.locator(".starsea-backdrop")).toHaveAttribute("data-motion-state", "paused");
    await mobilePage.goto("/app/music"); await noHorizontalOverflow(mobilePage);
    const mobileStage = mobilePage.getByRole("region", {name: "星轨唱片台", exact: true});
    await expect(mobileStage).toBeVisible();
    await mobileStage.getByRole("combobox", {name: "唱片台选曲", exact: true}).selectOption(firstEntry!.id);
    await mobileStage.getByRole("button", {name: /^唱片台播放/}).click();
    const mobilePlayer = mobilePage.getByRole("region", {name: "音乐播放器", exact: true});
    const mobileDockShell = mobilePage.getByTestId("music-dock-shell");
    await expect(mobilePlayer).toBeVisible();
    await expect.poll(() => mobilePage.getByTestId("global-audio").evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${firstAsset!.id}`);
    await noHorizontalOverflow(mobilePage);
    await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-stage-player-reduced-motion.png"), fullPage: true, animations: "disabled"});

    const mobileAudio = mobilePage.getByTestId("global-audio");
    const mobileTimeBeforeCollapse = await mobileAudio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await expect.poll(() => mobileAudio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    await clearDockHoverAndFocus(mobilePage);
    await expect(mobileDockShell).toHaveAttribute("data-state", "collapsed", {timeout: 8_000});
    await expect.poll(() => mobileAudio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(mobileTimeBeforeCollapse + .3);
    await expect.poll(() => mobileAudio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-music-player-reduced-motion.png"), animations: "disabled"});
    await mobilePage.getByRole("button", {name: "展开音乐播放器", exact: true}).tap();
    await expect(mobileDockShell).toHaveAttribute("data-state", "expanded");
    await expect(mobilePlayer).toBeVisible();

    await mobilePage.getByRole("button", {name: "上传歌曲", exact: true}).click();
    const mobileDialog = mobilePage.getByRole("dialog");
    await mobileDialog.locator('input[type="file"]').setInputFiles({name: "synthetic-mobile-upload.wav", mimeType: "audio/wav", buffer: toneWav(550)});
    await expect(mobileDialog.locator(".media-import-file strong")).toHaveText("synthetic-mobile-upload.wav");
    await noHorizontalOverflow(mobilePage);
    const dialogWidth = await mobileDialog.evaluate(element => element.getBoundingClientRect().width);
    expect(dialogWidth).toBeLessThanOrEqual(await mobilePage.evaluate(() => window.innerWidth));
    await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-media-upload-dialog.png"), animations: "disabled"});
    await mobileDialog.getByRole("button", {name: "关闭弹窗", exact: true}).click();
    await expect(mobileDialog).toHaveCount(0);

    await mobilePage.goto("/app/photos"); await noHorizontalOverflow(mobilePage);
    await mobilePage.goto("/app/videos"); await noHorizontalOverflow(mobilePage);
    await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-video-library-reduced-motion.png"), fullPage: true, animations: "disabled"});

    expect(pageErrors).toEqual([]);
  } finally {
    await mobile?.context.close();
    await anonymous?.dispose();
    await desktopContext.close();
    await setup.dispose();
  }
});
