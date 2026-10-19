import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {devices, expect, test, type APIRequestContext, type Browser, type Page} from "@playwright/test";

const origin = "http://127.0.0.1:3007";
const evidenceDirectory = path.resolve("verification", "liquid-glass-refraction");
const desktopViewport = {width: 1440, height: 1100};
const mobileViewport = {width: 390, height: 844};
const credentials = {
  email: process.env.STARS_GLASS_OWNER_EMAIL ?? "",
  password: process.env.STARS_GLASS_OWNER_PASSWORD ?? "",
};
const tracks = [
  {title: "液态玻璃验收 · 合成音调 A", filename: "liquid-glass-test-a.wav", frequency: 440},
  {title: "液态玻璃验收 · 合成音调 B", filename: "liquid-glass-test-b.wav", frequency: 660},
] as const;

let owner: APIRequestContext;
const assetIds: Record<string, string> = {};

/** A locally generated sine wave, clearly labeled as browser-test media. */
function makeToneWav(frequency: number) {
  const rate = 22_050, seconds = 12, sampleCount = rate * seconds;
  const data = Buffer.alloc(sampleCount * 2), header = Buffer.alloc(44);
  for (let index = 0; index < sampleCount; index++) {
    const envelope = Math.min(1, index / 250, (sampleCount - index) / 500);
    data.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * frequency / rate) * 4500 * envelope), index * 2);
  }
  header.write("RIFF"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function assertIsolatedDataDirectory() {
  const value = process.env.STARS_GLASS_DATA_DIR;
  const relative = value ? path.relative(path.resolve(".test-data"), path.resolve(value)) : "";
  if (!relative.startsWith("glass-") || path.isAbsolute(relative) || relative.startsWith("..")) {
    throw new Error("Run only with playwright.glass.config.ts and its isolated .test-data directory");
  }
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
  let phase = "page setup";
  page.on("pageerror", error => {
    const summary = (value: unknown): unknown => {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
      if (typeof value !== "object") return typeof value;
      const detail = value as Record<string, unknown>;
      return {
        type: detail.type,
        name: detail.name,
        message: detail.message,
        tagName: detail.tagName,
        id: detail.id,
        src: detail.src,
        constructor: detail.constructor && (detail.constructor as {name?: string}).name,
      };
    };
    const details = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ownProperties: Object.fromEntries(Object.getOwnPropertyNames(error).map(name => [name, summary((error as unknown as Record<string, unknown>)[name])])),
    };
    errors.push(`${phase} @ ${page.url()}\n${JSON.stringify(details, null, 2)}`);
  });
  return {context, page, errors, setPhase: (value: string) => {phase = value;}};
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
  await page.getByLabel("密码", {exact: true}).fill(credentials.password);
  await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
  await expect(page.getByRole("heading", {name: /张杰/, level: 1})).toBeVisible();
  await expect(page.locator(".starsea-backdrop")).toBeVisible();
  await page.waitForTimeout(500);
}

