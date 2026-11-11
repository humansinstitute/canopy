import { expect, test } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const now = Math.floor(Date.now() / 1000);
const note = finalizeEvent({ kind: 1, created_at: now, tags: [], content: "Public garden note" }, secret);
const metadata = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ name: "Public Gardener" }) }, secret);
const profilePath = `/profile/${nip19.npubEncode(pubkey)}`;
const eventPath = `/event/${nip19.neventEncode({ id: note.id, author: pubkey, kind: 1 })}`;
const petePath = "/event/nevent1qvzqqqqqqypzqwau4dlr62c854gzwgrdtcvnsylszsrgstd26p2pywy62zm8h2fwqqs9t9ngv4ll5urt44z6x3d7x9uxjfpyp0x42qxssqqqvl5fdt6yufq027s6g";

for (const path of [profilePath, eventPath]) {
  test(`guest opens and reloads ${path.startsWith("/profile") ? "profile" : "event"}, then logs in from avatar`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ events, pubkey }) => {
      window.__CANOPY_MOCK__ = true;
      window.__CANOPY_EVENTS__ = events;
      (window as unknown as { signerCalls: number }).signerCalls = 0;
      window.nostr = {
        getPublicKey: async () => { (window as unknown as { signerCalls: number }).signerCalls++; return pubkey; },
        signEvent: async () => { throw new Error("Unexpected signing"); },
      };
      localStorage.removeItem("canopy.rememberLogin");
    }, { events: [metadata, note], pubkey });
    await page.goto(path);
    await expect(page.getByText("Public garden note", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Like note" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Public garden note", { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate(() => (window as unknown as { signerCalls: number }).signerCalls)).toBe(0);
    await page.getByRole("button", { name: "Open account options", exact: true }).click();
    await page.getByRole("button", { name: "Continue with Nostr" }).click();
    await expect(page.getByRole("button", { name: "Like note" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    expect(errors).toEqual([]);
  });
}

test("guest traverses event author profile and browser history without signer", async ({ page }) => {
  await page.addInitScript((events) => { window.__CANOPY_MOCK__ = true; window.__CANOPY_EVENTS__ = events; }, [metadata, note]);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "View Public Gardener's profile" }).click();
  await expect(page.getByRole("heading", { name: "Public Gardener", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await page.getByRole("button", { name: "Log in to interact" }).click();
  await expect(page.getByRole("dialog", { name: "Log in to Canopy" })).toBeVisible();
  await expect(page.getByText(/No signer found/)).toBeVisible();
});

test("guest sees missing-event and malformed-link states including Pete's URL", async ({ page }) => {
  await page.addInitScript(() => { window.__CANOPY_MOCK__ = true; window.__CANOPY_EVENTS__ = []; });
  await page.goto(petePath);
  await expect(page.getByRole("heading", { name: "Note not found" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(petePath);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Note not found" })).toBeVisible();
  await page.goto("/profile/npub-broken");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("denied avatar login keeps the public event visible and allows retry", async ({ page }) => {
  await page.addInitScript((events) => {
    window.__CANOPY_MOCK__ = true;
    window.__CANOPY_EVENTS__ = events;
    window.nostr = {
      getPublicKey: async () => { throw new Error("Signer access denied"); },
      signEvent: async () => { throw new Error("Unexpected signing"); },
    };
  }, [metadata, note]);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "Open account options", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("alert")).toHaveText("Signer access denied");
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeEnabled();
  await page.getByRole("button", { name: "Close Log in to Canopy" }).click();
  await expect(page.getByText("Public garden note", { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(eventPath);
});
