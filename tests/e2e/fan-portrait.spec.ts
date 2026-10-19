import {mkdir} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page} from "@playwright/test";

const origin = "http://127.0.0.1:3003";
const evidenceDirectory = path.resolve("verification");
let owner: APIRequestContext;
let email: string;
let password: string;

type FanPhaseTrace = {
  openingFrames: {rotation: number; scale: number; opacity: number}[][];
  closingFrames: {rotation: number; scale: number; opacity: number}[][];
};
type FanTrace = {states: string[]; phase: string; phases: Record<string, FanPhaseTrace>};
type FanWindow = Window & {__fanPortraitTrace?: FanTrace};

async function installTrace(context: BrowserContext) {
  await context.addInitScript(() => {
    const trace: FanTrace = {
      states: [],
      phase: "initial",
      phases: {
        initial: {openingFrames: [], closingFrames: []},
        replay: {openingFrames: [], closingFrames: []},
        fold: {openingFrames: [], closingFrames: []},
        keyboardOpen: {openingFrames: [], closingFrames: []},
      },
    };
    (window as FanWindow).__fanPortraitTrace = trace;
    let observedRoot: Element | null = null;

    const attach = () => {
      const root = document.querySelector(".fan-portrait");
      if (!root || root === observedRoot) return;
      observedRoot = root;
      const recordState = () => {
        const state = root.getAttribute("data-fan-state") ?? "missing";
        if (trace.states.at(-1) !== state) trace.states.push(state);
      };
      const stateObserver = new MutationObserver(recordState);
      stateObserver.observe(root, {attributes: true, attributeFilter: ["data-fan-state"]});

      const sample = () => {
        if (!root.isConnected) return;
        recordState();
        const current = trace.phases[trace.phase] ??= {openingFrames: [], closingFrames: []};
        const state = root.getAttribute("data-fan-state");
        const leaves = Array.from(root.querySelectorAll<HTMLElement>(".fan-leaf"));
        if ((state === "opening" || state === "closing") && leaves.length === 15) {
          const frame = leaves.map((leaf) => {
            const transform = getComputedStyle(leaf).transform;
            const matrix = transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
            return {
              rotation: Math.atan2(matrix.m21, matrix.m11) * 180 / Math.PI,
              scale: Math.hypot(matrix.m11, matrix.m21),
              opacity: Number(getComputedStyle(leaf).opacity),
            };
          });
          if (state === "opening") current.openingFrames.push(frame);
          if (state === "closing") current.closingFrames.push(frame);
        }
        requestAnimationFrame(sample);
      };

      recordState();
      requestAnimationFrame(sample);
    };

    const observer = new MutationObserver(attach);
    observer.observe(document, {childList: true, subtree: true});
    attach();
  });
}

async function signIn(page: Page) {
  let loginRequestSeen = false;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/login") loginRequestSeen = true;
  });
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(email);
  await page.getByLabel("密码", {exact: true}).fill(password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.getByRole("heading", {name: /张杰/, level: 1})).toBeVisible();
  expect(loginRequestSeen).toBe(true);
  expect((await (await page.request.get("/api/auth/status")).json()).authenticated).toBe(true);
}

