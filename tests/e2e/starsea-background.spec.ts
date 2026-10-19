import {mkdir, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {deflateSync, inflateSync} from "node:zlib";
import {devices, expect, test, type APIRequestContext, type Browser, type Page} from "@playwright/test";

const origin = "http://127.0.0.1:3006";
const evidenceDirectory = path.resolve("verification", "starsea-v2");
const desktopViewport = {width: 1440, height: 1000};
const mobileViewport = {width: 390, height: 844};
const fixtureImages = [0, 1, 2].map(makeStarseaFixturePng);
let owner: APIRequestContext;
let email: string;
let password: string;

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer) {
  const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

/** Original abstract blue star-sea pixels used only by Playwright route mocks. */
function makeStarseaFixturePng(phase: number) {
  const width = 480, height = 270;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const yn = y / (height - 1), row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const xn = x / (width - 1);
      const horizon = Math.exp(-((yn - (0.67 + phase * 0.012)) ** 2) / 0.035);
      const cloudA = Math.exp(-(((xn - (0.2 + phase * 0.26)) ** 2) / 0.055 + ((yn - 0.62) ** 2) / 0.12));
      const cloudB = Math.exp(-(((xn - (0.8 - phase * 0.2)) ** 2) / 0.07 + ((yn - 0.79) ** 2) / 0.05));
      const beamCenter = 0.29 + phase * 0.19 + (0.46 - yn) * 0.16;
      const beam = Math.exp(-((xn - beamCenter) ** 2) / 0.0025) * Math.max(0, 0.78 - yn);
      const glow = Math.min(1, horizon * 0.24 + cloudA * 0.56 + cloudB * 0.48 + beam * 0.27);
      const hash = (x * 73856093 ^ y * 19349663 ^ phase * 83492791) >>> 0;
      const star = hash % 17011 === 0;
      const pixel = row + 1 + x * 3;
      scanlines[pixel] = Math.min(255, Math.round(3 + glow * 42 + (star ? 122 : 0)));
      scanlines[pixel + 1] = Math.min(255, Math.round(11 + glow * 87 + (star ? 164 : 0)));
      scanlines[pixel + 2] = Math.min(255, Math.round(31 + glow * 151 + (star ? 205 : 0)));
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, {level: 6})),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

type PngStats = {width: number; height: number; samples: number; meanLuminance: number; brightShare: number; blueShare: number};

function paeth(left: number, above: number, upperLeft: number) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left), aboveDistance = Math.abs(prediction - above), upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

/** Sample only the open side margins of a screenshot; this records brightness without a brittle image snapshot. */
function measureBackgroundMargins(png: Buffer): PngStats {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error("Screenshot was not a PNG");
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const imageData: Buffer[] = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset), name = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (name === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
    } else if (name === "IDAT") imageData.push(data);
    offset += length + 12;
    if (name === "IEND") break;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!width || !height || bitDepth !== 8 || !channels) throw new Error(`Unsupported screenshot PNG (${width}x${height}, depth ${bitDepth}, type ${colorType})`);
  const rowBytes = width * channels, raw = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const inputRow = y * (rowBytes + 1), outputRow = y * rowBytes, filter = raw[inputRow];
    for (let index = 0; index < rowBytes; index++) {
      const source = raw[inputRow + 1 + index], left = index >= channels ? pixels[outputRow + index - channels] : 0;
      const above = y > 0 ? pixels[outputRow - rowBytes + index] : 0;
      const upperLeft = y > 0 && index >= channels ? pixels[outputRow - rowBytes + index - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : NaN;
      if (!Number.isFinite(predictor)) throw new Error(`Unsupported screenshot PNG filter ${filter}`);
      pixels[outputRow + index] = (source + predictor) & 255;
    }
  }

  let samples = 0, luminance = 0, bright = 0, blue = 0;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 280));
  const xStart = Math.floor(width * 0.015), xEnd = Math.floor(width * 0.04);
  const yStart = Math.floor(height * 0.11), yEnd = Math.floor(height * 0.96);
  for (let y = yStart; y < yEnd; y += step) for (const [start, end] of [[xStart, xEnd], [width - xEnd, width - xStart]]) {
    for (let x = start; x < end; x += step) {
      const offset = y * rowBytes + x * channels;
      const red = pixels[offset], green = pixels[offset + 1], blueValue = pixels[offset + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blueValue;
      samples++; luminance += luma;
      if (luma >= 42) bright++;
      if (blueValue > red * 1.18 && blueValue > green * 0.9) blue++;
    }
  }
  return {
    width, height, samples,
    meanLuminance: Number((luminance / Math.max(1, samples)).toFixed(2)),
    brightShare: Number((bright / Math.max(1, samples)).toFixed(4)),
    blueShare: Number((blue / Math.max(1, samples)).toFixed(4)),
  };
}

