import { expect, test, type Page } from "@playwright/test";
import { nip19, nip44, verifyEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";
import { createHash } from "node:crypto";
import { CANOPY_APP_NPUB, SETTINGS_COLLECTION } from "../src/lib/settings-sync";

type Row = Record<string, unknown>;
const ownerKey = generateSecretKey();
const owner = getPublicKey(ownerKey);
const secondKey = generateSecretKey();
const second = getPublicKey(secondKey);
const uri = `nostr+walletconnect://${"44".repeat(32)}?relay=wss%3A%2F%2Fwallet.example&secret=${"55".repeat(32)}`;
const destination = { serverUrl: "https://tower.example", workspaceId: "11111111-2222-4333-8444-555555555555", workspaceName: "Personal", workspaceOwnerNpub: nip19.npubEncode(owner), workspaceServiceNpub: nip19.npubEncode("22".repeat(32)) };
const descriptor = { id: "workspace-alias", name: "Personal", directHttpsUrl: destination.serverUrl, workspaceId: destination.workspaceId, workspaceOwnerNpub: destination.workspaceOwnerNpub, workspaceServiceNpub: destination.workspaceServiceNpub };
class Remote {
  rows: Row[] = [];
  requests: { method: string; body: string }[] = [];
  deny = false;
  missingNamespace = false;
  tamper = false;
  writes = 0;
}
async function setup(page: Page, remote: Remote, options: { bridge?: boolean; selected?: boolean; late?: number; crypto?: boolean; pubkey?: string } = {}) {
  await page.exposeFunction("testSign", (pubkey: string, event: EventTemplate) => finalizeEvent(event, pubkey === second ? secondKey : ownerKey));
  await page.exposeFunction("testEncrypt", (pubkey: string, plaintext: string) => nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(pubkey === second ? secondKey : ownerKey, pubkey)));
  await page.exposeFunction("testDecrypt", (pubkey: string, ciphertext: string) => nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(pubkey === second ? secondKey : ownerKey, pubkey)));
  await page.route("https://tower.example/**", async (route) => {
    const request = route.request();
    const signed = JSON.parse(Buffer.from(request.headers().authorization.replace(/^Nostr /, ""), "base64").toString());
    expect(verifyEvent(signed)).toBe(true);
    expect(signed.tags).toContainEqual(["u", request.url()]);
    expect(signed.tags).toContainEqual(["method", request.method()]);
    const body = request.postData() ?? "";
    if (body) expect(signed.tags).toContainEqual(["payload", createHash("sha256").update(body).digest("hex")]);
    expect(body).not.toContain("nostr+walletconnect:");
    expect(body).not.toContain("55".repeat(32));
    remote.requests.push({ method: request.method(), body });
    if (remote.deny) return route.fulfill({ status: 403, json: { code: "permission_denied", error: "denied" } });
    if (request.method() === "POST" && request.url().endsWith("/apps")) { remote.missingNamespace = false; return route.fulfill({ json: { enabled: true } }); }
    if (remote.missingNamespace) return route.fulfill({ status: 404, json: { code: "app_not_found", error: "not registered" } });
    const binding = { workspace_id: destination.workspaceId, workspace_owner_npub: remote.tamper ? "wrong" : destination.workspaceOwnerNpub, app_npub: CANOPY_APP_NPUB, collection: SETTINGS_COLLECTION };
    if (request.method() === "GET") {
      const url = new URL(request.url());
      expect(url.searchParams.get("owner_npub")).toBe(nip19.npubEncode(signed.pubkey));
      const offset = Number(url.searchParams.get("offset"));
      return route.fulfill({ json: { ...binding, rows: remote.rows.filter((row) => row.owner_npub === nip19.npubEncode(signed.pubkey)).slice(offset, offset + 50) } });
    }
    expect(request.method()).toBe("POST"); // Never blindly PATCH a current pointer.
    const input = JSON.parse(body);
    const row = { ...input, owner_npub: nip19.npubEncode(signed.pubkey), workspace_owner_npub: destination.workspaceOwnerNpub, app_npub: CANOPY_APP_NPUB, collection: SETTINGS_COLLECTION };
    remote.rows.unshift(row); remote.writes++;
    await route.fulfill({ status: 201, json: { ...binding, row } });
  });
  await page.addInitScript(({ owner, destination, descriptor, options }) => {
    const browser = window as unknown as Window & {
      testSign(pubkey: string, event: EventTemplate): Promise<ReturnType<typeof finalizeEvent>>;
      testEncrypt(pubkey: string, text: string): Promise<string>;
      testDecrypt(pubkey: string, text: string): Promise<string>;
      account: string; denyEncrypt?: boolean; denyDecrypt?: boolean;
      installBridge(): void; revokeBridge(): void; encryptionGate?: Promise<void>; releaseEncryption?(): void;
    };
    browser.account = options.pubkey ?? owner;
    window.__CANOPY_MOCK__ = true;
    window.__CANOPY_EVENTS__ = [];
    localStorage.setItem("canopy.rememberLogin", "1");
    if (options.selected !== false && !sessionStorage.getItem("seeded")) {
      localStorage.setItem(`canopy.networkSettings.${browser.account}`, JSON.stringify({ nstack: destination }));
      sessionStorage.setItem("seeded", "1");
    }
    window.nostr = {
      getPublicKey: async () => browser.account,
      getRelays: async () => ({}),
      signEvent: (event) => browser.testSign(browser.account, event),
      ...(options.crypto === false ? {} : { nip44: {
        encrypt: async (pubkey: string, text: string) => { if (browser.denyEncrypt) throw new Error("denied"); await browser.encryptionGate; return browser.testEncrypt(pubkey, text); },
        decrypt: async (pubkey: string, text: string) => { if (browser.denyDecrypt || sessionStorage.getItem("denyDecrypt")) throw new Error("denied"); return browser.testDecrypt(pubkey, text); },
      } }),
    };
    browser.installBridge = () => {
      let listener: (() => void) | undefined;
      window.NStack = {
        isAvailable: async () => ({ available: true, version: 1 }),
        requestDiscovery: async () => ({}),
        listNStacks: async () => [{ id: "stack-alias", name: "Personal NStack" }],
        listWorkspaces: async () => [descriptor],
        getConnection: async () => descriptor,
        on: (_event, handler) => { listener = handler; return () => { listener = undefined; }; },
      };
      browser.revokeBridge = () => listener?.();
      window.dispatchEvent(new Event("nstackready"));
    };
    if (options.bridge !== false) {
      if (options.late) setTimeout(browser.installBridge, options.late);
      else browser.installBridge();
    }
  }, { owner, destination, descriptor, options });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Open account options/ })).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: /^Settings(?: →)?$/ }).click();
}
const backup = (page: Page) => page.getByRole("button", { name: /^Settings backup:/ });
async function controls(page: Page) {
  if (!await page.getByRole("dialog", { name: "Settings backup", exact: true }).isVisible()) await backup(page).click();
}
async function retry(page: Page) {
  await controls(page);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings backup", exact: true }).click();
}
async function sync(page: Page) {
  await retry(page);
  await expect(backup(page)).toHaveAttribute("title", /Settings\ backed\ up/);
}
async function saveWallet(page: Page) {
  await settings(page);
  await page.getByLabel("NWC connection URI").fill(uri);
  await page.getByLabel("Default zap amount").fill("34");
  await page.getByLabel("Default zap message").fill("Thank you 🌿");
  await page.getByLabel("Read relays").fill("wss://custom.read");
  await page.getByLabel("Write relays").fill("wss://custom.write");
  await page.getByLabel("Blossom upload servers").fill("https://blossom.example");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
}

