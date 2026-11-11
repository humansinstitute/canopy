import { expect, test } from "@playwright/test";

// All signer behavior in this suite is simulated; no real signing or relay IO.
for (const delay of [0, 1600]) {
  test(`remembered session restores with ${delay}ms signer injection and one permission request`, async ({ page }) => {
    await page.addInitScript(({ delay }) => {
      window.__CANOPY_MOCK__ = true;
      localStorage.setItem("canopy.rememberLogin", "1");
      const state = window as unknown as { calls: number };
      state.calls = 0;
      setTimeout(() => { window.nostr = {
        getPublicKey: async () => { state.calls++; await new Promise((resolve) => setTimeout(resolve, 700)); return "a".repeat(64); },
        signEvent: async () => { throw Error("Unexpected signing"); },
      }; }, delay);
    }, { delay });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open account options for", exact: false })).toBeVisible();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(1);
  });
}

test("late, partially initialized signer offers login without prompting a guest", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    localStorage.removeItem("canopy.rememberLogin");
    (window as unknown as { calls: number }).calls = 0;
  });
  await page.goto("/");
  await expect(page.getByText("No signer found", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.nostr = {
    getPublicKey: async () => { (window as unknown as { calls: number }).calls++; return "a".repeat(64); },
  } as never; });
  await page.waitForTimeout(500);
  await expect(page.getByText("No signer found", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.nostr!.signEvent = async () => { throw Error("Unexpected signing"); }; });
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(0);
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("button", { name: /Open account options for/ })).toBeVisible();
});

test("rejected restoration stays retryable without repeated automatic permission prompts", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    localStorage.setItem("canopy.rememberLogin", "1");
    const state = window as unknown as { calls: number };
    state.calls = 0;
    window.nostr = {
      getPublicKey: async () => { if (++state.calls === 1) throw Error("Signer locked or denied"); return "a".repeat(64); },
      signEvent: async () => { throw Error("Unexpected signing"); },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText("Signer locked or denied");
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(1);
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("button", { name: /Open account options for/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(2);
});

test("replacing a bridge during login ignores the stale account result", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    localStorage.setItem("canopy.rememberLogin", "1");
    const state = window as unknown as { releaseOld(): void; calls: number };
    state.calls = 0;
    window.nostr = {
      getPublicKey: () => { state.calls++; return new Promise<string>((resolve) => { state.releaseOld = () => resolve("a".repeat(64)); }); },
      signEvent: async () => { throw Error("Unexpected signing"); },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Waiting for signer…" })).toBeDisabled();
  await page.evaluate(() => { window.nostr = {
    getPublicKey: async () => "b".repeat(64),
    signEvent: async () => { throw Error("Unexpected signing"); },
  }; });
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { releaseOld(): void }).releaseOld());
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: /Open account options for/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("button", { name: /Open account options for/ })).toBeVisible();
});

test("explicit sign out prevents automatic reconnect after reinjection and reload", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    window.nostr = {
      getPublicKey: async () => "a".repeat(64),
      signEvent: async () => { throw Error("Unexpected signing"); },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await page.getByRole("button", { name: /Open account options for/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("canopy.rememberLogin"))).toBeNull();
  await page.evaluate(() => { delete window.nostr; });
  await expect(page.getByText("No signer found", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.nostr = {
    getPublicKey: async () => { throw Error("Must not reconnect automatically"); },
    signEvent: async () => { throw Error("Unexpected signing"); },
  }; });
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeEnabled();
  await page.waitForTimeout(600);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Open account options for/ })).toHaveCount(0);
});

test("authenticated bridge churn and resume retain route, composer and draft", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    localStorage.setItem("canopy.rememberLogin", "1");
    window.nostr = { getPublicKey: async () => "a".repeat(64), signEvent: async () => { throw Error("Unexpected signing"); } };
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Share a note with Nostr…" });
  await draft.fill("Keep this draft through native bridge churn");
  const route = page.url();
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => { window.nostr = { getPublicKey: async () => "a".repeat(64), signEvent: async () => { throw Error("Unexpected signing"); } }; window.dispatchEvent(new Event("focus")); });
    await page.waitForTimeout(400);
    await expect(draft).toHaveText("Keep this draft through native bridge churn");
    await page.evaluate(() => { delete window.nostr; window.dispatchEvent(new Event("pageshow")); });
    // Exceeds SettingsSync's identity polling interval as well as discovery polling.
    await page.waitForTimeout(index === 0 ? 5500 : 400);
    await expect(draft).toHaveText("Keep this draft through native bridge churn");
    expect(page.url()).toBe(route);
    await page.evaluate(() => { window.nostr = { getPublicKey: async () => "a".repeat(64), signEvent: async () => { throw Error("Unexpected signing"); } }; window.dispatchEvent(new Event("focus")); });
  }
  await page.evaluate(() => { window.nostr = { getPublicKey: async () => { throw Error("Temporarily locked"); }, signEvent: async () => { throw Error("Unexpected signing"); } }; });
  await page.waitForTimeout(5500);
  await expect(draft).toHaveText("Keep this draft through native bridge churn");
});

test("different account cannot sign an old composer's post even before discovery", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    localStorage.setItem("canopy.rememberLogin", "1");
    const state = window as unknown as { identity: string; signCalls: number };
    state.identity = "a".repeat(64); state.signCalls = 0;
    window.nostr = { getPublicKey: async () => state.identity, signEvent: async () => { state.signCalls++; throw Error("Must never sign"); } };
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  await page.getByRole("textbox", { name: "Share a note with Nostr…" }).fill("Account A's draft");
  // Same bridge object now serves a different native identity, before the 5s poll.
  await page.evaluate(() => { (window as unknown as { identity: string }).identity = "b".repeat(64); });
  await page.getByRole("button", { name: "Post note", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "signer account changed" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { signCalls: number }).signCalls)).toBe(0);
  await expect(page.getByRole("button", { name: "Continue with Nostr" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("button", { name: /Open account options for/ })).toBeVisible();
});

test("bridge replacement cancels a pending signed result before publication", async ({ page }) => {
  await page.addInitScript(() => {
    window.__CANOPY_MOCK__ = true;
    localStorage.setItem("canopy.rememberLogin", "1");
    const state = window as unknown as { releaseSign(): void; signing: boolean };
    state.signing = false;
    window.nostr = {
      getPublicKey: async () => "a".repeat(64),
      signEvent: template => new Promise(resolve => { state.signing = true; state.releaseSign = () => resolve({ ...template, pubkey: "a".repeat(64), id: "c".repeat(64), sig: "d".repeat(128) }); }),
    };
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Share a note with Nostr…" });
  await draft.fill("Stale signed result must never publish");
  await page.getByRole("button", { name: "Post note", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { signing: boolean }).signing)).toBe(true);
  await page.evaluate(() => {
    window.nostr = { getPublicKey: async () => "a".repeat(64), signEvent: async () => { throw Error("Unexpected signing"); } };
    (window as unknown as { releaseSign(): void }).releaseSign();
  });
  await expect(page.getByRole("status").filter({ hasText: "account changed" })).toBeVisible();
  await expect(draft).toHaveText("Stale signed result must never publish");
  await expect(page.getByTestId("event-card").filter({ hasText: "Stale signed result must never publish" })).toHaveCount(0);
});