async function noHorizontalOverflow(page: Page, expectedWidth: number) {
  const sizes = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth}));
  expect(sizes.viewport).toBe(expectedWidth);
  expect(sizes.document, `document overflow: ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(expectedWidth + 1);
  expect(sizes.body, `body overflow: ${JSON.stringify(sizes)}`).toBeLessThanOrEqual(expectedWidth + 1);
}

async function settleMusic(page: Page) {
  await expect(page.getByRole("heading", {name: "音乐馆", exact: true, level: 1})).toBeVisible();
  await expect(page.locator(".collection-stage.collection-player")).toBeVisible();
  await expect(page.locator(".ws-route-loading")).toBeHidden();
  await expect(page.locator(".ws-music-grid [data-testid=entry-card]")).toHaveCount(2);
  await expect(page.getByText(tracks[0].title, {exact: true}).first()).toBeVisible();
  await page.waitForTimeout(500);
}

async function inspectLoginSkyMotion(page: Page) {
  const sky = page.locator(".login-sky");
  await expect(sky).toBeVisible();
  await expect(sky).toHaveAttribute("aria-hidden", "true");
  await expect(sky).toHaveAttribute("data-motion-managed");
  const starCount = await sky.locator(".login-sky-star").count();
  const meteorCount = await sky.locator(".login-meteor").count();
  expect(starCount, "the login star field should be rendered by the server").toBe(58);
  expect(meteorCount, "the login decoration should include multiple meteors").toBe(3);
  const activeAnimations = await sky.evaluate(element => [...element.querySelectorAll<HTMLElement>(".login-sky-star, .login-sky-glow, .login-meteor")]
    .map(node => getComputedStyle(node).animationName));
  expect(activeAnimations).toContain("login-star-pulse");
  expect(activeAnimations).toContain("login-light-drift");
  expect(activeAnimations).toContain("login-meteor-pass");

  await page.emulateMedia({reducedMotion: "reduce"});
  const reducedAnimations = await sky.evaluate(element => [...element.querySelectorAll<HTMLElement>(".login-sky-star, .login-sky-glow, .login-meteor")]
    .map(node => getComputedStyle(node).animationName));
  expect(reducedAnimations.length).toBeGreaterThan(0);
  expect(reducedAnimations.every(name => name === "none"), "all login star, glow and meteor animation should stop with reduced motion").toBe(true);
  await page.emulateMedia({reducedMotion: "no-preference"});
  return {starCount, meteorCount, activeAnimations: [...new Set(activeAnimations)], reducedAnimations: [...new Set(reducedAnimations)]};
}

async function assertServerRenderedLoginGlass(page: Page) {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  const html = response ? await response.text() : "";
  const cardStart = html.indexOf("login-glass-card");
  expect(cardStart, "login glass card should exist in the server response").toBeGreaterThanOrEqual(0);
  const cardMarkup = html.slice(cardStart, cardStart + 1_200);
  expect(cardMarkup, "central polish layer should be server-rendered inside the login card").toMatch(/<span\b[^>]*data-glass-polish\b/);
  expect(cardMarkup, "edge refraction layer should be server-rendered inside the login card").toMatch(/<span\b[^>]*data-glass-edge\b/);
  return html;
}

function relativeLuminance(color: Rgb) {
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  };
  return .2126 * linearize(color.r) + .7152 * linearize(color.g) + .0722 * linearize(color.b);
}

function contrastRatio(first: Rgb, second: Rgb) {
  const luminance = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminance[0] + .05) / (luminance[1] + .05);
}

async function inspectAutofillAppearance(page: Page, selector: string, label: string, focused: boolean) {
  const field = page.locator(selector);
  const readStyle = () => field.evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      matchesAutofill: element.matches(":autofill") && element.matches(":-webkit-autofill"),
      focused: document.activeElement === element,
      boxShadow: computed.boxShadow,
      textFill: computed.getPropertyValue("-webkit-text-fill-color") || computed.color,
      type: (element as HTMLInputElement).type,
    };
  });
  const initial = await readStyle();
  expect(initial.matchesAutofill, `${label} must match the forced Chromium autofill pseudo-state`).toBe(true);
  await expect.poll(async () => /1000px.*inset/i.test((await readStyle()).boxShadow), {
    message: `${label} must settle on the deep inset after its shadow transition`,
    timeout: 1_500,
    intervals: [100, 180, 250, 350],
  }).toBe(true);
  const style = await readStyle();
  expect(style.focused, `${label} focus state`).toBe(focused);
  expect(style.boxShadow, `${label} must retain the deep inset autofill fill`).toMatch(/1000px.*inset/i);
  const backgroundColor = style.boxShadow.match(/rgba?\([^)]*\)/i)?.[0];
  expect(backgroundColor, `${label} must expose an inset fill color`).toBeTruthy();
  const foreground = parseCssColor(style.textFill);
  const background = parseCssColor(backgroundColor!);
  expect(contrastRatio(foreground, background), `${label} text contrast over its autofill fill`).toBeGreaterThanOrEqual(7);
  return {label, focused: style.focused, type: style.type, boxShadow: style.boxShadow, textFill: style.textFill, contrastRatio: contrastRatio(foreground, background)};
}

async function verifyBrowserAutofill(page: Page, mobile: boolean) {
  const fakeValues = {email: "autofill@example.test", password: "not-a-real-password"};
  const emailSelector = '.login-glass-card input[name="email"]';
  const passwordSelector = '.login-glass-card input[name="password"]';
  const emailField = page.locator(emailSelector);
  const passwordField = page.locator(passwordSelector);
  await emailField.fill(fakeValues.email);
  await passwordField.fill(fakeValues.password);

  const cdp = await page.context().newCDPSession(page);
  const nodeIds = new Map<string, number>();
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const {root} = await cdp.send("DOM.getDocument");
    for (const selector of [emailSelector, passwordSelector]) {
      const {nodeId} = await cdp.send("DOM.querySelector", {nodeId: root.nodeId, selector});
      expect(nodeId, `Chromium should find the autofill target ${selector}`).toBeGreaterThan(0);
      nodeIds.set(selector, nodeId);
      await cdp.send("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: ["autofill"]});
    }

    await passwordField.evaluate(element => element.blur());
    const emailBlur = await inspectAutofillAppearance(page, emailSelector, "email autofill", false);
    const passwordBlur = await inspectAutofillAppearance(page, passwordSelector, "password autofill", false);

    await emailField.focus();
    const emailFocus = await inspectAutofillAppearance(page, emailSelector, "focused email autofill", true);
    await emailField.evaluate(element => element.blur());
    await passwordField.focus();
    const passwordFocus = await inspectAutofillAppearance(page, passwordSelector, "focused password autofill", true);

    await page.getByRole("button", {name: "显示密码", exact: true}).click();
    await expect(passwordField).toHaveAttribute("type", "text");
    const passwordVisible = await inspectAutofillAppearance(page, passwordSelector, "visible password autofill", false);
    await page.getByRole("button", {name: "隐藏密码", exact: true}).click();
    await expect(passwordField).toHaveAttribute("type", "password");
    await expect(passwordField).toHaveValue(fakeValues.password);
    const passwordHidden = await inspectAutofillAppearance(page, passwordSelector, "masked password autofill", false);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await saveEvidence(page, mobile ? "login-autofill-mobile" : "login-autofill-desktop", {
      forcedPseudo: "autofill",
      email: fakeValues.email,
      passwordMasked: true,
      states: [emailBlur, passwordBlur, emailFocus, passwordFocus, passwordVisible, passwordHidden],
    });
    await expect(passwordField).toHaveAttribute("type", "password");
    await expect(passwordField).toHaveValue(fakeValues.password);

    for (const nodeId of nodeIds.values()) await cdp.send("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: []});
    await emailField.fill("");
    await passwordField.fill("");
    return {emailBlur, passwordBlur, emailFocus, passwordFocus, passwordVisible, passwordHidden};
  } finally {
    await cdp.detach();
  }
}

async function verifyLoginViewport(browser: Browser, mobile: boolean) {
  const {context, page, errors, setPhase} = await newPage(browser, mobile);
  const viewportWidth = mobile ? mobileViewport.width : desktopViewport.width;
  try {
    setPhase("anonymous login SSR and hydration");
    const html = await assertServerRenderedLoginGlass(page);
    await expect(page.getByRole("heading", {name: "欢迎回来", exact: true, level: 2})).toBeVisible();
    await expect(page.locator(".login-glass-card")).toHaveAttribute("data-glass-optics", "ready");
    expect(html, "login stars should be server-rendered").toMatch(/class="[^"]*login-sky[^"]*"/);
    expect(html.match(/class="[^"]*login-sky-star[^"]*"/g) || []).toHaveLength(58);
    const glass = await inspectGlass(page, ".login-glass-card", mobile ? "mobile login card" : "desktop login card", .18, 5);
    const formTitle = await inspectReadableText(page, ".login-glass-card h2", "login card title");
    const pageTitle = await inspectReadableText(page, ".stage-login-copy h1", "login artist title");
    const fieldLabel = await inspectReadableText(page, ".login-glass-card .ws-field", "login field label");
    const emailField = page.locator('.login-glass-card input[name="email"]');
    const passwordField = page.locator('.login-glass-card input[name="password"]');
    const emailInk = await inspectReadableText(page, '.login-glass-card input[name="email"]', "email field text");
    const passwordInk = await inspectReadableText(page, '.login-glass-card input[name="password"]', "password field text");
    await expect(emailField).toBeVisible();
    await expect(passwordField).toBeVisible();
    await noHorizontalOverflow(page, viewportWidth);
    const autofillAppearance = await verifyBrowserAutofill(page, mobile);

    const authStatus = await (await page.request.get("/api/auth/status")).json();
    expect(authStatus).toMatchObject({authenticated: false, setupRequired: false, mode: "local"});
    const protectedResponse = await context.request.get("/app/dashboard", {maxRedirects: 0});
    const protectedStatus = protectedResponse.status();
    expect([200, 307], "the private dashboard must redirect anonymous requests, including Next.js streaming redirects").toContain(protectedStatus);
    let protectedLocation: string | undefined;
    const protectedMarkup = await protectedResponse.text();
    if (protectedStatus === 307) {
      protectedLocation = protectedResponse.headers().location;
      expect(protectedLocation).toBeTruthy();
      expect(new URL(protectedLocation!, origin).pathname).toBe("/login");
    } else {
      expect(protectedMarkup, "Next.js streaming redirects must point to the login route").toContain('<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/login"/>');
      expect(protectedMarkup, "the streaming response must carry Next.js redirect state").toContain("NEXT_REDIRECT");
    }
    expect(protectedMarkup, "anonymous dashboard responses must not include the private dashboard").not.toContain("concert-dashboard");
    expect(protectedMarkup, "anonymous dashboard responses must not leak private entry markup").not.toContain('data-testid="entry-card"');
    for (const track of tracks) {
      expect(protectedMarkup, `anonymous dashboard responses must not leak the private test record ${track.title}`).not.toContain(track.title);
    }
    for (const route of ["/api/entries", "/api/assets", "/api/artist-portrait", "/api/starsea-frames"]) {
      const response = await context.request.get(route);
      expect(response.status(), `anonymous access to ${route} must be unauthorized`).toBe(401);
    }

    const skyMotion = await inspectLoginSkyMotion(page);
    const starField = page.locator(".login-sky");
    const starCount = await starField.locator(".login-sky-star").count();
    const meteorCount = await starField.locator(".login-meteor").count();

    const passwordButton = page.getByRole("button", {name: "显示密码", exact: true});
    await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
    await passwordField.fill(credentials.password);
    await passwordButton.click();
    await expect(passwordField).toHaveAttribute("type", "text");
    await expect(passwordField).toHaveValue(credentials.password);
    await page.getByRole("button", {name: "隐藏密码", exact: true}).click();
    await expect(passwordField).toHaveAttribute("type", "password");
    await expect(passwordField).toHaveValue(credentials.password);

    await page.getByLabel("邮箱", {exact: true}).fill("");
    await passwordField.fill("");
    await expect(passwordField).toHaveValue("");
    await noHorizontalOverflow(page, viewportWidth);
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveEvidence(page, mobile ? "login-mobile" : "login-desktop", {
      glass, formTitle, pageTitle, fieldLabel, emailInk, passwordInk,
      starCount, meteorCount, skyMotion, passwordClearedBeforeCapture: true,
      autofillAppearance, anonymousStatus: authStatus, protectedRedirect: {status: protectedStatus, location: protectedLocation ?? null},
    });

    setPhase("anonymous browser redirect to login");
    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login\/?$/);
    await expect(page.getByRole("heading", {name: "欢迎回来", exact: true, level: 2})).toBeVisible();

    setPhase("submit incorrect isolated password");
    if (!mobile) {
      const wrongPassword = `${credentials.password}-wrong`;
      await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
      await passwordField.fill(wrongPassword);
      await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("button", {name: "进入纪念馆", exact: true})).toBeEnabled();
      await expect(passwordField).toHaveValue(wrongPassword);
    }

    setPhase("submit valid isolated account and enter private dashboard");
    await page.getByLabel("邮箱", {exact: true}).fill(credentials.email);
    await passwordField.fill(credentials.password);
    await page.getByRole("button", {name: "进入纪念馆", exact: true}).click();
    await expect(page).toHaveURL(/\/app\/dashboard\/?$/);
    await expect(page.getByRole("heading", {name: /张杰/, level: 1})).toBeVisible();
    const authenticatedStatus = await (await page.request.get("/api/auth/status")).json();
    expect(authenticatedStatus).toMatchObject({authenticated: true, setupRequired: false, mode: "local"});
    expect(errors).toEqual([]);
  } finally {await context.close();}
}

type Rgb = {r: number; g: number; b: number; alpha: number};

function parseCssColor(color: string): Rgb {
  const body = color.match(/rgba?\(([^)]*)\)/i)?.[1];
  if (!body) return {r: 0, g: 0, b: 0, alpha: 0};
  const values = body.replace("/", " ").trim().split(/[\s,]+/).filter(Boolean);
  const channel = (value: string) => value.endsWith("%") ? Number(value.slice(0, -1)) * 2.55 : Number(value);
  const alpha = values[3] ? values[3].endsWith("%") ? Number(values[3].slice(0, -1)) / 100 : Number(values[3]) : 1;
  return {r: channel(values[0]), g: channel(values[1]), b: channel(values[2]), alpha};
}

function cssGlassMetric(metrics: {filter: string; backgroundColor: string; backgroundImage: string}) {
  const blur = Number(metrics.filter.match(/blur\(([-\d.]+)px\)/)?.[1] || 0);
  const tint = parseCssColor(metrics.backgroundColor);
  return {blur, tint, backgroundColor: metrics.backgroundColor, backgroundImage: metrics.backgroundImage};
}

function maxCssAlpha(value: string) {
  const colors = [...value.matchAll(/rgba?\(([^)]*)\)/gi)].map(match => parseCssColor(`rgba(${match[1]})`).alpha);
  return colors.length ? Math.max(...colors) : 0;
}

async function inspectGlass(page: Page, selector: string, label: string, alphaLimit = .18, blurLimit = 5) {
  const surface = page.locator(selector).first();
  await expect(surface, `${label} glass surface is missing`).toBeVisible();
  await surface.scrollIntoViewIfNeeded();
  await expect(surface, `${label} glass optics must be mounted`).toHaveAttribute("data-glass-optics", "ready");
  const supportsRefraction = await page.evaluate(() => CSS.supports("backdrop-filter", 'url("#glass-support-check")'));
  if (supportsRefraction) {
    await expect.poll(() => surface.getAttribute("data-glass-refraction"), {
      message: `${label} SVG edge refraction should attach after the glass surface is observed`,
      timeout: 4_000,
      intervals: [80, 140, 220],
    }).toBe("supported");
  }
  const style = await surface.evaluate(element => {
    const computed = getComputedStyle(element);
    const polish = element.querySelector<HTMLElement>("[data-glass-polish]");
    const edge = element.querySelector<HTMLElement>("[data-glass-edge]");
    const polishStyle = polish ? getComputedStyle(polish) : null;
    const edgeStyle = edge ? getComputedStyle(edge) : null;
    return {
      hostFilter: computed.backdropFilter || computed.getPropertyValue("-webkit-backdrop-filter"),
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      polish: polishStyle ? {
        backgroundColor: polishStyle.backgroundColor,
        backgroundImage: polishStyle.backgroundImage,
        opacity: Number(polishStyle.opacity),
        filter: polishStyle.backdropFilter || polishStyle.getPropertyValue("-webkit-backdrop-filter"),
      } : null,
      edgeFilter: edgeStyle ? edgeStyle.backdropFilter || edgeStyle.getPropertyValue("-webkit-backdrop-filter") : "missing",
      edgeCount: element.querySelectorAll("[data-glass-edge]").length,
      refractionState: element.getAttribute("data-glass-refraction"),
    };
  });
  expect(style.polish, `${label} must have its central polish layer`).not.toBeNull();
  expect(style.edgeCount, `${label} must have one edge refraction layer`).toBe(1);
  const tint = parseCssColor(style.backgroundColor);
  const polishTint = parseCssColor(style.polish?.backgroundColor || "transparent");
  const filmAlpha = Math.max(
    tint.alpha,
    maxCssAlpha(style.backgroundImage),
    polishTint.alpha * (style.polish?.opacity ?? 1),
    maxCssAlpha(style.polish?.backgroundImage || "") * (style.polish?.opacity ?? 1),
  );
  const metrics = cssGlassMetric({filter: style.polish?.filter || "none", backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage});
  expect(filmAlpha, `${label} central film must provide its intended tint`).toBeGreaterThanOrEqual(.04);
  expect(filmAlpha, `${label} central film alpha must not exceed ${alphaLimit} (${JSON.stringify(style)})`).toBeLessThanOrEqual(alphaLimit);
  expect(metrics.blur, `${label} central image should receive a frost layer (${style.polish?.filter})`).toBeGreaterThanOrEqual(2);
  expect(metrics.blur, `${label} central image should stay within its allowed blur (${style.polish?.filter})`).toBeLessThanOrEqual(blurLimit);
  expect(style.hostFilter, `${label} host must not capture or blur the whole backdrop`).toBe("none");
  if (supportsRefraction) {
    expect(style.edgeFilter, `${label} edge layer must carry its own SVG refraction filter`).toMatch(/url\(/i);
    expect(style.refractionState, `${label} should report mounted refraction`).toBe("supported");
  } else {
    expect(style.edgeFilter, `${label} unsupported-browser fallback should remain a very light blur`).toBe("blur(0.3px)");
  }
  return {label, alphaLimit, filmAlpha, blur: metrics.blur, hostFilter: style.hostFilter, edgeFilter: style.edgeFilter, polish: style.polish, tint, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage};
}

async function inspectReadableText(page: Page, selector: string, label: string) {
  const text = page.locator(selector).first();
  await expect(text, `${label} should be visible on the glass`).toBeVisible();
  const color = await text.evaluate(element => getComputedStyle(element).color);
  const foreground = parseCssColor(color);
  expect(foreground.r, `${label} should use near-white text (${color})`).toBeGreaterThanOrEqual(205);
  expect(foreground.g, `${label} should use near-white text (${color})`).toBeGreaterThanOrEqual(205);
  expect(foreground.b, `${label} should use near-white text (${color})`).toBeGreaterThanOrEqual(205);
  expect(foreground.alpha, `${label} should remain visible (${color})`).toBeGreaterThanOrEqual(.82);
  return {label, color, tone: "near-white"};
}

async function saveEvidence(page: Page, name: string, details: Record<string, unknown> = {}, fullPage = true) {
  await mkdir(evidenceDirectory, {recursive: true});
  await page.screenshot({path: path.join(evidenceDirectory, `${name}.png`), fullPage, animations: "disabled"});
  const json = JSON.stringify({name, viewport: await page.evaluate(() => ({width: innerWidth, height: innerHeight})), ...details}, null, 2);
  await writeFile(path.join(evidenceDirectory, `${name}.json`), json, "utf8");
  await test.info().attach(`${name}.json`, {body: json, contentType: "application/json"});
}

type CssBox = {x: number; y: number; width: number; height: number};
type RefractionPixelMetrics = {
  centralTransmission: number;
  referenceStripeVariance: number;
  effectedStripeVariance: number;
  centerMeanDiff: number;
  edgeMeanDiff: number;
  edgeChangedFraction: number;
  textMeanDiff: number;
};

const controlledBackdropCss = `
  .starsea-backdrop {
    background: repeating-linear-gradient(90deg,
      #101a35 0 32px, #f23b69 32px 64px, #16c9b3 64px 96px,
      #e9c840 96px 128px, #3d66e9 128px 160px) !important;
  }
  .starsea-backdrop::before, .starsea-backdrop::after,
  .starsea-backdrop > * { display: none !important; visibility: hidden !important; }
  html[data-glass-test-freeze="true"] *,
  html[data-glass-test-freeze="true"] *::before,
  html[data-glass-test-freeze="true"] *::after {
    animation: none !important; transition: none !important; caret-color: transparent !important;
  }
  [data-glass-probe="true"] > :not([data-glass-polish]):not([data-glass-edge]) { visibility: hidden !important; }
  [data-glass-probe="true"][data-glass-probe-effects="off"] {
    background: transparent !important; border-color: transparent !important; box-shadow: none !important;
  }
  [data-glass-probe="true"][data-glass-probe-effects="off"] > :is([data-glass-polish], [data-glass-edge]) {
    visibility: hidden !important; opacity: 0 !important;
  }
`;

async function compareScreenshotPixels(page: Page, referencePng: Buffer, effectedPng: Buffer, surfaceBox: CssBox, textBox?: CssBox): Promise<RefractionPixelMetrics> {
  return page.evaluate(async ({reference, effected, box, text}) => {
    const decode = async (encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], {type: "image/png"}));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) throw new Error("Canvas pixel inspection is unavailable");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      return {width: canvas.width, height: canvas.height, data: pixels.data};
    };
    const [a, b] = await Promise.all([decode(reference), decode(effected)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error("Screenshot sizes changed during the refraction comparison");
    const scaleX = a.width / innerWidth, scaleY = a.height / innerHeight;
    const sample = (image: typeof a, cssX: number, cssY: number) => {
      const x = Math.round(cssX * scaleX), y = Math.round(cssY * scaleY);
      const sums = [0, 0, 0]; let count = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const sx = Math.max(0, Math.min(image.width - 1, x + dx));
        const sy = Math.max(0, Math.min(image.height - 1, y + dy));
        const index = (sy * image.width + sx) * 4;
        sums[0] += image.data[index]; sums[1] += image.data[index + 1]; sums[2] += image.data[index + 2]; count++;
      }
      return sums.map(value => value / count);
    };
    const variance = (values: number[][]) => {
      if (!values.length) return 0;
      const means = [0, 1, 2].map(channel => values.reduce((sum, value) => sum + value[channel], 0) / values.length);
      return values.reduce((sum, value) => sum + value.reduce((channelSum, channel, index) => channelSum + (channel - means[index]) ** 2, 0) / 3, 0) / values.length;
    };
    const left = box.x + box.width * .26, right = box.x + box.width * .74;
    const y = box.y + box.height * .56;
    const sampleXs: number[] = [];
    let stripeCenter = Math.floor(left / 32) * 32 + 16;
    if (stripeCenter < left) stripeCenter += 32;
    for (let x = stripeCenter; x < right; x += 32) sampleXs.push(x);
    const referenceStripeVariance = variance(sampleXs.map(x => sample(a, x, y)));
    const effectedStripeVariance = variance(sampleXs.map(x => sample(b, x, y)));
    const centralTransmission = referenceStripeVariance ? Math.sqrt(effectedStripeVariance / referenceStripeVariance) : 0;
    const meanDiff = (region: CssBox, mode: "all" | "edge" | "center", edgeWidth = 12) => {
      const x0 = Math.max(0, Math.floor(region.x * scaleX)), y0 = Math.max(0, Math.floor(region.y * scaleY));
      const x1 = Math.min(a.width, Math.ceil((region.x + region.width) * scaleX));
      const y1 = Math.min(a.height, Math.ceil((region.y + region.height) * scaleY));
      const ring = edgeWidth * Math.min(scaleX, scaleY);
      let total = 0, changed = 0, pixels = 0;
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
        const distance = Math.min(px - x0, x1 - 1 - px, py - y0, y1 - 1 - py);
        if ((mode === "edge" && distance >= ring) || (mode === "center" && distance < ring)) continue;
        const index = (py * a.width + px) * 4;
        const delta = Math.abs(a.data[index] - b.data[index]) + Math.abs(a.data[index + 1] - b.data[index + 1]) + Math.abs(a.data[index + 2] - b.data[index + 2]);
        total += delta / 3; if (delta >= 9) changed++; pixels++;
      }
      return {mean: pixels ? total / pixels : 0, changedFraction: pixels ? changed / pixels : 0};
    };
    const edge = meanDiff(box, "edge");
    const center = meanDiff(box, "center");
    return {
      centralTransmission,
      referenceStripeVariance,
      effectedStripeVariance,
      centerMeanDiff: center.mean,
      edgeMeanDiff: edge.mean,
      edgeChangedFraction: edge.changedFraction,
      textMeanDiff: text ? meanDiff(text, "all").mean : 0,
    };
  }, {reference: referencePng.toString("base64"), effected: effectedPng.toString("base64"), box: surfaceBox, text: textBox || null});
}

async function verifyCentralTransparencyAndEdgeRefraction(page: Page, surfaceSelector: string, textSelector: string, name: string) {
  const originalScrollY = await page.evaluate(() => scrollY);
  const surface = page.locator(surfaceSelector).first();
  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toHaveAttribute("data-glass-optics", "ready");
  if (await page.evaluate(() => CSS.supports("backdrop-filter", 'url("#glass-support-check")'))) {
    await expect.poll(() => surface.getAttribute("data-glass-refraction"), {
      message: `${name} SVG edge refraction should be mounted before pixel comparison`,
      timeout: 4_000,
      intervals: [80, 140, 220],
    }).toBe("supported");
  }
  await page.waitForTimeout(250);
  const surfaceBox = await surface.boundingBox();
  const textBox = await page.locator(textSelector).first().boundingBox();
  if (!surfaceBox || !textBox) throw new Error(`${name} pixel probe needs a visible surface and text`);
  const styleTag = await page.addStyleTag({content: controlledBackdropCss});
  try {
    await mkdir(evidenceDirectory, {recursive: true});
    await page.evaluate(() => { document.documentElement.dataset.glassTestFreeze = "true"; });
    await surface.evaluate(element => element.setAttribute("data-glass-probe", "true"));
    await surface.evaluate(element => element.setAttribute("data-glass-probe-effects", "off"));
    await page.waitForTimeout(60);
    const reference = await page.screenshot({path: path.join(evidenceDirectory, `${name}-controlled-reference.png`), animations: "disabled"});
    await surface.evaluate(element => element.removeAttribute("data-glass-probe-effects"));
    await page.waitForTimeout(60);
    const transmitted = await page.screenshot({path: path.join(evidenceDirectory, `${name}-controlled-film.png`), animations: "disabled"});
    const transmission = await compareScreenshotPixels(page, reference, transmitted, surfaceBox);

    await surface.evaluate(element => element.removeAttribute("data-glass-probe"));
    await page.evaluate(() => { document.documentElement.dataset.glassRefraction = "off"; });
    await page.waitForTimeout(60);
    const edgeOff = await page.screenshot({path: path.join(evidenceDirectory, `${name}-edge-disabled.png`), animations: "disabled"});
    await page.evaluate(() => { delete document.documentElement.dataset.glassRefraction; });
    await page.waitForTimeout(60);
    const edgeOn = await page.screenshot({path: path.join(evidenceDirectory, `${name}-edge-enabled.png`), animations: "disabled"});
    const edge = await compareScreenshotPixels(page, edgeOff, edgeOn, surfaceBox, textBox);
    const details = {name, viewport: await page.evaluate(() => ({width: innerWidth, height: innerHeight})), transmission, edge, controlledBackdrop: "32px alternating color stripes", edgeBandCssPixels: 12};
    const json = JSON.stringify(details, null, 2);
    await writeFile(path.join(evidenceDirectory, `${name}-pixel-analysis.json`), json, "utf8");
    await test.info().attach(`${name}-pixel-analysis.json`, {body: json, contentType: "application/json"});
    expect(transmission.referenceStripeVariance, `${name} controlled source should contain distinct center stripes`).toBeGreaterThan(900);
    expect(transmission.centralTransmission, `${name} center should transmit most of the underlying image`).toBeGreaterThanOrEqual(.72);
    expect(edge.edgeMeanDiff, `${name} refraction should visibly affect the edge ring`).toBeGreaterThan(.25);
    expect(edge.edgeChangedFraction, `${name} refraction should change a visible portion of the edge ring`).toBeGreaterThan(.005);
    expect(edge.centerMeanDiff, `${name} refraction must leave the center unchanged`).toBeLessThanOrEqual(.5);
    expect(edge.textMeanDiff, `${name} refraction must not distort foreground text`).toBeLessThanOrEqual(.5);
    return details;
  } finally {
    await page.evaluate(() => {
      delete document.documentElement.dataset.glassTestFreeze;
      delete document.documentElement.dataset.glassRefraction;
    });
    await surface.evaluate(element => {
      element.removeAttribute("data-glass-probe");
      element.removeAttribute("data-glass-probe-effects");
    });
    await styleTag.evaluate(element => element.parentNode?.removeChild(element));
    await page.evaluate(y => window.scrollTo(0, y), originalScrollY);
  }
}

async function setUpEntries() {
  for (const [index, track] of tracks.entries()) {
    const upload = await owner.post("/api/assets", {headers: {Origin: origin}, multipart: {
      file: {name: track.filename, mimeType: "audio/wav", buffer: makeToneWav(track.frequency)},
    }});
    expect(upload.status(), await upload.text()).toBe(201);
    const asset = (await upload.json()).asset as {id: string};
    assetIds[track.title] = asset.id;
    const created = await owner.post("/api/entries", {headers: {Origin: origin}, data: {
      kind: "music",
      title: track.title,
      favorite: true,
      data: {
        assetId: asset.id,
        sourceType: "authorized_upload",
        artist: "本地合成音调",
        description: `Playwright 液态玻璃视觉验收用合成测试数据 ${index + 1}，不对应真实歌曲或艺人作品。`,
      },
    }});
    expect(created.status(), await created.text()).toBe(201);
    const entry = (await created.json()).entry as {id: string};
    expect(entry.id).toBeTruthy();
  }
}

test.describe.serial("liquid-glass surfaces and star-sea readability", () => {
  test.beforeAll(async ({playwright}) => {
    assertIsolatedDataDirectory();
    if (!credentials.email || !credentials.password) throw new Error("The isolated liquid-glass test owner was not configured");
    owner = await playwright.request.newContext({baseURL: origin});
    const status = await (await owner.get("/api/auth/status")).json();
    expect(status).toMatchObject({authenticated: false, setupRequired: true, mode: "local"});
    const setup = await owner.post("/api/auth/setup", {headers: {Origin: origin}, data: credentials});
    expect(setup.ok(), await setup.text()).toBe(true);
    await setUpEntries();
  });

  test.afterAll(async () => {await owner?.dispose();});

  test("desktop login page renders server-side glass and preserves protected access", async ({browser}) => {
    test.setTimeout(75_000);
    await verifyLoginViewport(browser, false);
  });

  test("mobile login page renders server-side glass and preserves protected access", async ({browser}) => {
    test.setTimeout(75_000);
    await verifyLoginViewport(browser, true);
  });

  test("desktop dashboard, dropdown and music list use readable glass while several meteors overlap", async ({browser}) => {
    test.setTimeout(75_000);
    const {context, page, errors} = await newPage(browser);
    try {
      await signIn(page);
      await expect(page.locator(".starsea-backdrop")).toHaveAttribute("data-motion-state", "running");
      await noHorizontalOverflow(page, desktopViewport.width);
      await expect(page.locator(".concert-journey")).toBeVisible();
      await expect(page.locator(".concert-chapter-music")).toContainText(tracks[0].title);
      const dashboardGlass = await inspectGlass(page, ".concert-journey", "dashboard journey");
      const journeyText = await inspectReadableText(page, ".concert-journey h2", "journey title");
      const refractionPixels = await verifyCentralTransparencyAndEdgeRefraction(page, ".concert-journey", ".concert-journey h2", "desktop-dashboard-journey");
      const backdrop = page.locator(".starsea-backdrop");
      await expect.poll(async () => Number(await backdrop.getAttribute("data-meteor-count")), {timeout: 12_000, intervals: [100, 180, 250]}).toBeGreaterThanOrEqual(3);
      const meteorCount = Number(await backdrop.getAttribute("data-meteor-count"));
      await saveEvidence(page, "desktop-dashboard", {dashboardGlass, journeyText, refractionPixels, meteorCount});

      const repertoire = page.locator(".concert-repertoire");
      await expect(repertoire).toBeVisible();
      await repertoire.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const collectionCards = await page.locator(".concert-chapter").count();
      await saveEvidence(page, "desktop-dashboard-collections", {collectionCards, whiteGlassPanels: true, meteorCount}, false);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByRole("button", {name: "更多珍藏", exact: true})).toBeVisible();

      await page.getByRole("button", {name: "更多珍藏", exact: true}).click();
      const dropdown = page.locator(".nav-dropdown");
      await expect(dropdown).toBeVisible();
      const dropdownGlass = await inspectGlass(page, ".nav-dropdown", "desktop navigation dropdown", .92, 24);
      const dropdownText = await inspectReadableText(page, ".nav-dropdown .collection-menu-group a", "dropdown link");
      await noHorizontalOverflow(page, desktopViewport.width);
      await saveEvidence(page, "desktop-navigation-dropdown", {dropdownGlass, dropdownText}, false);

      await page.getByRole("link", {name: "音乐馆", exact: true}).click();
      await expect(page).toHaveURL(/\/app\/music\/?$/);
      await settleMusic(page);
      const musicGlass = await inspectGlass(page, ".ws-music-grid", "music list");
      const musicText = await inspectReadableText(page, ".ws-music-grid .ws-card-body h2 button", "music title");
      const playerGlass = await inspectGlass(page, ".collection-stage.collection-player", "listening desk");
      await noHorizontalOverflow(page, desktopViewport.width);
      await saveEvidence(page, "desktop-music-library", {musicGlass, musicText, playerGlass});

      await page.getByTestId("entry-create").click();
      const editor = page.getByRole("dialog", {name: "新增音乐馆", exact: true});
      await expect(editor).toBeVisible();
      const modalOptics = await inspectGlass(page, ".ws-modal", "record editor modal", .9, 24);
      const modalTitle = await inspectReadableText(page, ".ws-modal-head h2", "editor title");
      const formLabel = await inspectReadableText(page, ".ws-modal .ws-title-field", "editor field label");
      await saveEvidence(page, "desktop-music-editor-modal", {modalOptics, modalTitle, formLabel}, false);
      await editor.getByRole("button", {name: "关闭弹窗", exact: true}).click();
      await expect(editor).toBeHidden();

      await page.getByRole("button", {name: "上传歌曲", exact: true}).click();
      const uploader = page.getByRole("dialog", {name: "添加歌曲", exact: true});
      await expect(uploader).toBeVisible();
      const uploaderOptics = await inspectGlass(page, ".ws-modal", "upload modal", .9, 24);
      const uploaderTitle = await inspectReadableText(page, ".ws-modal-head h2", "upload modal title");
      const uploaderField = await inspectReadableText(page, ".media-importer .ws-field", "upload field label");
      await saveEvidence(page, "desktop-music-upload-modal", {uploaderOptics, uploaderTitle, uploaderField}, false);
      await uploader.getByRole("button", {name: "取消", exact: true}).click();
      await expect(uploader).toBeHidden();
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("dialog frost stays over the entire form after scrolling on desktop and mobile", async ({browser}) => {
    for (const mobile of [false, true]) {
      const {context, page, errors} = await newPage(browser, mobile);
      try {
        await signIn(page);
        await page.goto("/app/music");
        await page.getByTestId("entry-create").click();
        const editor = page.getByRole("dialog", {name: "新增音乐馆", exact: true});
        const optics = await inspectGlass(page, ".ws-modal", "readable editor", .9, 24);
        expect(optics.filmAlpha, "form text needs a stable reading surface").toBeGreaterThanOrEqual(.65);
        await editor.getByRole("button", {name: /^添加音频/}).click();
        await editor.getByRole("button", {name: /^更多设置/}).click();
        const body = editor.locator(":scope > .ws-modal-body");
        await expect.poll(() => body.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
        await body.evaluate(el => {el.scrollTop = el.scrollHeight;});
        await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(200);
        const coverage = await editor.evaluate(el => {
          const host = el.getBoundingClientRect();
          const polish = el.querySelector(":scope > [data-glass-polish]")!.getBoundingClientRect();
          return {topInset: polish.top - host.top, bottomInset: host.bottom - polish.bottom, hostScroll: el.scrollTop};
        });
        expect(coverage.hostScroll, "only the inner form should scroll").toBe(0);
        expect(Math.abs(coverage.topInset), "frost must stay at the top of the dialog").toBeLessThanOrEqual(2);
        expect(Math.abs(coverage.bottomInset), "frost must cover the bottom after scrolling").toBeLessThanOrEqual(2);
        await expect(editor.getByRole("button", {name: "关闭弹窗", exact: true})).toBeInViewport();
        await noHorizontalOverflow(page, mobile ? mobileViewport.width : desktopViewport.width);
        await page.keyboard.press("Escape");
        await expect(editor).toBeHidden();
        await expect(page.getByTestId("entry-create")).toBeFocused();
        expect(errors).toEqual([]);
      } finally {await context.close();}
    }
  });

  test("real generated tracks update the listening desk and the dock collapses without stopping audio", async ({browser}) => {
    test.setTimeout(60_000);
    const {context, page, errors, setPhase} = await newPage(browser);
    try {
      setPhase("sign in");
      await signIn(page);
      await expect(page.locator(".starsea-backdrop")).toHaveAttribute("data-motion-state", "running");
      setPhase("direct navigation to /app/music");
      await page.goto("/app/music");
      await settleMusic(page);
      const audio = page.getByTestId("global-audio");
      const stage = page.getByRole("region", {name: "星轨唱片台", exact: true});
      const firstCard = page.getByTestId("entry-card").filter({hasText: tracks[0].title});
      setPhase("select first generated track");
      await firstCard.getByRole("button", {name: tracks[0].title, exact: true}).click();
      await expect(stage.getByRole("heading", {level: 2, name: tracks[0].title, exact: true})).toBeVisible();
      await expect(firstCard).toHaveAttribute("data-selected", "true");
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${assetIds[tracks[0].title]}`);
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);

      const secondCard = page.getByTestId("entry-card").filter({hasText: tracks[1].title});
      setPhase("select second generated track and collapse dock");
      await secondCard.getByRole("button", {name: tracks[1].title, exact: true}).click();
      await expect(stage.getByRole("heading", {level: 2, name: tracks[1].title, exact: true})).toBeVisible();
      await expect(secondCard).toHaveAttribute("data-selected", "true");
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain(`/api/assets/${assetIds[tracks[1].title]}`);
      const dock = page.getByTestId("music-dock-shell");
      const dockRegion = page.getByRole("region", {name: "音乐播放器", exact: true});
      await expect(dockRegion.getByRole("link", {name: tracks[1].title, exact: true})).toBeVisible();
      const dockGlass = await inspectGlass(page, ".music-dock", "expanded player dock", .9, 20);
      await page.mouse.move(0, 0);
      await expect(dock).toHaveAttribute("data-state", "collapsed", {timeout: 7_000});
      await expect(page.getByRole("button", {name: /展开音乐播放器/})).toBeVisible();
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
      const hiddenPlayhead = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
      await page.waitForTimeout(600);
      expect(await audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(hiddenPlayhead + .4);
      await saveEvidence(page, "desktop-music-dock-collapsed", {dockGlass, currentTitle: tracks[1].title, playbackContinued: true}, false);
      setPhase("assert no page errors after playback");
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("mobile glass menu and music list stay inside the screen with a small meteor group", async ({browser}) => {
    test.setTimeout(75_000);
    const {context, page, errors} = await newPage(browser, true);
    try {
      await signIn(page);
      await expect(page.locator(".starsea-backdrop")).toHaveAttribute("data-motion-state", "running");
      await noHorizontalOverflow(page, mobileViewport.width);
      await expect(page.locator(".concert-journey")).toBeVisible();
      const dashboardGlass = await inspectGlass(page, ".concert-journey", "mobile dashboard journey");
      const journeyText = await inspectReadableText(page, ".concert-journey h2", "mobile journey title");
      const backdrop = page.locator(".starsea-backdrop");
      await expect.poll(async () => Number(await backdrop.getAttribute("data-meteor-count")), {timeout: 12_000, intervals: [100, 180, 250]}).toBeGreaterThanOrEqual(2);
      const meteorCount = Number(await backdrop.getAttribute("data-meteor-count"));
      await saveEvidence(page, "mobile-dashboard", {dashboardGlass, journeyText, meteorCount});

      await page.getByRole("button", {name: "打开菜单", exact: true}).click();
      const mobileNav = page.getByRole("navigation", {name: "移动端导航", exact: true});
      await expect(mobileNav).toBeVisible();
      const navGlass = await inspectGlass(page, ".mobile-nav", "mobile navigation", .92, 24);
      const navText = await inspectReadableText(page, ".mobile-nav .mobile-primary-links a", "mobile navigation link");
      await noHorizontalOverflow(page, mobileViewport.width);
      await saveEvidence(page, "mobile-navigation", {navGlass, navText}, false);
      await mobileNav.getByRole("link", {name: "音乐馆", exact: true}).click();
      await expect(page).toHaveURL(/\/app\/music\/?$/);
      await settleMusic(page);
      const musicGlass = await inspectGlass(page, ".ws-music-grid", "mobile music list");
      const musicText = await inspectReadableText(page, ".ws-music-grid .ws-card-body h2 button", "mobile music title");
      const playerGlass = await inspectGlass(page, ".collection-stage.collection-player", "mobile listening desk");
      await noHorizontalOverflow(page, mobileViewport.width);
      await saveEvidence(page, "mobile-music-library", {musicGlass, musicText, playerGlass});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });

  test("system reduced motion and the saved off switch stop star and meteor motion", async ({browser}) => {
    const reduced = await newPage(browser, false, "reduce");
    try {
      await signIn(reduced.page);
      const backdrop = reduced.page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-motion-state", "paused");
      await expect(backdrop).toHaveAttribute("data-meteor-state", "disabled");
      await expect(backdrop).toHaveAttribute("data-meteor-count", "0");
      const staticCanvas = await reduced.page.locator("canvas.starsea-audience").evaluate(element => (element as HTMLCanvasElement).toDataURL());
      await reduced.page.waitForTimeout(500);
      expect(await reduced.page.locator("canvas.starsea-audience").evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(staticCanvas);
      await saveEvidence(reduced.page, "desktop-system-reduced-motion", {motionState: "paused", meteorCount: 0}, false);
      expect(reduced.errors).toEqual([]);
    } finally {await reduced.context.close();}

    const {context, page, errors} = await newPage(browser);
    try {
      await signIn(page);
      await expect(page.locator(".starsea-backdrop")).toHaveAttribute("data-motion-state", "running");
      await page.goto("/app/settings");
      await expect(page.getByRole("heading", {name: "网站设置", exact: true, level: 1})).toBeVisible();
      const animation = page.getByLabel("开启动效", {exact: true});
      await expect(animation).toBeChecked();
      await page.locator("label.secondary-switch").click();
      await expect(animation).not.toBeChecked();
      await page.getByRole("button", {name: "保存设置", exact: true}).click();
      await expect(page.getByRole("status").filter({hasText: "网站设置已保存。"})).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
      const backdrop = page.locator(".starsea-backdrop");
      await expect(backdrop).toHaveAttribute("data-motion-state", "paused");
      await expect(backdrop).toHaveAttribute("data-meteor-state", "disabled");
      await expect(backdrop).toHaveAttribute("data-meteor-count", "0");
      const settingsGlass = await inspectGlass(page, ".secondary-motion-choice", "settings motion panel", .68, 18);
      await noHorizontalOverflow(page, desktopViewport.width);
      await saveEvidence(page, "desktop-settings-motion-off", {settingsGlass, motionState: "off", meteorCount: 0});
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
});