test("general Save settings persists NWC and zap edits across reload without a bridge", async ({ page }) => {
  await setup(page, new Remote(), { bridge: false, selected: false });
  await saveWallet(page);
  await page.reload();
  await settings(page);
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Default zap amount")).toHaveValue("34");
  await expect(page.getByLabel("Read relays")).toHaveValue("wss://custom.read");
  await expect(backup(page)).toHaveAttribute("title", /local\ and\ unsynced/);
});

test("NIP-44 encrypted backup restores on a fresh device, merges edits, and preserves removal against a stale writer", async ({ page, browser }) => {
  const remote = new Remote();
  await setup(page, remote);
  await saveWallet(page);
  await expect(backup(page)).toHaveAttribute("title", /Settings\ backed\ up/);
  expect(remote.writes).toBeGreaterThan(0);
  const ciphertext = (remote.rows[0].data as { ciphertext: string }).ciphertext;
  const plaintext = nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(ownerKey, owner));
  expect(JSON.parse(plaintext).fields.nwc.value).toBe(uri);
  expect(JSON.stringify(remote.rows)).not.toContain(uri);
  const staleLocal = await page.evaluate((owner) => localStorage.getItem(`canopy.settings.v1.${owner}`), owner);

  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await setup(fresh, remote);
  await expect(backup(fresh)).toHaveAttribute("title", /Settings\ backed\ up/);
  await settings(fresh);
  await expect(fresh.getByText("Wallet connected", { exact: true })).toBeVisible();
  await expect(fresh.getByLabel("Default zap amount")).toHaveValue("34");
  await expect(fresh.getByLabel("Default zap message")).toHaveValue("Thank you 🌿");
  await expect(fresh.getByLabel("Blossom upload servers")).toHaveValue("https://blossom.example");
  await fresh.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(fresh.getByLabel("NWC connection URI")).toBeVisible();
  await fresh.getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(backup(fresh)).toHaveAttribute("title", /Settings\ backed\ up/);

  // Force the first device back to its pre-removal cache; a new unrelated edit must not resurrect NWC.
  await page.evaluate(({ owner, staleLocal }) => localStorage.setItem(`canopy.settings.v1.${owner}`, staleLocal!), { owner, staleLocal });
  await settings(page);
  await page.getByLabel("Default zap message").fill("concurrent edit");
  await page.getByRole("button", { name: "Save zap defaults", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(backup(page)).toHaveAttribute("title", /Settings\ backed\ up/);
  await settings(page);
  await expect(page.getByLabel("NWC connection URI")).toBeVisible();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await sync(fresh);
  await settings(fresh);
  await expect(fresh.getByLabel("Default zap message")).toHaveValue("concurrent edit");
  await expect(fresh.getByLabel("NWC connection URI")).toBeVisible();
  await freshContext.close();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await setup(other, remote, { pubkey: second });
  await expect(backup(other)).toHaveAttribute("title", /NStack\ connected/);
  await settings(other);
  await expect(other.getByLabel("NWC connection URI")).toBeVisible();
  await expect(other.getByLabel("Default zap amount")).toHaveValue("21");
  await otherContext.close();
});

test("late bridge offers a persistent connect prompt; consented import restores settings", async ({ page }) => {
  const remote = new Remote();
  await setup(page, remote, { bridge: false, selected: false });
  await expect(backup(page)).toHaveAttribute("title", /bridge\ unavailable/);
  await page.evaluate(() => (window as unknown as { installBridge(): void }).installBridge());
  await controls(page);
  await expect(page.getByRole("button", { name: "Connect your NStack", exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Connect your NStack", exact: true }).click();
  await page.getByRole("button", { name: "Discover my NStacks" }).click();
  await page.getByRole("button", { name: /Personal NStack/ }).click();
  await page.getByRole("button", { name: "Personal ○", exact: true }).click();
  await page.getByRole("button", { name: "Import connection" }).click();
  await page.getByRole("button", { name: "Close Connect an NStack" }).click();
  await expect(backup(page)).toHaveAttribute("title", /NStack\ connected/);
  expect(remote.writes).toBe(0); // First-device defaults are never uploaded.
});

test("denied crypto/storage, missing namespace, and malformed responses keep local wallet safe and stop repeated prompts", async ({ page }) => {
  const remote = new Remote();
  await setup(page, remote);
  await page.evaluate(() => { (window as unknown as { denyEncrypt: boolean }).denyEncrypt = true; });
  await saveWallet(page);
  await expect(backup(page)).toHaveAttribute("title", /encryption\ was\ not\ approved/);
  expect(remote.writes).toBe(0);
  const requestCount = remote.requests.length;
  await page.waitForTimeout(1200);
  expect(remote.requests).toHaveLength(requestCount);
  await page.evaluate(() => { (window as unknown as { denyEncrypt: boolean }).denyEncrypt = false; });
  remote.deny = true;
  await retry(page);
  await expect(backup(page)).toHaveAttribute("title", /did\ not\ approve/);
  remote.deny = false; remote.missingNamespace = true;
  await retry(page);
  await controls(page);
  await expect(page.getByRole("button", { name: "Enable Canopy backup" })).toBeVisible();
  await page.getByRole("button", { name: "Enable Canopy backup" }).click();
  await page.getByRole("button", { name: "Close Settings backup", exact: true }).click();
  await expect(backup(page)).toHaveAttribute("title", /Settings\ backed\ up/);
  remote.tamper = true;
  await retry(page);
  await expect(backup(page)).toHaveAttribute("title", /could\ not\ be\ verified/);
  remote.tamper = false;
  await page.evaluate(() => sessionStorage.setItem("denyDecrypt", "1"));
  await page.reload();
  await retry(page);
  await expect(backup(page)).toHaveAttribute("title", /could\ not\ be\ verified/);
  await retry(page);
  await expect(backup(page)).toHaveAttribute("title", /could\ not\ be\ verified/);
  await settings(page);
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
});

test("missing NIP-44 and blocked local persistence never claim a successful backup/save", async ({ page }) => {
  const remote = new Remote();
  await setup(page, remote, { crypto: false });
  await saveWallet(page);
  await expect(backup(page)).toHaveAttribute("title", /must\ support\ NIP\-44/);
  expect(remote.writes).toBe(0);
  if (await page.getByRole("button", { name: "Close Settings backup", exact: true }).isVisible()) await page.getByRole("button", { name: "Close Settings backup", exact: true }).click();
  await settings(page);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); }; });
  await page.getByLabel("NWC connection URI").fill(uri);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByText("Storage unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Wallet connected", { exact: true })).toHaveCount(0);
});