function assertIsolatedDataDirectory() {
  const value = process.env.STARS_STARSEA_DATA_DIR;
  const relative = value ? path.relative(path.resolve(".test-data"), path.resolve(value)) : "";
  if (!relative.startsWith("starsea-") || path.isAbsolute(relative) || relative.startsWith("..")) {
    throw new Error("Run only with playwright.starsea.config.ts and its fresh isolated .test-data directory");
  }
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(email);
  await page.getByLabel("密码", {exact: true}).fill(password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.locator(".starsea-backdrop")).toBeVisible();
  await expect(page.locator("#main-content h1").first()).toBeVisible();
}

async function newPage(browser: Browser, mobile = false, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({
    ...(mobile ? devices["iPhone 13"] : devices["Desktop Chrome"]),
    viewport: mobile ? mobileViewport : desktopViewport,
    reducedMotion,
    baseURL: origin,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  return {context, page, errors};
}

async function mockFrameManifest(page: Page, frameCount: number | "empty" | "broken") {
  const requests: string[] = [];
  await page.route(url => new URL(url).origin === origin && new URL(url).pathname === "/api/starsea-frames", async route => {
    if (frameCount === "empty") {
      await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({version: 1, frames: []})});
      return;
    }
    const names = frameCount === "broken" ? ["unreadable.png"] : Array.from({length: frameCount}, (_, index) => `test-${index}.png`);
    const frames = names.map((file, index) => ({src: `/api/starsea-frames/${file}`, label: `测试星海帧 ${index + 1}`}));
    await route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({version: 1, frames})});
  });
  await page.route(url => new URL(url).origin === origin && new URL(url).pathname.startsWith("/api/starsea-frames/"), async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (frameCount === "broken") {
      await route.fulfill({status: 200, contentType: "image/png", body: Buffer.from("invalid image data")});
      return;
    }
    const file = path.posix.basename(url.pathname);
    const index = Number(file.match(/^test-(\d+)\.png$/)?.[1]);
    if (!Number.isInteger(index) || !fixtureImages[index]) {
      await route.fulfill({status: 404, contentType: "application/json", body: JSON.stringify({error: "test fixture not found"})});
      return;
    }
    await route.fulfill({status: 200, contentType: "image/png", headers: {"Cache-Control": "private, no-store"}, body: fixtureImages[index]});
  });
  return requests;
}

async function noHorizontalOverflow(page: Page, expectedWidth: number) {
  const sizes = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth}));
  expect(sizes.viewport).toBe(expectedWidth);
  expect(sizes.document, `document overflow: ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(expectedWidth + 1);
  expect(sizes.body, `body overflow: ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(expectedWidth + 1);
}

async function settlePageTransition(page: Page) {
  await expect(page.getByRole("heading", {name: "音乐馆", exact: true, level: 1})).toBeVisible();
  await expect(page.locator(".ws-route-loading")).toBeHidden();
  await expect(page.locator(".ws-empty")).toBeVisible();
  // View-transition arrival takes 320ms plus an 80ms delay; start this after content is ready.
  await page.waitForTimeout(500);
}

async function canvasFrame(page: Page) {
  return page.locator("canvas.starsea-audience").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL("image/png"));
}

