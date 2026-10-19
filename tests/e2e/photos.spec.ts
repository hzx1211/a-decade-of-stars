import {randomUUID} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {deflateSync} from "node:zlib";
import {expect, test, type Locator, type Page} from "@playwright/test";
import {expectNoUploadRightsFields, originalWav} from "./fixtures";

const origin = "http://127.0.0.1:3012";
const evidenceDirectory = path.resolve("verification", "photos");
const credentials = {email: `photos-${randomUUID()}@example.test`, password: `Photos-${randomUUID()}-Aa9!`};
const quickTitle = "原创照片验收 · 蓝白光束";
const editorTitle = "原创照片验收 · 编辑器上传";

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer) {
  const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}

function originalPhoto() {
  const width = 480; const height = 320;
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const stripe = Math.abs(x - width / 2 + y * .55) < 26 || (x > 35 && x < 100 && y > 35 && y < 100);
    const offset = y * (1 + width * 3) + 1 + x * 3;
    scanlines[offset] = stripe ? 233 : 12 + Math.round(x / width * 15);
    scanlines[offset + 1] = stripe ? 244 : 55 + Math.round(y / height * 65);
    scanlines[offset + 2] = stripe ? 255 : 140 + Math.round(x / width * 90);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0))]);
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
  await page.getByLabel("密码", {exact: true}).fill(credentials.password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
}