test("account change during encryption cancels upload and isolates the next identity; revocation invalidates destination", async ({ page }) => {
  const remote = new Remote();
  await setup(page, remote);
  await page.evaluate(() => {
    const browser = window as unknown as { encryptionGate: Promise<void>; releaseEncryption(): void };
    browser.encryptionGate = new Promise((resolve) => { browser.releaseEncryption = resolve; });
  });
  await saveWallet(page);
  await expect(backup(page)).toHaveAttribute("title", /Syncing\ encrypted\ settings/);
  await page.evaluate((second) => {
    const browser = window as unknown as { account: string; releaseEncryption(): void };
    browser.account = second; browser.releaseEncryption();
  }, second);
  // A verified account switch revokes the old session; reconnect explicitly.
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("button", { name: /Open account options/ })).toBeVisible();
  await controls(page);
  await expect(page.getByRole("button", { name: "Connect your NStack", exact: true })).toBeVisible();
  expect(remote.writes).toBe(0);
  if (await page.getByRole("button", { name: "Close Settings backup", exact: true }).isVisible()) await page.getByRole("button", { name: "Close Settings backup", exact: true }).click();
  await settings(page);
  await expect(page.getByLabel("NWC connection URI")).toBeVisible();
  await expect(page.getByLabel("Default zap amount")).toHaveValue("21");
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await page.evaluate(() => { (window as unknown as { revokeBridge(): void }).revokeBridge(); });
  await expect(backup(page)).toHaveAttribute("title", /Connect\ your\ NStack/);
  expect(await page.evaluate((second) => localStorage.getItem(`canopy.networkSettings.${second}`), second)).toBeNull();
});

