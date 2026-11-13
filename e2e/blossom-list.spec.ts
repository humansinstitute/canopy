import { expect, test } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";

for (const mode of ["accept", "reject", "cancel", "stale", "incomplete"] as const) {
  test(`published Blossom list: ${mode}`, async ({ page }) => {
    const secret = generateSecretKey(), pubkey = getPublicKey(secret);
    let latest = finalizeEvent({ kind: 10063, created_at: Math.floor(Date.now() / 1000) - 30, content: "", tags: [["server", "https://one.example/path", "retain"], ["server", "https://two.example"], ["custom", "keep"]] }, secret);
    const sent: Array<ReturnType<typeof finalizeEvent>> = [];
    let signs = 0;
    await page.exposeFunction("signBlossomFixture", (template: EventTemplate) => {
      signs++;
      if (mode === "cancel") throw new Error("Signer cancelled by user");
      return finalizeEvent(template, secret);
    });
    await page.addInitScript(({ pubkey }) => {
      localStorage.clear();
      window.nostr = { getPublicKey: async () => pubkey, signEvent: (template) => (window as unknown as { signBlossomFixture(t: unknown): Promise<never> }).signBlossomFixture(template) };
    }, { pubkey });
    await page.routeWebSocket(/wss?:\/\/.*/, (socket) => {
      socket.onMessage((raw) => {
        const a = JSON.parse(String(raw));
        if (a[0] === "REQ") {
          const isList = a.slice(2).some((f: { kinds?: number[] }) => f.kinds?.includes(10063));
          if (isList) socket.send(JSON.stringify(["EVENT", a[1], latest]));
          if (!(mode === "incomplete" && isList && socket.url().includes("damus"))) socket.send(JSON.stringify(["EOSE", a[1]]));
        }
        if (a[0] === "EVENT") {
          sent.push(a[1]);
          socket.send(JSON.stringify(["OK", a[1].id, mode !== "reject", mode === "reject" ? "blocked: controlled rejection" : "stored"]));
          if (mode !== "reject") latest = a[1];
        }
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Nostr" }).click();
    await page.getByRole("button", { name: /Open account options/ }).click();
    await page.getByRole("button", { name: /^Settings(?: →)?$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    // Local settings remain independent of publication.
    const local = dialog.getByRole("textbox", { name: "Blossom upload servers", exact: true });
    await local.fill("https://local.example");
    await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Load published list" }).click();
    if (mode === "incomplete") {
      await expect(dialog.getByRole("alert")).toContainText("did not finish", { timeout: 10_000 });
      await expect(dialog.getByRole("button", { name: "Publish profile list" })).toHaveCount(0);
      expect(signs).toBe(0); return;
    }
    await expect(dialog.getByLabel("Profile server 1")).toHaveValue("https://one.example/path");
    await dialog.getByRole("button", { name: "Move server 2 up" }).click();
    await expect(dialog.getByLabel("Profile server 1")).toHaveValue("https://two.example");
    await dialog.getByRole("button", { name: "Publish profile list", exact: true }).click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(signs).toBe(0);
    if (mode === "stale") latest = finalizeEvent({ ...latest, created_at: latest.created_at + 1, tags: [["server", "https://new.example"], ["custom", "keep"]] }, secret);
    await dialog.getByRole("button", { name: "Publish profile list", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm publish", exact: true }).click();
    if (mode === "accept") {
      await page.screenshot({ path: test.info().outputPath("blossom-profile-list.png"), fullPage: true });
      await expect(dialog.getByRole("status").filter({ hasText: "Published list:" })).toBeVisible();
      expect(sent.length).toBe(3);
      expect(sent[0]!.kind).toBe(10063);
      expect(sent[0]!.content).toBe("");
      expect(sent[0]!.tags).toEqual([["server", "https://two.example"], ["server", "https://one.example/path", "retain"], ["custom", "keep"]]);
    } else {
      const expected = mode === "reject" ? "No relay confirmed" : mode === "cancel" ? "Signer cancelled" : "newer Blossom list";
      await expect(dialog.getByRole("alert")).toContainText(expected);
      expect(sent.length).toBe(mode === "reject" ? 3 : 0);
    }
    expect(signs).toBe(mode === "stale" ? 0 : 1);
    await expect(local).toHaveValue("https://local.example");
    await expect(dialog.getByLabel("Profile server 1")).toHaveValue("https://two.example");
    const stored = await page.evaluate((pubkey) => localStorage.getItem(`canopy.networkSettings.${pubkey}`), pubkey);
    // New settings-state is canonical; publication must not rewrite the local textarea.
    expect(stored === null || stored.includes("local.example")).toBe(true);
  });
}