async function saveVisual(page: Page, name: string, evidenceSource = "image-fixtures") {
  await mkdir(evidenceDirectory, {recursive: true});
  const screenshotPath = path.join(evidenceDirectory, `${name}.png`);
  const screenshot = await page.screenshot({path: screenshotPath, fullPage: false});
  const metrics = {name, evidenceSource, ...(await page.locator(".starsea-backdrop").evaluate(element => ({
    motionState: element.getAttribute("data-motion-state"),
    meteorState: element.getAttribute("data-meteor-state"),
    frameState: element.getAttribute("data-frame-state"),
    frameCount: element.getAttribute("data-frame-count"),
    frameIndex: element.getAttribute("data-frame-index"),
  }))), ...measureBackgroundMargins(screenshot)};
  const json = JSON.stringify(metrics, null, 2);
  await writeFile(path.join(evidenceDirectory, `${name}.json`), json, "utf8");
  await test.info().attach(`${name}-background-luminance.json`, {body: json, contentType: "application/json"});
  expect(metrics.samples).toBeGreaterThan(100);
  return metrics;
}

async function assertCrossfadeInProgress(page: Page) {
  const layers = page.locator(".starsea-frame-layer");
  await expect(layers).toHaveCount(2);
  await expect.poll(async () => layers.evaluateAll(elements => {
    const opacities = elements.map(element => Number(getComputedStyle(element).opacity));
    // Keep the outgoing frame opaque beneath the incoming frame to avoid a dark dip.
    return opacities.length === 2 && Math.max(...opacities) > 0.96 && Math.min(...opacities) > 0.04 && Math.min(...opacities) < 0.96;
  }), {timeout: 15_000, intervals: [80, 120, 180]}).toBe(true);
}

async function assertInitialFrameSettled(page: Page) {
  const layers = page.locator(".starsea-frame-layer");
  await expect.poll(() => layers.evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity))), {timeout: 5_000}).toEqual([1, 0]);
}