test("an edit made during encryption stays pending and reaches the next snapshot", async ({ page }) => {
  const remote = new Remote();
  await setup(page, remote);
  await page.evaluate(() => {
    const browser = window as unknown as { encryptionGate: Promise<void>; releaseEncryption(): void };
    browser.encryptionGate = new Promise((resolve) => { browser.releaseEncryption = resolve; });
  });
  await saveWallet(page);
  await expect(backup(page)).toHaveAttribute("title", /Syncing\ encrypted\ settings/);
  await settings(page);
  await page.getByLabel("Default zap amount").fill("89");
  await page.getByRole("button", { name: "Save zap defaults", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseEncryption(): void }).releaseEncryption());
  await expect(backup(page)).toHaveAttribute("title", /Settings\ backed\ up/);
  expect(remote.writes).toBe(2);
  const latest = nip44.v2.decrypt((remote.rows[0].data as { ciphertext: string }).ciphertext, nip44.v2.utils.getConversationKey(ownerKey, owner));
  expect(JSON.parse(latest).fields.zap.value.amount).toBe(89);
  await page.reload();
  await settings(page);
  await expect(page.getByLabel("Default zap amount")).toHaveValue("89");
});

test("a queuing bridge times out safely and resumes when readiness resolves without another injection event", async ({ page }) => {
  await setup(page, new Remote(), { bridge: false, selected: false });
  await expect(backup(page)).toHaveAttribute("title", /bridge\ unavailable/);
  await page.evaluate(() => {
    const browser = window as unknown as { installBridge(): void; releaseReady(): void };
    browser.installBridge();
    window.NStack!.ready = new Promise((resolve) => { browser.releaseReady = () => resolve(undefined); });
    window.dispatchEvent(new Event("nstackready"));
  });
  await expect(backup(page)).toHaveAttribute("title", /bridge\ is\ not\ ready/, { timeout: 6000 });
  await page.evaluate(() => (window as unknown as { releaseReady(): void }).releaseReady());
  await controls(page);
  await expect(page.getByRole("button", { name: "Connect your NStack", exact: true })).toBeVisible();
});