async function imageEvidence(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(480);
  return image.evaluate(element => {
    const image = element as HTMLImageElement;
    const rect = image.getBoundingClientRect(); const style = getComputedStyle(image);
    return {src: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
      visibility: style.visibility, display: style.display, opacity: style.opacity};
  });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function importPhoto(page: Page, title: string, filename: string, screenshotFile?: string) {
  await page.getByRole("button", {name: "添加照片", exact: true}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("选择照片文件", {exact: true}).setInputFiles({name: filename, mimeType: "image/png", buffer: originalPhoto()});
  const selectedFile = dialog.locator(".media-import-file strong");
  await expect(selectedFile).toHaveText(filename);
  await expect.poll(() => selectedFile.evaluate(element => {
    let opacity = 1;
    for (let current: Element | null = element; current; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity);
    return opacity;
  })).toBeGreaterThan(.98);
  await dialog.getByLabel("标题", {exact: true}).fill(title);
  await expectNoUploadRightsFields(dialog);
  if (screenshotFile) await page.screenshot({path: path.join(evidenceDirectory, screenshotFile), animations: "disabled"});
  await dialog.getByRole("button", {name: "上传并保存", exact: true}).click();
  await expect(dialog).toHaveCount(0);
}

async function importPlayable(page: Page, kind: "music" | "videos", title: string, file: {name: string; mimeType: string; buffer: Buffer}) {
  await page.goto(`/app/${kind}`);
  await page.getByRole("button", {name: kind === "music" ? "上传歌曲" : "上传演唱会视频", exact: true}).click();
  const dialog = page.getByRole("dialog");
  await expectNoUploadRightsFields(dialog);
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await dialog.getByLabel("标题", {exact: true}).fill(title);
  await dialog.getByRole("button", {name: "上传并保存", exact: true}).click();
  await expect(dialog).toHaveCount(0);
  const entries = (await (await page.request.get(`/api/entries?kind=${kind}`)).json()).entries as Array<{id: string; title: string; data: {assetId: string}}>;
  const entry = entries.find(entry => entry.title === title)!;
  expect(entry.data.assetId).toBeTruthy();
  return entry;
}

async function originalVideo(page: Page) {
  return Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d")!; let frame = 0;
    const draw = () => {
      context.fillStyle = "#102e70"; context.fillRect(0, 0, 320, 180);
      context.fillStyle = "#e8f4ff"; context.fillRect(24 + frame % 200, 65, 45, 45); frame++;
    };
    canvas.style.cssText = "position:fixed;left:0;top:0;opacity:.01;pointer-events:none"; document.body.append(canvas);
    draw(); const stream = canvas.captureStream(0); const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const recorder = new MediaRecorder(stream, {mimeType: "video/webm;codecs=vp8"});
    const chunks: BlobPart[] = []; recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<Blob>(resolve => {recorder.onstop = () => resolve(new Blob(chunks, {type: "video/webm"}));});
    recorder.start(); track.requestFrame();
    const ticker = setInterval(() => {draw(); track.requestFrame();}, 80);
    await new Promise(resolve => setTimeout(resolve, 1_300)); clearInterval(ticker); recorder.stop();
    const blob = await stopped; stream.getTracks().forEach(track => track.stop()); canvas.remove();
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
}

test("private uploads need only files and titles while photos, playback, and home artwork persist", async ({browser, playwright}) => {
  await mkdir(evidenceDirectory, {recursive: true});
  const dataDirectory = process.env.STARS_PHOTOS_E2E_DATA_DIR;
  if (!dataDirectory || !path.relative(path.resolve(".test-data"), dataDirectory).startsWith("photos-")) throw new Error("Use isolated playwright.photos.config.ts");
  const setup = await playwright.request.newContext({baseURL: origin});
  const status = await (await setup.get("/api/auth/status")).json();
  expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
  const created = await setup.post("/api/auth/setup", {headers: {Origin: origin}, data: credentials});
  expect(created.ok(), await created.text()).toBe(true);
  const desktop = await browser.newContext({baseURL: origin, viewport: {width: 1440, height: 1000}});
  const page = await desktop.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const evidence: Record<string, unknown> = {};
  try {
    await signIn(page);
    await page.goto("/app/photos");
    await importPhoto(page, quickTitle, "original-blue-beam.png", "desktop-file-only-photo-dialog.png");
    await page.reload();
    const quickCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: quickTitle, exact: true})});
    evidence.desktopCard = await imageEvidence(quickCard.getByRole("img", {name: quickTitle, exact: true}));
    await noOverflow(page);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-photo-library.png"), fullPage: true, animations: "disabled"});
    await quickCard.getByRole("button", {name: `在灯箱查看${quickTitle}`, exact: true}).click();
    let dialog = page.getByRole("dialog");
    evidence.desktopLightbox = await imageEvidence(dialog.getByRole("img", {name: quickTitle, exact: true}));
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-photo-lightbox.png"), animations: "disabled"});
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await quickCard.getByRole("link", {name: "展开记忆", exact: true}).click();
    evidence.desktopDetail = await imageEvidence(page.getByRole("img", {name: quickTitle, exact: true}));
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-photo-detail.png"), fullPage: true, animations: "disabled"});

    // An older metadata-only record must be repairable without losing its identity.
    const metadata = await page.request.post("/api/entries", {headers: {Origin: origin}, data: {kind: "photos", title: editorTitle, data: {year: 2009}}});
    expect(metadata.ok(), await metadata.text()).toBe(true);
    const metadataEntry = (await metadata.json()).entry as {id: string};
    await page.goto("/app/photos");
    await page.getByRole("button", {name: `编辑${editorTitle}`, exact: true}).click();
    dialog = page.getByRole("dialog");
    const mediaToggle = dialog.getByRole("button", {name: /添加照片/, exact: false});
    if (await mediaToggle.getAttribute("aria-expanded") === "false") await mediaToggle.click();
    await dialog.getByRole("button", {name: "上传新文件", exact: true}).click();
    const upload = dialog.getByRole("region", {name: "上传媒体文件", exact: true});
    await upload.getByTestId("upload-file").setInputFiles({name: "original-editor-beam.png", mimeType: "image/png", buffer: originalPhoto()});
    evidence.pendingPreview = await imageEvidence(upload.getByRole("img", {name: "待上传照片预览：original-editor-beam.png", exact: true}));
    // Choosing a file must not silently save a record with no asset.
    await dialog.getByTestId("entry-save").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("上传");
    const pending = await (await page.request.get(`/api/entries/${metadataEntry.id}`)).json();
    expect(pending.entry.data.assetId).toBeUndefined();
    evidence.pendingGuard = {dialogKeptOpen: true, emptySaveBlocked: true};
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-pending-file-save-blocked.png"), animations: "disabled"});
    await expectNoUploadRightsFields(dialog);
    let releaseUpload: (() => void) | undefined;
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
    await page.route("**/api/assets", async route => {if (route.request().method() === "POST") await uploadGate; await route.continue();});
    try {
      await upload.getByRole("button", {name: "上传文件", exact: true}).click();
      await expect(upload.getByRole("button", {name: "上传中…", exact: true})).toBeVisible();
      await expect(dialog.getByTestId("entry-save")).toBeDisabled();
      await expect(dialog.getByRole("button", {name: "取消", exact: true})).toBeDisabled();
      await expect(dialog.getByRole("button", {name: "关闭弹窗", exact: true})).toBeDisabled();
      evidence.slowUploadGuard = {saveDisabled: true, cancelDisabled: true, closeDisabled: true};
      await page.screenshot({path: path.join(evidenceDirectory, "desktop-upload-save-protected.png"), animations: "disabled"});
    } finally {releaseUpload?.();}
    await expect(upload.getByRole("status").filter({hasText: "original-editor-beam.png 已上传，请保存当前记录以完成关联"})).toBeVisible();
    await expect(dialog.getByTestId("entry-save")).toBeEnabled();
    await page.unroute("**/api/assets");
    await dialog.getByTestId("entry-save").click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    const editorCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: editorTitle, exact: true})});
    evidence.desktopEditorCard = await imageEvidence(editorCard.getByRole("img", {name: editorTitle, exact: true}));

    // A new import must be revealed even when the user was filtering favorites and years.
    await page.getByRole("button", {name: "只看收藏", exact: true}).click();
    await page.getByRole("button", {name: "筛选", exact: true}).click();
    await page.getByRole("combobox", {name: "年份筛选", exact: true}).selectOption("2009");
    await page.getByRole("textbox", {name: "搜索记录", exact: true}).fill("不会匹配新照片的旧关键词");
    const filteredTitle = "筛选状态上传也能看到的新照片";
    await importPhoto(page, filteredTitle, "original-filtered-beam.png");
    const newFilteredCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: filteredTitle, exact: true})});
    evidence.filteredImportCard = await imageEvidence(newFilteredCard.getByRole("img", {name: filteredTitle, exact: true}));
    await noOverflow(page);
    await page.screenshot({path: path.join(evidenceDirectory, "desktop-import-revealed-after-filters.png"), fullPage: true, animations: "disabled"});

    // The separate library action reuses an uploaded image without another file upload.
    await page.getByTestId("entry-create").click();
    dialog = page.getByRole("dialog");
    const reusedTitle = "素材库复用的原创照片";
    await dialog.getByLabel("标题", {exact: true}).fill(reusedTitle);
    await dialog.getByRole("combobox", {name: "选择素材库文件", exact: true}).selectOption({label: "original-blue-beam.png"});
    evidence.reusedPreview = await imageEvidence(dialog.getByRole("img", {name: "已关联照片预览：original-blue-beam.png", exact: true}));
    await dialog.getByTestId("entry-save").click();
    await expect(dialog).toHaveCount(0);
    const reusedCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: reusedTitle, exact: true})});
    evidence.reusedCard = await imageEvidence(reusedCard.getByRole("img", {name: reusedTitle, exact: true}));

    const entries = (await (await page.request.get("/api/entries?kind=photos")).json()).entries as Array<{id: string; title: string; data: {assetId?: string}}>;
    const quickEntry = entries.find(entry => entry.title === quickTitle)!;
    expect(quickEntry.data.assetId).toBeTruthy();
    const anonymous = await playwright.request.newContext({baseURL: origin});
    expect((await anonymous.get(`/api/assets/${quickEntry.data.assetId}`)).status()).toBe(401);
    await anonymous.dispose();

    const mobile = await browser.newContext({baseURL: origin, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: "reduce"});
    try {
      const mobilePage = await mobile.newPage();
      await signIn(mobilePage);
      await mobilePage.goto("/app/photos");
      const mobileCard = mobilePage.getByTestId("entry-card").filter({has: mobilePage.getByRole("button", {name: quickTitle, exact: true})});
      evidence.mobileCard = await imageEvidence(mobileCard.getByRole("img", {name: quickTitle, exact: true}));
      await noOverflow(mobilePage);
      await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-photo-library.png"), fullPage: true, animations: "disabled"});
      await mobileCard.getByRole("button", {name: `在灯箱查看${quickTitle}`, exact: true}).tap();
      const mobileDialog = mobilePage.getByRole("dialog");
      evidence.mobileLightbox = await imageEvidence(mobileDialog.getByRole("img", {name: quickTitle, exact: true}));
      const mobileLightboxLayout = await mobileDialog.locator(".ws-lightbox").evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const frame = element.querySelector(".ws-lightbox-frame")!.getBoundingClientRect();
        const buttons = [...element.querySelectorAll(":scope > button")].map(button => {
          const rect = button.getBoundingClientRect();
          return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
        });
        const image = element.querySelector("img")!.getBoundingClientRect();
        return {container: {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height},
          frame: {x: frame.x, y: frame.y, width: frame.width, height: frame.height},
          imageCenter: image.x + image.width / 2, buttons};
      });
      const {container, frame, buttons, imageCenter} = mobileLightboxLayout;
      expect(frame.width).toBeGreaterThanOrEqual(container.width - 2);
      expect(Math.abs(frame.x - container.x)).toBeLessThanOrEqual(2);
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect(button.y).toBeGreaterThanOrEqual(frame.y + frame.height - 2);
      expect(Math.abs(buttons[0].y - buttons[1].y)).toBeLessThanOrEqual(2);
      const center = container.x + container.width / 2;
      const buttonsCenter = (buttons[0].x + buttons[0].width / 2 + buttons[1].x + buttons[1].width / 2) / 2;
      expect(Math.abs(buttonsCenter - center)).toBeLessThanOrEqual(2);
      expect(Math.abs(imageCenter - center)).toBeLessThanOrEqual(2);
      evidence.mobileLightboxLayout = mobileLightboxLayout;
      await noOverflow(mobilePage);
      await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-photo-lightbox.png"), animations: "disabled"});
      await mobileDialog.getByRole("button", {name: "关闭弹窗", exact: true}).tap();
      await expect(mobileDialog).toHaveCount(0);
      await mobileCard.getByRole("link", {name: "展开记忆", exact: true}).tap();
      evidence.mobileDetail = await imageEvidence(mobilePage.getByRole("img", {name: quickTitle, exact: true}));
      await noOverflow(mobilePage);
      await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-photo-detail.png"), fullPage: true, animations: "disabled"});

      await mobilePage.goto("/app/photos");
      const mobileTitle = "手机仅选文件即可上传的照片";
      await importPhoto(mobilePage, mobileTitle, "original-mobile-file-only.png", "mobile-file-only-photo-dialog.png");
      await mobilePage.reload();
      const mobileUploadedCard = mobilePage.getByTestId("entry-card").filter({has: mobilePage.getByRole("button", {name: mobileTitle, exact: true})});
      evidence.mobileFileOnlyUpload = await imageEvidence(mobileUploadedCard.getByRole("img", {name: mobileTitle, exact: true}));
      await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-file-only-photo-upload.png"), fullPage: true, animations: "disabled"});

      // Uploading into an existing empty card must update that exact record.
      const emptyTitle = "旧照片空记录 · 直接补图";
      const emptyResponse = await page.request.post("/api/entries", {headers: {Origin: origin}, data: {kind: "photos", title: emptyTitle, data: {year: 2009}}});
      expect(emptyResponse.ok(), await emptyResponse.text()).toBe(true);
      const emptyEntry = (await emptyResponse.json()).entry as {id: string};
      await page.goto("/app/photos");
      await page.getByRole("button", {name: `为${emptyTitle}添加照片`, exact: true}).click();
      const repairDialog = page.getByRole("dialog");
      await expectNoUploadRightsFields(repairDialog);
      await repairDialog.getByLabel("选择照片文件", {exact: true}).setInputFiles({name: "original-repair-file-only.png", mimeType: "image/png", buffer: originalPhoto()});
      await repairDialog.getByRole("button", {name: "上传并保存", exact: true}).click();
      await expect(repairDialog).toHaveCount(0);
      const repaired = (await (await page.request.get(`/api/entries/${emptyEntry.id}`)).json()).entry;
      expect(repaired.data.assetId).toBeTruthy(); expect(repaired.data.year).toBe(2009);
      const repairedCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: emptyTitle, exact: true})});
      evidence.repairedCard = await imageEvidence(repairedCard.getByRole("img", {name: emptyTitle, exact: true}));

      const audioTitle = "仅选文件上传的原创测试音调";
      const audioEntry = await importPlayable(page, "music", audioTitle, {name: "original-file-only.wav", mimeType: "audio/wav", buffer: originalWav()});
      const audio = page.getByTestId("global-audio");
      await audio.evaluate(element => {(element as HTMLAudioElement).muted = true;});
      const musicCard = page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: audioTitle, exact: true})});
      await musicCard.getByRole("button", {name: `播放${audioTitle}`, exact: true}).click();
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.15);
      expect(await audio.evaluate(element => (element as HTMLAudioElement).error)).toBeNull();
      evidence.audioPlayback = await audio.evaluate(element => ({currentTime: (element as HTMLAudioElement).currentTime, duration: (element as HTMLAudioElement).duration, currentSrc: (element as HTMLAudioElement).currentSrc}));
      expect(await audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${audioEntry.data.assetId}`);
      await audio.evaluate(element => (element as HTMLAudioElement).pause());
      await page.screenshot({path: path.join(evidenceDirectory, "desktop-file-only-audio-playback.png"), fullPage: true, animations: "disabled"});

      const videoTitle = "仅选文件上传的原创测试短片";
      const videoBytes = await originalVideo(page);
      const videoEntry = await importPlayable(page, "videos", videoTitle, {name: "original-file-only.webm", mimeType: "video/webm", buffer: videoBytes});
      await page.getByTestId("entry-card").filter({has: page.getByRole("button", {name: videoTitle, exact: true})}).getByRole("link", {name: "展开记忆", exact: true}).click();
      const video = page.locator("video");
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).duration)).toBeGreaterThan(.6);
      await video.evaluate(async element => {const media = element as HTMLVideoElement; media.muted = true; await media.play();});
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(.15);
      expect(await video.evaluate(element => (element as HTMLVideoElement).error)).toBeNull();
      evidence.videoPlayback = await video.evaluate(element => ({currentTime: (element as HTMLVideoElement).currentTime, duration: (element as HTMLVideoElement).duration, currentSrc: (element as HTMLVideoElement).currentSrc}));
      expect(await video.evaluate(element => (element as HTMLVideoElement).currentSrc)).toContain(`/api/assets/${videoEntry.data.assetId}`);
      await video.evaluate(element => (element as HTMLVideoElement).pause());
      await page.screenshot({path: path.join(evidenceDirectory, "desktop-file-only-video-playback.png"), fullPage: true, animations: "disabled"});

      await page.goto("/app/settings");
      await page.getByRole("button", {name: "换一张自己的照片", exact: true}).click();
      const homeUpload = page.getByRole("region", {name: "上传首页背景", exact: true});
      await expectNoUploadRightsFields(page.locator("#home-visual"));
      await homeUpload.getByTestId("upload-file").setInputFiles({name: "original-home-file-only.png", mimeType: "image/png", buffer: originalPhoto()});
      await imageEvidence(homeUpload.getByRole("img", {name: "待上传照片预览：original-home-file-only.png", exact: true}));
      await homeUpload.getByTestId("upload-submit").click();
      await expect(homeUpload.getByRole("status").filter({hasText: "original-home-file-only.png 已上传，请保存网站设置以应用图片"})).toBeVisible();
      await page.getByRole("button", {name: "保存设置", exact: true}).click();
      await expect(page.getByRole("status").filter({hasText: "网站设置已保存。"})).toBeVisible();
      const savedSettings = (await (await page.request.get("/api/settings")).json()).settings;
      expect(savedSettings.heroAssetId).toBeTruthy();
      await page.reload();
      evidence.homePreview = await imageEvidence(page.getByRole("img", {name: "桌面背景预览：original-home-file-only.png", exact: true}));
      await page.goto("/app/dashboard");
      await expect(page.locator(".fan-portrait")).toHaveAttribute("data-fan-state", "ready");
      const desktopHero = page.locator(".fan-leaf img").first();
      await expect.poll(() => desktopHero.evaluate(element => (element as HTMLImageElement).currentSrc)).toContain(`/api/assets/${savedSettings.heroAssetId}`);
      evidence.desktopHomeArtwork = await imageEvidence(desktopHero);
      await page.screenshot({path: path.join(evidenceDirectory, "desktop-file-only-home-artwork.png"), fullPage: true, animations: "disabled"});
      await mobilePage.goto("/app/dashboard");
      await expect(mobilePage.locator(".fan-portrait")).toHaveAttribute("data-fan-state", "ready");
      const mobileHero = mobilePage.locator(".fan-leaf img").first();
      await expect.poll(() => mobileHero.evaluate(element => (element as HTMLImageElement).currentSrc)).toContain(`/api/assets/${savedSettings.heroAssetId}`);
      evidence.mobileHomeArtwork = await imageEvidence(mobileHero);
      await noOverflow(mobilePage);
      await mobilePage.screenshot({path: path.join(evidenceDirectory, "mobile-file-only-home-artwork.png"), fullPage: true, animations: "disabled"});
      const assets = (await (await page.request.get("/api/assets")).json()).assets as Array<{id: string; mediaType: string; rightsHolder?: string; licenseNotes?: string; allowedUseScope: string[]}>;
      for (const asset of assets) {
        expect(asset.rightsHolder).toBeUndefined(); expect(asset.licenseNotes).toBeUndefined();
        expect(asset.allowedUseScope).toContain("private_storage");
        if (asset.mediaType === "audio" || asset.mediaType === "video") expect(asset.allowedUseScope).toContain("private_playback");
      }
      const anonymousMedia = await playwright.request.newContext({baseURL: origin});
      try {for (const asset of assets) expect((await anonymousMedia.get(`/api/assets/${asset.id}`)).status()).toBe(401);}
      finally {await anonymousMedia.dispose();}
      evidence.privateDefaults = {checkedAssets: assets.length, omittedRightsHolder: true, omittedLicenseNotes: true, privateStorage: true, anonymousMediaStatus: 401};
    } finally {await mobile.close();}
    expect(errors).toEqual([]);
  } finally {
    await writeFile(path.join(evidenceDirectory, "visibility-check.json"), JSON.stringify({origin, errors, ...evidence}, null, 2));
    await desktop.close(); await setup.dispose();
  }
});