async function noOverflow(page: Page, expectedWidth: number) {
  expect(await page.evaluate(() => innerWidth)).toBe(expectedWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

function expectLeafMotion(frames: FanPhaseTrace["openingFrames"], centerOpacityMoves = false) {
  expect(frames.length).toBeGreaterThan(5);
  expect(frames.every((frame) => frame.length === 15)).toBe(true);
  for (let index = 0; index < 15; index++) {
    const rotations = frames.map((frame) => frame[index].rotation);
    if (index === 7) {
      expect(Math.max(...rotations.map(Math.abs))).toBeLessThan(2);
      if (centerOpacityMoves) {
        const opacity = frames.map((frame) => frame[index].opacity);
        expect(Math.min(...opacity)).toBeLessThan(0.95);
        expect(Math.max(...opacity)).toBeGreaterThan(0.99);
        expect(Math.max(...opacity) - Math.min(...opacity)).toBeGreaterThan(0.05);
      }
    } else {
      expect(Math.max(...rotations.map(Math.abs))).toBeGreaterThan(5);
      expect(Math.max(...rotations) - Math.min(...rotations)).toBeGreaterThan(4);
    }
  }
}

async function expectFanShape(page: Page, state: "ready" | "closed") {
  const portrait = page.locator(".fan-portrait");
  await expect(portrait).toHaveAttribute("data-fan-state", state);
  await expect(page.locator(".fan-leaf")).toHaveCount(15);
  await expect(page.locator(".fan-rib")).toHaveCount(15);
  await expect.poll(() => page.locator(".fan-leaf img").evaluateAll((images) =>
    images.length === 15 && images.every((image) => (image as HTMLImageElement).naturalWidth > 300),
  )).toBe(true);
  await expect(page.locator(".fan-hinge")).toBeVisible();
  await expect.poll(() => page.locator(".fan-hinge").evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.99);

  const shape = await page.evaluate(() => {
    const artwork = document.querySelector<HTMLElement>(".fan-artwork")!;
    const leaves = Array.from(document.querySelectorAll<HTMLElement>(".fan-leaf"));
    const ribs = Array.from(document.querySelectorAll<HTMLElement>(".fan-rib"));
    const originFor = (element: HTMLElement) => {
      const [xText, yText] = getComputedStyle(element).transformOrigin.split(" ");
      const resolve = (value: string, size: number) => value.endsWith("%") ? Number.parseFloat(value) * size / 100 : Number.parseFloat(value);
      return {x: element.offsetLeft + resolve(xText, element.offsetWidth), y: element.offsetTop + resolve(yText, element.offsetHeight)};
    };
    const polygons = leaves.map((leaf) => {
      const clip = getComputedStyle(leaf).clipPath;
      const points = Array.from(clip.matchAll(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/g), (match) => [Number(match[1]), Number(match[2])]);
      const radii = points.map(([x, y]) => Math.hypot(
        x * leaf.offsetWidth / 100 - leaf.offsetWidth / 2,
        y * leaf.offsetHeight / 100 - leaf.offsetHeight * 595 / 650,
      ));
      const transform = getComputedStyle(leaf).transform;
      const matrix = transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
      return {
        clip,
        points: points.length,
        radiusRatio: Math.max(...radii) / Math.min(...radii),
        rotation: Math.atan2(matrix.m21, matrix.m11) * 180 / Math.PI,
        opacity: Number(getComputedStyle(leaf).opacity),
        imageWidth: leaf.querySelector("img")?.naturalWidth ?? 0,
        currentSrc: leaf.querySelector("img")?.currentSrc ?? "",
      };
    });
    const origins = [...leaves, ...ribs].map(originFor);
    const hinge = document.querySelector<HTMLElement>(".fan-hinge")!.getBoundingClientRect();
    const artworkBounds = artwork.getBoundingClientRect();
    const original = document.querySelector<HTMLElement>(".fan-original")!;
    return {
      polygons,
      origins,
      hingeError: {
        x: Math.abs(hinge.left + hinge.width / 2 - (artworkBounds.left + artworkBounds.width / 2)),
        y: Math.abs(hinge.top + hinge.height / 2 - (artworkBounds.top + artworkBounds.height * 595 / 650)),
      },
      expectedOrigin: {x: artwork.clientWidth / 2, y: artwork.clientHeight * 595 / 650},
      originalOpacity: Number(getComputedStyle(original).opacity),
      artworkRatio: artwork.clientWidth / artwork.clientHeight,
    };
  });

  expect(shape.polygons).toHaveLength(15);
  for (const [index, polygon] of shape.polygons.entries()) {
    expect(polygon.clip.startsWith("polygon(")).toBe(true);
    expect(polygon.points).toBeGreaterThanOrEqual(16);
    expect(polygon.radiusRatio).toBeGreaterThan(4.5);
    expect(polygon.radiusRatio).toBeLessThan(7);
    expect(polygon.imageWidth).toBeGreaterThan(300);
    expect(polygon.currentSrc).toContain("/api/artist-portrait");
    expect(polygon.opacity).toBeGreaterThan(0.99);
    if (state === "ready") expect(Math.abs(polygon.rotation)).toBeLessThan(0.5);
    else if (index !== 7) expect(Math.abs(polygon.rotation)).toBeGreaterThan(5);
  }
  expect(shape.originalOpacity).toBeLessThan(0.01);
  expect(shape.artworkRatio).toBeCloseTo(1000 / 650, 2);
  expect(shape.hingeError.x).toBeLessThan(2);
  expect(shape.hingeError.y).toBeLessThan(2);
  for (const origin of shape.origins) {
    expect(Math.abs(origin.x - shape.expectedOrigin.x)).toBeLessThan(1);
    expect(Math.abs(origin.y - shape.expectedOrigin.y)).toBeLessThan(1);
  }
}

async function verifyImageLoaded(page: Page) {
  const image = page.locator(".fan-original img");
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(300);
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true);
  expect(await image.evaluate((element) => (element as HTMLImageElement).currentSrc)).toContain("/api/artist-portrait");
}

async function newContext(browser: Browser, viewport: {width: number; height: number}, reducedMotion: "reduce" | "no-preference" = "no-preference", mobile = false) {
  const context = await browser.newContext({
    ...(mobile ? devices["iPhone 13"] : devices["Desktop Chrome"]),
    viewport,
    reducedMotion,
    baseURL: origin,
  });
  await installTrace(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return {context, page, errors};
}

test.describe.serial("authenticated fan portrait animation", () => {
  test.beforeAll(async ({playwright}) => {
    const dataDirectory = process.env.STARS_FAN_DATA_DIR;
    const relativeDirectory = dataDirectory ? path.relative(path.resolve(".test-data"), path.resolve(dataDirectory)) : "";
    if (!relativeDirectory.startsWith("fan-portrait-") || path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) {
      throw new Error("The fan portrait browser test requires its isolated .test-data directory");
    }
    email = process.env.STARS_FAN_OWNER_EMAIL ?? "";
    password = process.env.STARS_FAN_OWNER_PASSWORD ?? "";
    if (!email || !password) throw new Error("The isolated fan portrait test owner was not configured");

    owner = await playwright.request.newContext({baseURL: origin});
    const status = await (await owner.get("/api/auth/status")).json();
    expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
    const setup = await owner.post("/api/auth/setup", {headers: {Origin: origin}, data: {email, password}});
    expect(setup.ok(), await setup.text()).toBe(true);
  });

  test.afterAll(async () => {await owner?.dispose();});

  test("opens and folds a persistent curved fan on desktop and mobile, supports keyboard and reduced motion", async ({browser}) => {
    test.setTimeout(120_000);
    await mkdir(evidenceDirectory, {recursive: true});

    const desktop = await newContext(browser, {width: 1440, height: 1000});
    try {
      await signIn(desktop.page);
      await noOverflow(desktop.page, 1440);
      await verifyImageLoaded(desktop.page);
      const portrait = desktop.page.locator(".fan-portrait");
      await expect(portrait).toHaveAttribute("data-fan-state", "ready", {timeout: 15_000});
      await expectFanShape(desktop.page, "ready");
      await desktop.page.screenshot({path: path.join(evidenceDirectory, "fan-portrait-desktop.png"), fullPage: true, animations: "disabled"});
      await desktop.page.locator(".fan-artwork").screenshot({path: path.join(evidenceDirectory, "fan-portrait-desktop-artwork.png"), animations: "disabled"});
      let trace = await desktop.page.evaluate(() => (window as FanWindow).__fanPortraitTrace!);
      expect(trace.states).toEqual(expect.arrayContaining(["opening", "ready"]));
      expectLeafMotion(trace.phases.initial.openingFrames, true);

      await desktop.page.evaluate(() => {(window as FanWindow).__fanPortraitTrace!.phase = "replay";});
      const replay = desktop.page.getByRole("button", {name: "重播照片的折扇展开动画", exact: true});
      await expect(replay).toBeEnabled();
      await replay.click();
      await expect(portrait).toHaveAttribute("data-fan-state", "closing");
      await expect(portrait).toHaveAttribute("data-fan-state", "opening", {timeout: 8_000});
      await desktop.page.waitForTimeout(350);
      await desktop.page.locator(".fan-artwork").screenshot({path: path.join(evidenceDirectory, "fan-portrait-opening.png")});
      await expect(portrait).toHaveAttribute("data-fan-state", "ready", {timeout: 15_000});
      await expectFanShape(desktop.page, "ready");
      trace = await desktop.page.evaluate(() => (window as FanWindow).__fanPortraitTrace!);
      expectLeafMotion(trace.phases.replay.closingFrames);
      expectLeafMotion(trace.phases.replay.openingFrames);

      await desktop.page.evaluate(() => {(window as FanWindow).__fanPortraitTrace!.phase = "fold";});
      const toggle = desktop.page.locator(".fan-toggle");
      await expect(toggle).toHaveAccessibleName("收起照片折扇");
      await toggle.click();
      await expect(portrait).toHaveAttribute("data-fan-state", "closing");
      await expect(portrait).toHaveAttribute("data-fan-state", "closed", {timeout: 8_000});
      await expect(toggle).toHaveAccessibleName("展开照片折扇");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expectFanShape(desktop.page, "closed");
      trace = await desktop.page.evaluate(() => (window as FanWindow).__fanPortraitTrace!);
      expectLeafMotion(trace.phases.fold.closingFrames);
      await desktop.page.locator(".fan-artwork").screenshot({path: path.join(evidenceDirectory, "fan-portrait-closed.png"), animations: "disabled"});

      await desktop.page.evaluate(() => {(window as FanWindow).__fanPortraitTrace!.phase = "keyboardOpen";});
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await desktop.page.keyboard.press("Enter");
      await expect(portrait).toHaveAttribute("data-fan-state", "opening");
      await expect(portrait).toHaveAttribute("data-fan-state", "ready", {timeout: 15_000});
      await expect(toggle).toHaveAccessibleName("收起照片折扇");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expectFanShape(desktop.page, "ready");
      await expect(toggle).toBeFocused();
      trace = await desktop.page.evaluate(() => (window as FanWindow).__fanPortraitTrace!);
      expectLeafMotion(trace.phases.keyboardOpen.openingFrames);
      expect(trace.states).toContain("closed");
      await noOverflow(desktop.page, 1440);
      expect(desktop.errors).toEqual([]);
    } finally {await desktop.context.close();}

    const mobile = await newContext(browser, {width: 390, height: 844}, "no-preference", true);
    try {
      await signIn(mobile.page);
      await noOverflow(mobile.page, 390);
      await verifyImageLoaded(mobile.page);
      const portrait = mobile.page.locator(".fan-portrait");
      await expect(portrait).toHaveAttribute("data-fan-state", "ready", {timeout: 15_000});
      await expectFanShape(mobile.page, "ready");
      const trace = await mobile.page.evaluate(() => (window as FanWindow).__fanPortraitTrace!);
      expectLeafMotion(trace.phases.initial.openingFrames, true);
      await mobile.page.screenshot({path: path.join(evidenceDirectory, "fan-portrait-mobile.png"), fullPage: true, animations: "disabled"});
      await mobile.page.locator(".fan-artwork").screenshot({path: path.join(evidenceDirectory, "fan-portrait-mobile-artwork.png"), animations: "disabled"});
      expect(mobile.errors).toEqual([]);
    } finally {await mobile.context.close();}

    const reduced = await newContext(browser, {width: 1440, height: 1000}, "reduce");
    try {
      await signIn(reduced.page);
      expect(await reduced.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      await verifyImageLoaded(reduced.page);
      const portrait = reduced.page.locator(".fan-portrait");
      await expect(portrait).toHaveAttribute("data-fan-state", "ready");
      await expectFanShape(reduced.page, "ready");
      await expect(reduced.page.locator(".fan-replay")).toHaveCount(0);
      await noOverflow(reduced.page, 1440);
      await reduced.page.screenshot({path: path.join(evidenceDirectory, "fan-portrait-reduced-motion.png"), fullPage: true, animations: "disabled"});
      await reduced.page.locator(".fan-artwork").screenshot({path: path.join(evidenceDirectory, "fan-portrait-reduced-motion-artwork.png"), animations: "disabled"});
      const trace = await reduced.page.evaluate(() => (window as FanWindow).__fanPortraitTrace!);
      expect(trace.states).toContain("ready");
      expect(trace.states).not.toContain("opening");
      expect(trace.states).not.toContain("closing");
      expect(reduced.errors).toEqual([]);
    } finally {await reduced.context.close();}
  });
});