test("checkpoint survives reload, skips remote polls before 24h and syncs when due; icon stays beside relays", async ({ page }) => {
  const remote = new Remote();
  await page.clock.install();
  await setup(page, remote);
  await saveWallet(page);
  await expect(backup(page)).toHaveAttribute("title", /Settings backed up/);
  const count = remote.requests.length;
  await page.reload();
  await expect(backup(page)).toHaveAttribute("title", /Settings backed up/);
  await page.clock.fastForward(61_000);
  expect(remote.requests).toHaveLength(count);
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toHaveCount(0);
  await expect(page.locator(".settings-sync")).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const relay = await page.locator(".network-pill").boundingBox();
    const icon = await backup(page).boundingBox();
    expect(icon!.x).toBeGreaterThan(relay!.x + relay!.width);
    expect(Math.abs(icon!.y - relay!.y)).toBeLessThan(12);
    expect(icon!.x + icon!.width).toBeLessThan(width);
    await page.screenshot({ path: `tmp/docs/handoffs/refine-header-${width}.png` });
  }
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect.poll(() => remote.requests.length).toBeGreaterThan(count);
  await expect(backup(page)).toHaveAttribute("title", /Settings backed up/);
  const beforeSameSave = remote.requests.length;
  await settings(page);
  await page.getByRole("button", { name: "Save zap defaults", exact: true }).click();
  await page.clock.fastForward(1000);
  expect(remote.requests).toHaveLength(beforeSameSave);
});
