import { expect, test, type Route } from "@playwright/test";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { readFileSync } from "node:fs";

const source = "https://media.example/canopy-playback.mp4";
const note = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: `Playback test ${source}` }, generateSecretKey());
const path = `/event/${nip19.neventEncode({ id: note.id })}`;
const fixture = readFileSync(new URL("./fixtures/playback.mp4", import.meta.url));

function mediaResponse(route: Route, body = fixture) {
  const range = route.request().headers()["range"]?.match(/bytes=(\d+)-(\d*)/);
  if (!range) return route.fulfill({ contentType: "video/mp4", headers: { "accept-ranges": "bytes" }, body });
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
  return route.fulfill({ status: 206, contentType: "video/mp4", headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((event) => { window.__CANOPY_MOCK__ = true; window.__CANOPY_EVENTS__ = [event]; }, note);
});

test("external HTTPS video decodes, fullscreen and all transport controls work", async ({ page, browserName }) => {
  const violations: string[] = [];
  await page.exposeFunction("recordVideoPolicyViolation", (value: string) => violations.push(value));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => {
    if (event.effectiveDirective === "media-src") void (window as unknown as { recordVideoPolicyViolation(value: string): void }).recordVideoPolicyViolation(event.blockedURI);
  }));
  await page.route(source, route => mediaResponse(route));
  const response = await page.goto(path);
  expect(response?.headers()["content-security-policy"]).toContain("media-src 'self' https:");
  const preview = page.getByRole("button", { name: "Play video attached to this note" });
  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Video player" });
  const video = dialog.locator("video");
  await expect.poll(() => video.evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(0.2);
  expect(await video.evaluate(v => v.videoWidth)).toBe(160);
  await expect(dialog.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  if (browserName === "chromium") {
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await dialog.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  }
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await video.evaluate(v => v.paused)).toBe(true);
  await dialog.getByRole("slider", { name: "Seek video" }).fill("5");
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(5, 0);
  await expect(dialog.getByLabel("Playback time")).toContainText("0:05 / 0:12");
  await dialog.getByRole("slider", { name: "Volume", exact: true }).fill("0.35");
  expect(await video.evaluate(v => v.volume)).toBeCloseTo(0.35);
  await dialog.getByRole("button", { name: "Mute", exact: true }).click();
  expect(await video.evaluate(v => v.muted)).toBe(true);
  await dialog.getByRole("button", { name: "Unmute", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Playback speed" }).selectOption("1.5");
  expect(await video.evaluate(v => v.playbackRate)).toBe(1.5);
  const controls = dialog;
  await controls.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(10, 0);
  await page.keyboard.press("m");
  expect(await video.evaluate(v => v.muted)).toBe(true);
  await page.keyboard.press("k");
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(false);
  await dialog.getByRole("button", { name: "Close media viewer" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(preview).toBeFocused();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(violations).toEqual([]);
});

test("fullscreen refusal preserves playback and keyboard/touch fallback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new DOMException("Refused", "NotAllowedError")); });
  await page.route(source, route => mediaResponse(route));
  await page.goto(path);
  await page.getByRole("button", { name: "Play video attached to this note" }).click();
  const dialog = page.getByRole("dialog", { name: "Video player" });
  await expect(dialog.getByRole("status", { name: "Video status" })).toContainText("Fullscreen was refused");
  await expect.poll(() => dialog.locator("video").evaluate(v => v.currentTime)).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close media viewer" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "Open original" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect(await dialog.evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("unsupported bytes show actionable error, original link and successful retry", async ({ page }) => {
  await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error("Denied")); });
  let valid = false;
  await page.route(source, route => mediaResponse(route, valid ? fixture : Buffer.from("unsupported bytes")));
  await page.goto(path);
  await page.getByRole("button", { name: "Play video attached to this note" }).click();
  const dialog = page.getByRole("dialog", { name: "Video player" });
  await expect(dialog.getByRole("status", { name: "Video status" })).toContainText(/unsupported/);
  await expect(dialog.getByRole("link", { name: "Open original" })).toHaveAttribute("href", source);
  await expect(dialog.getByRole("slider", { name: "Seek video" })).toBeDisabled();
  valid = true;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => dialog.locator("video").evaluate(v => v.currentTime)).toBeGreaterThan(0);
  await expect(dialog.getByRole("status", { name: "Video status" })).not.toContainText("unsupported");
});

test.describe("touch playback", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("missing fullscreen and denied initial playback offer a working touch retry", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Element.prototype, "requestFullscreen", { value: undefined, configurable: true });
      Object.defineProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen", { value: undefined, configurable: true });
      const play = HTMLMediaElement.prototype.play;
      let first = true;
      HTMLMediaElement.prototype.play = function () {
        if (first) { first = false; return Promise.reject(new DOMException("Permission denied", "NotAllowedError")); }
        return play.call(this);
      };
    });
    await page.route(source, route => mediaResponse(route));
    await page.goto(path);
    await page.getByRole("button", { name: "Play video attached to this note" }).tap();
    const dialog = page.getByRole("dialog", { name: "Video player" });
    await expect(dialog.getByRole("status", { name: "Video status" })).toContainText("Playback was blocked");
    await expect(dialog.getByRole("status", { name: "Video status" })).toContainText("Fullscreen is unavailable");
    await dialog.getByRole("button", { name: "Play", exact: true }).tap();
    await expect.poll(() => dialog.locator("video").evaluate(v => v.currentTime)).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Pause", exact: true }).tap();
    expect(await dialog.locator("video").evaluate(v => v.paused)).toBe(true);
    await dialog.getByRole("button", { name: "Mute", exact: true }).tap();
    expect(await dialog.locator("video").evaluate(v => v.muted)).toBe(true);
    await dialog.getByRole("button", { name: "Close media viewer" }).tap();
    await expect(dialog).toHaveCount(0);
  });
});
