import { expect, test } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";

// Exercise the served app and actual Applesauce/WebSocket path, with isolated
// relay protocol responses and an ephemeral signer (no public posts).
for (const mode of ["fast-hang", "reject-accept", "reject", "silent"] as const) {
  test(`composer relay acknowledgements: ${mode}`, async ({ page }) => {
    test.setTimeout(30_000);
    const secret = generateSecretKey();
    const pubkey = getPublicKey(secret);
    let signs = 0;
    const sent = new Map<string, string[]>();
    await page.exposeFunction("signTestNote", (template: EventTemplate) => { signs++; return finalizeEvent(template, secret); });
    await page.addInitScript(({ pubkey }) => {
      localStorage.clear();
      window.nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (template) => (window as unknown as { signTestNote(t: unknown): Promise<never> }).signTestNote(template),
      };
    }, { pubkey });
    await page.routeWebSocket(/wss?:\/\/.*/, (socket) => {
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message[0] === "REQ") { socket.send(JSON.stringify(["EOSE", message[1]])); return; }
        if (message[0] !== "EVENT") return;
        const event = message[1];
        sent.set(socket.url(), [...(sent.get(socket.url()) ?? []), event.id]);
        if (mode === "silent") return;
        const fast = socket.url().includes("damus");
        if (mode === "fast-hang" && !fast) return;
        const ok = mode === "fast-hang" || (mode === "reject-accept" && !fast);
        setTimeout(() => socket.send(JSON.stringify(["OK", event.id, ok, ok ? "saved" : "blocked: denied"])), mode === "reject-accept" && ok ? 500 : 0);
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Nostr" }).click();
    await page.getByRole("button", { name: "Create post" }).click();
    const dialog = page.getByRole("dialog", { name: "Create a post" });
    const editor = dialog.getByRole("textbox", { name: "Share a note with Nostr…" });
    await editor.fill(`relay scenario ${mode}`);
    const started = Date.now();
    await dialog.getByRole("button", { name: "Post note", exact: true }).click();
    if (mode === "fast-hang" || mode === "reject-accept") {
      await expect(dialog).toHaveCount(0, { timeout: 4_000 });
      expect(Date.now() - started).toBeLessThan(4_000);
    } else {
      await expect(dialog.getByText("No relay accepted the post. Your draft is still here.")).toBeVisible({ timeout: 15_000 });
      await expect(editor).toHaveText(`relay scenario ${mode}`);
      await expect(dialog.getByRole("button", { name: "Post note", exact: true })).toBeEnabled();
    }
    expect(signs).toBe(1);
    expect(sent.size).toBe(3);
    expect(new Set([...sent.values()].flat()).size).toBe(1);
    expect([...sent.values()].every((ids) => ids.length === 1)).toBe(true);
  });
}
