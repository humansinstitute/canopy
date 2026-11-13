import { expect, test } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";

for (const mode of ["accept", "reject", "cancel", "stale", "partial-existing", "partial-absent", "offline", "after-sign"] as const) {
  test(`published Blossom list: ${mode}`, async ({ page }) => {
    test.setTimeout(45_000);
    const secret = generateSecretKey(), pubkey = getPublicKey(secret);
    let latest = finalizeEvent({ kind: 10063, created_at: Math.floor(Date.now() / 1000) - 30, content: "", tags: [["server", "https://one.example/path", "retain"], ["server", "https://two.example"], ["custom", "keep"]] }, secret);
    const sent: Array<ReturnType<typeof finalizeEvent>> = [];
    let signs = 0;
    const partial = mode.startsWith("partial");
    const empty = mode === "partial-absent";
    await page.exposeFunction("signBlossomFixture", (template: EventTemplate) => {
      signs++;
      if (mode === "cancel") throw new Error("Signer cancelled by user");
      if (mode === "after-sign") latest = finalizeEvent({ ...latest, created_at: latest.created_at + 1, tags: [["server", "https://new.example"]] }, secret);
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
          if (isList && socket.url().includes(".example") && (partial || mode === "offline") && (mode === "offline" || !socket.url().includes("healthy"))) {
            if (socket.url().includes("closed")) socket.send(JSON.stringify(["CLOSED", a[1], "blocked"]));
            else if (socket.url().includes("reject")) socket.close({ code: 1000, reason: "controlled unavailable relay" });
            return;
          }
          if (isList && !empty) socket.send(JSON.stringify(["EVENT", a[1], latest]));
          socket.send(JSON.stringify(["EOSE", a[1]]));
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
    if (partial || mode === "offline") {
      await dialog.getByRole("textbox", { name: "Read relays", exact: true }).fill("wss://healthy.example\nwss://timeout.example\nwss://closed.example\nwss://reject.example");
      await dialog.getByRole("textbox", { name: "Write relays", exact: true }).fill("wss://healthy.example");
    }
    await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Load published list" }).click();
    if (mode === "offline") {
      await expect(dialog.getByRole("alert")).toContainText("No relay completed", { timeout: 10_000 });
      await expect(dialog.getByRole("button", { name: "Publish profile list" })).toHaveCount(0);
      expect(signs).toBe(0); return;
    }
    if (partial) {
      await expect(dialog.getByRole("note")).toContainText("Only 1 of 4", { timeout: 10_000 });
      if (empty) {
        await expect(dialog.getByRole("note")).toContainText("No list found on responding relays");
        await dialog.getByRole("button", { name: "Copy local servers to draft" }).click();
        await expect(dialog.getByLabel("Profile server 1")).toHaveValue("https://local.example");
        await dialog.getByRole("button", { name: "Add profile server" }).click();
        await dialog.getByLabel("Profile server 2").fill("https://two.example");
      }
      await page.screenshot({ path: test.info().outputPath(`mixed-relay-${mode}.png`), fullPage: true });
    } else await expect(dialog.getByLabel("Profile server 1")).toHaveValue("https://one.example/path");
    await dialog.getByRole("button", { name: "Move server 2 up" }).click();
    await expect(dialog.getByLabel("Profile server 1")).toHaveValue("https://two.example");
    await dialog.getByRole("button", { name: "Publish profile list", exact: true }).click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(signs).toBe(0);
    if (mode === "stale") latest = finalizeEvent({ ...latest, created_at: latest.created_at + 1, tags: [["server", "https://new.example"], ["custom", "keep"]] }, secret);
    await dialog.getByRole("button", { name: "Publish profile list", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm publish", exact: true }).click();
    if (mode === "accept" || partial) {
      await page.screenshot({ path: test.info().outputPath("blossom-profile-list.png"), fullPage: true });
      await expect(dialog.getByRole("status").filter({ hasText: "Published list:" })).toBeVisible({ timeout: 20_000 });
      if (empty) await expect(dialog.getByRole("note")).not.toContainText("No list found");
      expect(sent.length).toBe(partial ? 1 : 3);
      expect(sent[0]!.kind).toBe(10063);
      expect(sent[0]!.content).toBe("");
      if (!empty) expect(sent[0]!.tags).toEqual([["server", "https://two.example"], ["server", "https://one.example/path", "retain"], ["custom", "keep"]]);
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