test.describe.serial("authenticated star-sea cinematic background", () => {
  test.beforeAll(async ({playwright}) => {
    assertIsolatedDataDirectory();
    email = process.env.STARS_STARSEA_OWNER_EMAIL ?? "";
    password = process.env.STARS_STARSEA_OWNER_PASSWORD ?? "";
    if (!email || !password) throw new Error("The isolated star-sea test owner was not configured");

    owner = await playwright.request.newContext({baseURL: origin});
    const status = await (await owner.get("/api/auth/status")).json();
    expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
    const setup = await owner.post("/api/auth/setup", {headers: {Origin: origin}, data: {email, password}});
    expect(setup.ok(), await setup.text()).toBe(true);
  });

  test.afterAll(async () => {await owner?.dispose();});

  test("private frame GET and HEAD endpoints, including current empty availability", async ({playwright}) => {
    const anonymous = await playwright.request.newContext({baseURL: origin});
    try {
      for (const method of ["get", "head"] as const) {
        expect((await anonymous[method]("/api/starsea-frames")).status()).toBe(401);
        expect((await anonymous[method]("/api/starsea-frames/not-available.png")).status()).toBe(401);
      }
    } finally {await anonymous.dispose();}

    const manifestResponse = await owner.get("/api/starsea-frames");
    expect(manifestResponse.status()).toBe(200);
    expect(manifestResponse.headers()["cache-control"]).toContain("private");
    const manifest = await manifestResponse.json() as {version: number; frames: {src: string; label: string}[]};
    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.frames)).toBe(true);
    const manifestHead = await owner.head("/api/starsea-frames");
    expect(manifestHead.status()).toBe(200);
    expect((await manifestHead.body()).byteLength).toBe(0);

    let frameAvailability: "available" | "empty" = "empty";
    if (manifest.frames.length) {
      const framePath = new URL(manifest.frames[0].src, origin);
      expect(framePath.origin).toBe(origin);
      expect(framePath.pathname).toMatch(/^\/api\/starsea-frames\//);
      const get = await owner.get(framePath.pathname);
      expect(get.status()).toBe(200);
      expect(get.headers()["content-type"]).toMatch(/^image\/(?:png|webp|jpeg)/);
      expect((await get.body()).byteLength).toBeGreaterThan(0);
      const head = await owner.head(framePath.pathname);
      expect(head.status()).toBe(200);
      expect((await head.body()).byteLength).toBe(0);
      frameAvailability = "available";
    } else {
      const missing = `/api/starsea-frames/not-available-${randomUUID()}.png`;
      expect((await owner.get(missing)).status()).toBe(404);
      expect((await owner.head(missing)).status()).toBe(404);
    }
    await mkdir(evidenceDirectory, {recursive: true});
    await writeFile(path.join(evidenceDirectory, "private-api.json"), JSON.stringify({
      anonymous: {manifestGet: 401, manifestHead: 401, frameGet: 401, frameHead: 401},
      authenticated: {manifestGet: manifestResponse.status(), manifestHead: manifestHead.status(), frameCount: manifest.frames.length, frameAvailability},
    }, null, 2), "utf8");
  });

  test("desktop home and music show decoded original test frames, motion and crossfade", async ({browser}) => {
    test.setTimeout(60_000);
    const {context, page, errors} = await newPage(browser);
    try {
      const imageRequests = await mockFrameManifest(page, 3);
      await signIn(page);
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-motion-state", "running");
      await expect(backdrop).toHaveAttribute("data-frame-state", "ready");
      await expect(backdrop).toHaveAttribute("data-frame-count", "3");
      await expect.poll(() => imageRequests.length).toBe(3);
      await assertInitialFrameSettled(page);
      await noHorizontalOverflow(page, desktopViewport.width);

      const canvasBefore = await canvasFrame(page);
      await page.waitForTimeout(700);
      expect(await canvasFrame(page)).not.toBe(canvasBefore);
      const homeMetric = await saveVisual(page, "desktop-home-image-fixtures");
      expect(homeMetric.blueShare).toBeGreaterThan(0);

      const musicLink = page.getByRole("link", {name: "走进音乐馆", exact: true});
      const isClickableThrough = await musicLink.evaluate(element => {
        const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return Boolean(hit && (hit === element || element.contains(hit)) && getComputedStyle(document.querySelector(".starsea-backdrop")!).pointerEvents === "none");
      });
      expect(isClickableThrough).toBe(true);
      await musicLink.click();
      await expect(page).toHaveURL(/\/app\/music\/?$/);
      await expect(page.getByRole("heading", {name: "音乐馆", exact: true, level: 1})).toBeVisible();
      await settlePageTransition(page);
      await noHorizontalOverflow(page, desktopViewport.width);
      await expect(backdrop).toHaveAttribute("data-frame-state", "ready");
      await assertCrossfadeInProgress(page);
      await saveVisual(page, "desktop-music-image-fixtures-crossfade");
      expect(imageRequests.every(request => /^\/api\/starsea-frames\/test-\d+\.png$/.test(request))).toBe(true);
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("mobile home and music keep the background in view without horizontal overflow", async ({browser}) => {
    const {context, page, errors} = await newPage(browser, true);
    try {
      await mockFrameManifest(page, 3);
      await signIn(page);
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-frame-state", "ready");
      await expect(backdrop).toHaveAttribute("data-frame-count", "3");
      await noHorizontalOverflow(page, mobileViewport.width);
      const homeMetric = await saveVisual(page, "mobile-home-image-fixtures");
      expect(homeMetric.blueShare).toBeGreaterThan(0);

      await page.getByRole("link", {name: "走进音乐馆", exact: true}).click();
      await expect(page).toHaveURL(/\/app\/music\/?$/);
      await expect(page.getByRole("heading", {name: "音乐馆", exact: true, level: 1})).toBeVisible();
      await settlePageTransition(page);
      await noHorizontalOverflow(page, mobileViewport.width);
      await expect(backdrop).toHaveAttribute("data-frame-state", "ready");
      await saveVisual(page, "mobile-music-image-fixtures");
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("empty and unreadable manifests preserve the animated canvas fallback", async ({browser}) => {
    for (const mode of ["empty", "broken"] as const) {
      const {context, page, errors} = await newPage(browser);
      try {
        await mockFrameManifest(page, mode);
        await signIn(page);
        const backdrop = page.locator(".starsea-backdrop");
        await expect(backdrop).toHaveAttribute("data-motion-state", "running");
        await expect(backdrop).toHaveAttribute("data-frame-state", mode === "empty" ? "empty" : "error");
        const canvasBefore = await canvasFrame(page);
        await page.waitForTimeout(700);
        expect(await canvasFrame(page)).not.toBe(canvasBefore);
        await noHorizontalOverflow(page, desktopViewport.width);
        await saveVisual(page, `desktop-${mode}-canvas-fallback`, mode === "empty" ? "mocked-empty-frame-manifest" : "mocked-unreadable-frame");
        if (mode === "empty") {
          await page.getByRole("link", {name: "走进音乐馆", exact: true}).click();
          await expect(page).toHaveURL(/\/app\/music\/?$/);
          await settlePageTransition(page);
          await expect(backdrop).toHaveAttribute("data-frame-state", "empty");
          await noHorizontalOverflow(page, desktopViewport.width);
          await saveVisual(page, "desktop-music-canvas-only-empty-manifest", "mocked-empty-frame-manifest");
        }
        expect(errors).toEqual([]);
      } finally {await context.close();}
    }

    const {context, page, errors} = await newPage(browser, true);
    try {
      await mockFrameManifest(page, "empty");
      await signIn(page);
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-motion-state", "running");
      await expect(backdrop).toHaveAttribute("data-frame-state", "empty");
      await noHorizontalOverflow(page, mobileViewport.width);
      await saveVisual(page, "mobile-home-canvas-only-empty-manifest", "mocked-empty-frame-manifest");
      await page.getByRole("link", {name: "走进音乐馆", exact: true}).click();
      await expect(page).toHaveURL(/\/app\/music\/?$/);
      await settlePageTransition(page);
      await expect(backdrop).toHaveAttribute("data-frame-state", "empty");
      await noHorizontalOverflow(page, mobileViewport.width);
      await saveVisual(page, "mobile-music-canvas-only-empty-manifest", "mocked-empty-frame-manifest");
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("reduced motion keeps one static frame and pauses the canvas clock", async ({browser}) => {
    const {context, page, errors} = await newPage(browser, false, "reduce");
    try {
      const imageRequests = await mockFrameManifest(page, 3);
      await signIn(page);
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-motion-state", "paused");
      await expect(backdrop).toHaveAttribute("data-frame-state", "paused");
      await expect.poll(() => imageRequests.length).toBe(1);
      await expect(backdrop).toHaveAttribute("data-frame-count", "1");
      const staticLayerOpacity = await page.locator('.starsea-frame-layer[data-frame-layer="0"]').evaluate(element => getComputedStyle(element).opacity);
      expect(Number(staticLayerOpacity)).toBe(1);
      const before = await canvasFrame(page);
      await page.waitForTimeout(700);
      expect(await canvasFrame(page)).toBe(before);
      const cssMotion = await page.locator(".starsea-blue-horizon").evaluate(element => getComputedStyle(element).animationDuration);
      expect(cssMotion).toBe("0s");
      await noHorizontalOverflow(page, desktopViewport.width);
      const metrics = await saveVisual(page, "desktop-reduced-motion");
      expect(metrics.blueShare).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("saved animation preference pauses the image and canvas clocks", async ({browser}) => {
    const {context, page, errors} = await newPage(browser);
    try {
      const imageRequests = await mockFrameManifest(page, 3);
      await signIn(page);
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-frame-state", "ready");
      await expect.poll(() => imageRequests.length).toBe(3);
      await page.goto("/app/settings");
      const animation = page.getByLabel("开启动效", {exact: true});
      await expect(animation).toBeChecked();
      await page.locator("label.secondary-switch").click();
      await expect(animation).not.toBeChecked();
      await page.getByRole("button", {name: "保存设置", exact: true}).click();
      await expect(page.getByRole("status").filter({hasText: "网站设置已保存。"})).toBeVisible();
      await expect(backdrop).toHaveAttribute("data-motion-state", "paused");
      await expect(backdrop).toHaveAttribute("data-frame-state", "paused");
      const pausedCanvas = await canvasFrame(page);
      const pausedRequests = imageRequests.length;
      await page.waitForTimeout(700);
      expect(await canvasFrame(page)).toBe(pausedCanvas);
      expect(imageRequests).toHaveLength(pausedRequests);
      await noHorizontalOverflow(page, desktopViewport.width);
      await saveVisual(page, "desktop-saved-motion-off");
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
});
