import { expect, test } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";

test("mocked window.nostr covers following feed, names, notification threads and posting", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  const relaySockets: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("websocket", (socket) => relaySockets.push(socket.url()));
  const ownerSecret = generateSecretKey();
  const ownerPubkey = getPublicKey(ownerSecret);
  const ownerNpub = nip19.npubEncode(ownerPubkey);
  const workspaceServiceNpub = nip19.npubEncode("22".repeat(32));
  const serviceNpub = nip19.npubEncode("33".repeat(32));
  const nwcWalletPubkey = "44".repeat(32);
  const nwcSecret = "55".repeat(32);
  const nwcUri = `nostr+walletconnect://${nwcWalletPubkey}?relay=${encodeURIComponent("wss://wallet.example")}&secret=${nwcSecret}`;
  const authorSecret = generateSecretKey();
  const authorPubkey = getPublicKey(authorSecret);
  const unrelatedSecret = generateSecretKey();
  const referenceSecret = generateSecretKey();
  const referencePubkey = getPublicKey(referenceSecret);
  const fallbackPubkey = getPublicKey(generateSecretKey());
  const now = Math.floor(Date.now() / 1000);
  const longPost = `A quiet corner of the web. ${"Long posts should be easy to scan without losing their complete text. ".repeat(10)}The full ending stays available. https://cdn.example/photo.jpg https://blossom.example/garden.mp4`;
  const root = finalizeEvent({ kind: 1, created_at: now - 90, tags: [], content: longPost }, authorSecret);
  const referenced = finalizeEvent({ kind: 1, created_at: now - 70, tags: [], content: "A compact referenced tutorial." }, referenceSecret);
  const profileReference = nip19.nprofileEncode({ pubkey: referencePubkey, relays: ["wss://reference.example"] });
  const eventReference = nip19.neventEncode({ id: referenced.id, author: referencePubkey, kind: 1, relays: ["wss://reference.example"] });
  const directReply = finalizeEvent({ kind: 1, created_at: now - 60, tags: [["e", root.id, "wss://relay.damus.io", "root"]], content: "A direct reply from the tutorial author." }, referenceSecret);
  const replyEvent = finalizeEvent({ kind: 1, created_at: now - 45, tags: [["p", ownerPubkey], ["e", root.id, "wss://relay.damus.io", "root"], ["e", directReply.id, "wss://nos.lol", "reply"]], content: `This client feels wonderfully fast. Ask nostr:${profileReference} about nostr:${eventReference}` }, authorSecret);
  const sideBranch: ReturnType<typeof finalizeEvent>[] = [];
  let sideParent = root.id;
  for (let index = 0; index < 10; index += 1) {
    const sideReply = finalizeEvent({
      kind: 1,
      created_at: now - 54 + index,
      tags: [["e", root.id, "wss://relay.damus.io", "root"], ...(sideParent === root.id ? [] : [["e", sideParent, "wss://nos.lol", "reply"]])],
      content: index === 0 ? "A busy side conversation." : `Side conversation reply ${index}.`,
    }, referenceSecret);
    sideBranch.push(sideReply);
    sideParent = sideReply.id;
  }
  const missingRootId = "9".repeat(64);
  const missingParentId = "8".repeat(64);
  const orphanReply = finalizeEvent({ kind: 1, created_at: now - 43, tags: [["e", missingRootId, "wss://relay.damus.io", "root"], ["e", missingParentId, "wss://nos.lol", "reply"]], content: "A saved reply whose parent is not available." }, referenceSecret);
  const bookmarkList = finalizeEvent({ kind: 10003, created_at: now - 44, tags: [["e", orphanReply.id, "wss://bookmark.hint"], ["a", `30023:${authorPubkey}:canopy-article`], ["x", "keep-me"]], content: "opaque-encrypted-bookmarks" }, ownerSecret);
  const highlight = finalizeEvent({ kind: 9802, created_at: now - 20, tags: [["e", root.id, "wss://source.hint"], ["context", "A longer passage around the selected sentence."], ["comment", "Boris-style network highlight"]], content: "A quiet corner of the web." }, authorSecret);
  const lookmark = finalizeEvent({ kind: 7, created_at: now - 19, tags: [["e", referenced.id, "wss://reference.example"]], content: "👀" }, authorSecret);
  const signedTemplates: EventTemplate[] = [];
  const zapRequests: Array<{ amount: string | undefined; content: string }> = [];
  const nstackCalls: Array<{ method: string; value?: unknown }> = [];
  const copiedValues: string[] = [];
  const events = [
    finalizeEvent({ kind: 3, created_at: now - 120, tags: [["p", authorPubkey, "wss://alice.example", "Alice"], ["p", fallbackPubkey], ["x", "keep-contact-extension"]], content: "opaque-contact-content" }, ownerSecret),
    finalizeEvent({ kind: 10002, created_at: now - 119, tags: [["r", "wss://profile.one"], ["r", "wss://profile.read", "read"], ["r", "wss://profile.write", "write"]], content: "" }, ownerSecret),
    finalizeEvent({ kind: 10063, created_at: now - 118, tags: [["server", "https://blossom.example"]], content: "" }, ownerSecret),
    finalizeEvent({ kind: 0, created_at: now - 110, tags: [], content: JSON.stringify({ display_name: "Alice Canopy", lud16: "alice@example.com" }) }, authorSecret),
    finalizeEvent({ kind: 0, created_at: now - 111, tags: [], content: JSON.stringify({ display_name: "Pete Previous", name: "pete", about: "Old bio", website: "https://old.example", lud06: "lnurl1keep", custom: { theme: "moss" } }) }, ownerSecret),
    finalizeEvent({ kind: 0, created_at: now - 109, tags: [], content: JSON.stringify({ display_name: "Tutorial Author" }) }, referenceSecret),
    root,
    directReply,
    ...sideBranch,
    referenced,
    replyEvent,
    orphanReply,
    bookmarkList,
    highlight,
    lookmark,
    finalizeEvent({ kind: 1, created_at: now - 30, tags: [], content: "Unrelated global note" }, unrelatedSecret),
  ];
  await page.exposeFunction("signCanopyEvent", (template: EventTemplate) => { signedTemplates.push(template); return finalizeEvent(template, ownerSecret); });
  await page.exposeFunction("recordNStackCall", (method: string, value?: unknown) => { nstackCalls.push({ method, value }); });
  await page.exposeFunction("recordClipboard", (value: string) => { copiedValues.push(value); });
  await page.addInitScript(({ pubkey, seeded, ownerNpub, workspaceServiceNpub, serviceNpub }) => {
    const browser = window as unknown as Window & { recordNStackCall(method: string, value?: unknown): Promise<void>; recordClipboard(value: string): Promise<void>; triggerNStackChange?(): void };
    let changeHandler: (() => void) | undefined;
    let discoveryApproved = false;
    window.__CANOPY_MOCK__ = true;
    window.__CANOPY_EVENTS__ = seeded;
    window.__CANOPY_MOCK_PUBLISH_DELAY__ = 500;
    window.__CANOPY_MOCK_CACHE_DELAY__ = 100;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (value: string) => browser.recordClipboard(value) } });
    window.nostr = {
      getPublicKey: async () => pubkey,
      getRelays: async () => ({ "wss://mock.relay": { read: true, write: true } }),
      signEvent: (template) => (window as unknown as { signCanopyEvent(t: EventTemplate): Promise<ReturnType<typeof finalizeEvent>> }).signCanopyEvent(template),
    };
    window.webln = {
      enable: async () => undefined,
      sendPayment: async () => ({ preimage: "mock-payment" }),
    };
    window.NStack = {
      version: 1,
      ready: Promise.resolve(),
      isAvailable: async () => ({ available: true, version: 1 }),
      requestDiscovery: async (options) => { discoveryApproved = true; await browser.recordNStackCall("requestDiscovery", options); return { approved: true }; },
      listNStacks: async () => { await browser.recordNStackCall("listNStacks"); return { stacks: discoveryApproved ? [
        { id: "personal", name: "Pete’s NStack", status: "online", credential: "not-for-canopy" },
        { id: "work", name: "Wingman Studio", status: "online" },
      ] : [] }; },
      listWorkspaces: async ({ stackId }) => { await browser.recordNStackCall("listWorkspaces", stackId); return { workspaces: stackId === "personal" ? [
        { id: "suite", name: "Wingman Suite", description: "Chat, tasks, documents and files", workspaceId: "real-suite", workspaceOwnerNpub: ownerNpub, workspaceServiceNpub, serviceNpub, directHttpsUrl: "https://tower.example" },
        { id: "private", name: "Personal", workspaceId: "real-private", workspaceOwnerNpub: ownerNpub, workspaceServiceNpub, directHttpsUrl: "https://tower.example" },
      ] : [{ id: "studio", name: "Studio", workspaceId: "real-studio", workspaceOwnerNpub: ownerNpub, workspaceServiceNpub, directHttpsUrl: "https://studio.example" }] }; },
      getConnection: async ({ stackId, workspaceId }) => { await browser.recordNStackCall("getConnection", { stackId, workspaceId }); return { id: workspaceId, name: "Wingman Suite", workspaceId: "real-suite", workspaceOwnerNpub: ownerNpub, workspaceServiceNpub, serviceNpub, directHttpsUrl: "https://tower.example" }; },
      on: (_event, handler) => { changeHandler = handler; return () => { changeHandler = undefined; }; },
    };
    browser.triggerNStackChange = () => changeHandler?.();
  }, { pubkey: ownerPubkey, seeded: events, ownerNpub, workspaceServiceNpub, serviceNpub });
  await page.route("https://cdn.example/photo.jpg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#456b53"/></svg>',
  }));
  await page.route("https://blossom.example/garden.mp4", (route) => route.fulfill({
    status: 200,
    contentType: "video/mp4",
    body: Buffer.from([]),
  }));
  await page.route("https://example.com/.well-known/lnurlp/alice", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ allowsNostr: true, nostrPubkey: authorPubkey, callback: "https://example.com/zap" }),
  }));
  await page.route(/https:\/\/example\.com\/zap.*/, (route) => {
    const request = new URL(route.request().url());
    const zapEvent = JSON.parse(request.searchParams.get("nostr") || "{}") as { content?: string };
    zapRequests.push({ amount: request.searchParams.get("amount") || undefined, content: zapEvent.content || "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pr: `lnbc${"a".repeat(80)}` }) });
  });
  await page.route("https://blossom.example/upload", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers().authorization).toMatch(/^Nostr /);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "https://blossom.example/mock-image.png", sha256: "a".repeat(64), size: 3, type: "image/png", uploaded: now }),
    });
  });
  await page.route(/https:\/\/commons\.wikimedia\.org\/w\/api\.php.*/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ query: { pages: [{ title: "File:Canopy dance.gif", imageinfo: [{ mime: "image/gif", url: "https://upload.wikimedia.org/canopy-dance.gif", descriptionurl: "https://commons.wikimedia.org/wiki/File:Canopy_dance.gif", width: 320, height: 240, size: 2048 }] }] } }),
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find your signal." })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByText("2 relays")).toBeVisible();
  await expect(page.getByTestId("event-card")).toHaveCount(2);
  await expect(page.getByText("Alice Canopy").first()).toBeVisible();
  const nestedReplyCard = page.getByTestId("event-card").filter({ hasText: "This client feels wonderfully fast." });
  const replyContext = nestedReplyCard.getByRole("button", { name: "Replying to Tutorial Author. Open conversation" });
  await expect(replyContext).toBeVisible();
  await expect(page.getByTestId("event-card").filter({ hasText: longPost.slice(0, 24) }).getByText(/Replying to/)).toHaveCount(0);
  await expect(page.getByText("Unrelated global note")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find your signal." })).toHaveCount(0);
  await expect(page.getByTestId("event-card")).toHaveCount(2);
  await expect(page.getByText(/nostr:nprofile1/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View Tutorial Author's profile" })).toBeVisible();
  const referencedPost = page.getByRole("button", { name: "Open referenced post by Tutorial Author" });
  await expect(referencedPost).toContainText("A compact referenced tutorial.");
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const feedScrollPosition = await page.evaluate(() => window.scrollY);
  await replyContext.dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page).toHaveURL(/\/event\/nevent1/);
  await expect(page.getByText("Opened here")).toBeVisible();
  await expect(page.getByText("Original post → 2 replies deep → opened note")).toBeVisible();
  const focusedCard = page.locator(`[data-thread-event-id="${replyEvent.id}"]`);
  await expect(focusedCard).toHaveClass(/thread-card--focus/);
  await expect.poll(async () => (await focusedCard.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  const threadCards = page.getByRole("region", { name: "Message thread" }).getByTestId("event-card");
  await expect(threadCards).toHaveCount(4);
  await expect(threadCards.nth(0)).toContainText("A quiet corner of the web.");
  await expect(threadCards.nth(1)).toContainText("A direct reply from the tutorial author.");
  await expect(threadCards.nth(2)).toContainText("This client feels wonderfully fast.");
  const busyBranchToggle = page.getByRole("button", { name: /Expand replies to this note: 1 direct reply, 9 total/ });
  await expect(busyBranchToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Side conversation reply 1.")).toHaveCount(0);
  await busyBranchToggle.click();
  await expect(page.getByText("Side conversation reply 1.")).toBeVisible();
  const expandedBusyBranchToggle = page.getByRole("button", { name: /Collapse replies to this note: 1 direct reply, 9 total/ });
  await expect(expandedBusyBranchToggle).toHaveAttribute("aria-expanded", "true");
  const toggleBox = await expandedBusyBranchToggle.boundingBox();
  expect(toggleBox?.height).toBeGreaterThanOrEqual(38);
  await page.getByRole("button", { name: "Collapse side branches" }).click();
  await expect(page.getByText("Side conversation reply 1.")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByText("Side conversation reply 9.")).toBeVisible();
  await page.getByRole("button", { name: "Collapse side branches" }).click();
  await expect(focusedCard).toBeVisible();
  await expect(focusedCard.getByRole("button", { name: "Like note" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Message thread" }).getByRole("button", { name: /Replying to/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Back from thread" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page).toHaveURL(/\/feed$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(feedScrollPosition);
  await expect(page.getByAltText("Image attached to this note")).toBeVisible();
  await page.getByRole("button", { name: "Open image attached to this note" }).click();
  await expect(page.getByRole("dialog", { name: "Image viewer" })).toBeVisible();
  await page.getByRole("button", { name: "Close media viewer" }).click();
  await page.getByRole("button", { name: "Play video attached to this note" }).click();
  const videoViewer = page.getByRole("dialog", { name: "Video player" });
  await expect(videoViewer).toBeVisible();
  await expect(videoViewer.getByRole("button", { name: "Mute", exact: true })).toBeVisible();
  await expect(videoViewer.locator("video")).toHaveAttribute("src", "https://blossom.example/garden.mp4");
  await page.getByRole("button", { name: "Close media viewer" }).click();
  await expect(page.getByTestId("event-card").first().locator(".event-actions svg")).toHaveCount(6);
  const longNote = page.getByTestId("event-card").filter({ hasText: "A quiet corner of the web." });
  const longContent = longNote.locator(".event-content");
  const readMore = longNote.getByRole("button", { name: "Read more" });
  await expect(longContent).toHaveClass(/event-content--collapsed/);
  await expect(readMore).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByAltText("Image attached to this note")).toBeVisible();
  await readMore.click();
  await expect(longContent).not.toHaveClass(/event-content--collapsed/);
  await expect(longNote.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  await longNote.getByRole("button", { name: "Show less" }).click();
  await expect(longContent).toHaveClass(/event-content--collapsed/);
  await page.evaluate(() => window.scrollTo(0, 0));

  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNav.getByRole("button")).toHaveCount(5);
  const searchBox = await primaryNav.getByRole("button", { name: "Search" }).boundingBox();
  const postNavBox = await primaryNav.getByRole("button", { name: "Create post" }).boundingBox();
  const bookmarksBox = await primaryNav.getByRole("button", { name: "Bookmarks" }).boundingBox();
  expect(searchBox && postNavBox && bookmarksBox).toBeTruthy();
  expect(postNavBox!.x - (searchBox!.x + searchBox!.width)).toBeGreaterThan(10);
  expect(bookmarksBox!.x - (postNavBox!.x + postNavBox!.width)).toBeGreaterThan(10);
  await primaryNav.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "Search Canopy" })).toBeVisible();
  await expect(page).toHaveURL(/\/search$/);
  const cacheStatus = page.getByRole("region", { name: "Following cache" });
  await expect(cacheStatus.getByText("2", { exact: true })).toBeVisible();
  await expect(cacheStatus.getByText("Just now")).toHaveCount(2);
  const fallbackNpub = nip19.npubEncode(fallbackPubkey);
  const localSearch = page.getByRole("searchbox", { name: "Search local people and posts" });
  await localSearch.fill(fallbackNpub);
  await expect(page.locator(".search-result").filter({ hasText: fallbackNpub })).toBeVisible();
  const cacheKey = `canopy.followingCache.v1.${ownerPubkey}`;
  const initialCache = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null") as { followingSyncedAt: number; profilesRefreshedAt: number; followedPubkeys: string[] }, cacheKey);
  expect(initialCache.followedPubkeys).toEqual([authorPubkey, fallbackPubkey].sort());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Search Canopy" })).toBeVisible();
  const persistedCache = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null") as { followingSyncedAt: number; profilesRefreshedAt: number }, cacheKey);
  expect(persistedCache).toEqual(expect.objectContaining({ followingSyncedAt: initialCache.followingSyncedAt, profilesRefreshedAt: initialCache.profilesRefreshedAt }));
  await page.waitForTimeout(20);
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeEnabled();
  const manualCache = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null") as { followingSyncedAt: number; profilesRefreshedAt: number }, cacheKey);
  expect(manualCache.followingSyncedAt).toBeGreaterThan(initialCache.followingSyncedAt);
  expect(manualCache.profilesRefreshedAt).toBeGreaterThan(initialCache.profilesRefreshedAt);
  await expect(page.getByText(/people · \d+ posts · ≈/)).toBeVisible();
  const referenceNpub = nip19.npubEncode(referencePubkey);
  await localSearch.fill(`nostr:${referenceNpub}`);
  await page.getByRole("button", { name: "Open identity" }).click();
  await expect(page.getByRole("heading", { name: "Tutorial Author" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/profile/${referenceNpub}$`));
  await page.getByRole("button", { name: "Back from profile" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await localSearch.fill("alice canopy");
  await page.locator(".search-result").filter({ hasText: "Alice Canopy" }).first().click();
  await expect(page.getByRole("heading", { name: "Alice Canopy" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/profile/${nip19.npubEncode(authorPubkey)}$`));
  await expect(page.getByRole("region", { name: "Alice Canopy's posts" }).getByRole("button", { name: "Replying to Tutorial Author. Open conversation" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Search Canopy" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Alice Canopy" })).toBeVisible();
  await page.getByRole("button", { name: "Back from profile" }).click();
  await expect(page.getByRole("heading", { name: "Search Canopy" })).toBeVisible();
  await localSearch.fill("wonderfully fast");
  await page.locator(".search-post-result").filter({ hasText: "wonderfully fast" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page.getByText("Opened here")).toBeVisible();
  await expect(page.getByText("Original post → 2 replies deep → opened note")).toBeVisible();
  await expect(page.getByText("This client feels wonderfully fast.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await expect(page.getByRole("heading", { name: "Search Canopy" })).toBeVisible();
  const storedPosts = await page.evaluate(async () => {
    const request = indexedDB.open("canopy-local-search");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("posts", "readonly");
    const countRequest = transaction.objectStore("posts").count();
    return await new Promise<number>((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
  });
  expect(storedPosts).toBeGreaterThanOrEqual(3);
  await primaryNav.getByRole("button", { name: "Bookmarks" }).click();
  await expect(page.getByRole("heading", { name: "Bookmarks" })).toBeVisible();
  await expect(page).toHaveURL(/\/saved\/bookmarks$/);
  const personal = page.getByRole("region", { name: "Personal bookmarks" });
  await expect(personal.getByText("A saved reply whose parent is not available.")).toBeVisible();
  const missingParentContext = personal.getByRole("button", { name: "Replying to a note. Open conversation" });
  await expect(missingParentContext).toBeVisible();
  await missingParentContext.click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other replies" })).toBeVisible();
  await expect(page.getByText("Original post → part of the path is unavailable → opened note")).toBeVisible();
  await expect(page.getByText("Opened here")).toBeVisible();
  await expect(page.getByText("A saved reply whose parent is not available.")).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await expect(page.getByRole("region", { name: "Personal bookmarks" })).toBeVisible();
  const removeBookmark = personal.getByRole("button", { name: "Remove bookmark" });
  await removeBookmark.click();
  await expect(page.getByText("No public note bookmarks")).toBeVisible();
  await expect(page.getByText("Article reference retained")).toBeVisible();
  const removedList = signedTemplates.findLast((template) => template.kind === 10003);
  expect(removedList?.content).toBe("opaque-encrypted-bookmarks");
  expect(removedList?.tags).toContainEqual(["a", `30023:${authorPubkey}:canopy-article`]);
  expect(removedList?.tags).toContainEqual(["x", "keep-me"]);
  expect(removedList?.tags).not.toContainEqual(["e", orphanReply.id, "wss://bookmark.hint"]);

  await page.getByRole("tab", { name: "Highlights" }).click();
  await expect(page).toHaveURL(/\/saved\/highlights$/);
  await expect(page.getByRole("region", { name: "Network highlights" })).toContainText("Boris-style network highlight");
  await page.getByRole("button", { name: "Open source note" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await page.getByRole("tab", { name: "LookMarks" }).click();
  await expect(page).toHaveURL(/\/saved\/lookmarks$/);
  await expect(page.getByRole("region", { name: "Network LookMarks" })).toContainText("reaction");
  await page.getByRole("button", { name: "Open target" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page.getByText("A compact referenced tutorial.")).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await page.reload();
  await expect(page).toHaveURL(/\/saved\/lookmarks$/);
  await expect(page.getByRole("region", { name: "Network LookMarks" })).toBeVisible();

  await primaryNav.getByRole("button", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  const homeFirstNote = page.getByTestId("event-card").first();
  const saveBookmark = homeFirstNote.getByRole("button", { name: "Bookmark note" });
  await saveBookmark.click();
  await expect(homeFirstNote.getByRole("button", { name: "Remove bookmark" })).toBeDisabled();
  await expect(homeFirstNote.getByRole("button", { name: "Like note" })).toBeEnabled();
  await expect(homeFirstNote.getByRole("button", { name: "Remove bookmark" })).toBeEnabled();
  await expect(homeFirstNote.getByRole("button", { name: "Remove bookmark" })).toHaveText("Saved");
  const savedList = signedTemplates.findLast((template) => template.kind === 10003);
  expect(savedList?.tags).toContainEqual(["e", replyEvent.id, "wss://profile.one"]);

  const shell = page.locator(".app-shell");
  await shell.evaluate((element) => {
    const event = new Event("touchstart", { bubbles: true });
    Object.defineProperty(event, "touches", { value: [{ clientY: 10 }] });
    element.dispatchEvent(event);
  });
  await shell.evaluate((element) => {
    const event = new Event("touchmove", { bubbles: true });
    Object.defineProperty(event, "touches", { value: [{ clientY: 125 }] });
    element.dispatchEvent(event);
  });
  await expect(page.getByText("Release to refresh")).toBeVisible();
  await shell.dispatchEvent("touchend", { touches: [] });
  await expect(page.getByText("Refreshing feed…")).toBeVisible();

  await page.getByTestId("event-card").first().getByRole("button", { name: "View Alice Canopy's profile" }).click();
  await expect(page.getByRole("heading", { name: "Alice Canopy" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/profile/${nip19.npubEncode(authorPubkey)}$`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Alice Canopy" })).toBeVisible();
  const follow = page.getByRole("button", { name: "Following", exact: true });
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(page.getByRole("button", { name: "Unfollowing…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Share Alice Canopy's profile" })).toBeEnabled();
  await expect(page.getByText("Unfollowed.")).toBeVisible();
  const unfollowTemplate = signedTemplates.findLast((template) => template.kind === 3);
  expect(unfollowTemplate?.content).toBe("opaque-contact-content");
  expect(unfollowTemplate?.tags).toContainEqual(["x", "keep-contact-extension"]);
  expect(unfollowTemplate?.tags.some((tag) => tag[0] === "p" && tag[1] === authorPubkey)).toBe(false);
  await page.evaluate(() => { window.__CANOPY_MOCK_PUBLISH_FAILURE__ = true; });
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Following…" })).toBeDisabled();
  await expect(page.getByText("Follow could not be published.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow", exact: true })).toBeEnabled();
  await page.evaluate(() => { window.__CANOPY_MOCK_PUBLISH_FAILURE__ = false; });
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByText("Following.")).toBeVisible();
  const refollowTemplate = signedTemplates.findLast((template) => template.kind === 3);
  expect(refollowTemplate?.tags).toEqual([["p", fallbackPubkey], ["x", "keep-contact-extension"], ["p", authorPubkey]]);
  await expect(page.getByRole("region", { name: "Alice Canopy's posts" }).getByTestId("event-card")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Alice Canopy's posts" }).getByRole("button", { name: "Like note" }).first()).toBeVisible();
  await expect(page.getByText("Unrelated global note")).toHaveCount(0);
  const aliceNpub = nip19.npubEncode(authorPubkey);
  await page.getByRole("button", { name: "Share Alice Canopy's profile" }).click();
  const shareDialog = page.getByRole("dialog", { name: "Share Alice Canopy" });
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog.getByLabel("Alice Canopy npub")).toHaveText(aliceNpub);
  await expect(shareDialog.locator(".profile-qr")).toHaveAttribute("data-qr-value", `nostr:${aliceNpub}`);
  await expect(shareDialog.locator("svg")).toBeVisible();
  await shareDialog.getByRole("button", { name: "Copy npub" }).click();
  expect(copiedValues.at(-1)).toBe(aliceNpub);
  await expect(shareDialog.getByText("Npub copied.")).toBeVisible();
  await shareDialog.getByRole("button", { name: "Copy Canopy link" }).click();
  expect(copiedValues.at(-1)).toMatch(new RegExp(`/profile/${aliceNpub}$`));
  await expect(shareDialog.getByText("Canopy link copied.")).toBeVisible();
  await page.getByRole("button", { name: "Close Share Alice Canopy" }).click();
  await page.getByRole("button", { name: "Back from profile" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();

  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  const profileEditor = page.getByRole("dialog", { name: "Edit profile" });
  await expect(profileEditor.getByLabel("Display name")).toHaveValue("Pete Previous");
  await expect(profileEditor.getByLabel("Website")).toHaveValue("https://old.example");
  await profileEditor.getByLabel("Display name").fill("Pete Canopy");
  await profileEditor.getByLabel("Bio").fill("Updated from Canopy");
  await profileEditor.getByLabel("Website").fill("");
  await page.evaluate(() => { window.__CANOPY_MOCK_PUBLISH_FAILURE__ = true; });
  await profileEditor.getByRole("button", { name: "Save profile" }).click();
  await expect(profileEditor.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(profileEditor.getByText("No relay accepted your profile. Your edits are still here.")).toBeVisible();
  await expect(profileEditor.getByLabel("Bio")).toHaveValue("Updated from Canopy");
  await page.evaluate(() => { window.__CANOPY_MOCK_PUBLISH_FAILURE__ = false; });
  await profileEditor.getByRole("button", { name: "Save profile" }).click();
  await expect(profileEditor.getByText(/Profile saved to 1 relay/)).toBeVisible();
  const profileTemplate = signedTemplates.findLast((template) => template.kind === 0);
  expect(profileTemplate?.tags).toEqual([]);
  expect(JSON.parse(profileTemplate!.content)).toEqual({ display_name: "Pete Canopy", name: "pete", about: "Updated from Canopy", lud06: "lnurl1keep", custom: { theme: "moss" } });
  await page.getByRole("button", { name: "Close Edit profile" }).click();
  await expect(page.getByRole("button", { name: "Open account options for Pete Canopy" })).toBeVisible();

  const firstNote = page.getByTestId("event-card").first();
  await firstNote.getByRole("button", { name: "More note options" }).click();
  await firstNote.getByRole("menuitem", { name: "Copy Canopy link" }).click();
  expect(copiedValues.at(-1)).toMatch(/\/event\/nevent1/);
  await expect(firstNote.getByText("Canopy link copied.")).toBeVisible();
  await firstNote.getByRole("button", { name: "More note options" }).click();
  await firstNote.getByRole("menuitem", { name: "Copy event reference" }).click();
  expect(copiedValues.at(-1)).toBe(`nostr:${nip19.neventEncode({ id: replyEvent.id, author: replyEvent.pubkey, kind: replyEvent.kind, relays: ["wss://profile.one", "wss://profile.read"] })}`);
  await expect(firstNote.getByText("Event reference copied.")).toBeVisible();
  await firstNote.getByRole("button", { name: "More note options" }).click();
  await firstNote.getByRole("menuitem", { name: "Copy raw event ID" }).click();
  expect(copiedValues.at(-1)).toBe(replyEvent.id);
  await expect(firstNote.getByText("Raw event ID copied.")).toBeVisible();
  await firstNote.getByRole("button", { name: "Like note" }).click();
  await expect(firstNote.getByRole("button", { name: "Like note" })).toHaveText("Liked");
  await expect(firstNote.getByRole("button", { name: "Reply to note" })).toBeEnabled();
  await expect(firstNote.getByText("Like published.")).toBeVisible();
  await expect(firstNote.getByRole("button", { name: "Like note" })).toBeDisabled();
  await page.evaluate(() => { window.__CANOPY_MOCK_PUBLISH_FAILURE__ = true; });
  const failingNote = page.getByTestId("event-card").last();
  await failingNote.getByRole("button", { name: "Like note" }).click();
  await expect(failingNote.getByRole("button", { name: "Like note" })).toHaveText("Liked");
  await expect(failingNote.getByRole("button", { name: "Reply to note" })).toBeEnabled();
  await expect(failingNote.getByText("No relay accepted the Like.")).toBeVisible();
  await expect(failingNote.getByRole("button", { name: "Like note" })).toBeEnabled();
  await expect(failingNote.getByRole("button", { name: "Like note" })).toHaveText("Like");
  await page.evaluate(() => { window.__CANOPY_MOCK_PUBLISH_FAILURE__ = false; window.__CANOPY_MOCK_PUBLISH_DELAY__ = 0; });
  await firstNote.getByRole("button", { name: "Reply to note" }).click();
  const replyBox = firstNote.getByRole("textbox", { name: "Write a reply…" });
  await replyBox.fill("A reply through NIP-10 :thu");
  await firstNote.getByRole("option", { name: /thumbsup/ }).click();
  await expect(replyBox).toHaveText("A reply through NIP-10 👍");
  await replyBox.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3])], "pasted-reply.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(firstNote.getByText("1 pasted image uploaded.")).toBeVisible();
  await expect(replyBox).toHaveText("A reply through NIP-10 👍\nhttps://blossom.example/mock-image.png");
  await firstNote.getByRole("button", { name: "Publish reply" }).click();
  await expect(firstNote.getByText("Reply published.")).toBeVisible();
  expect(signedTemplates.findLast((template) => template.kind === 1)?.content).toContain("https://blossom.example/mock-image.png");
  await firstNote.getByRole("button", { name: "Repost note" }).click();
  await expect(firstNote.getByText("Repost published.")).toBeVisible();
  await firstNote.getByRole("button", { name: "Zap note" }).click();
  await expect(firstNote.getByText("Zapped 21 sats.")).toBeVisible();
  await expect(firstNote.getByLabel("Zap amount in sats")).toHaveCount(0);
  expect(zapRequests).toEqual([{ amount: "21000", content: "" }]);
  expect(signedTemplates.filter((template) => template.kind === 9734)).toHaveLength(1);

  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: /^Settings(?: →)?$/ }).click();
  await expect(page.getByLabel("Read relays")).toHaveValue("wss://profile.one\nwss://profile.read");
  await expect(page.getByLabel("Write relays")).toHaveValue("wss://profile.one\nwss://profile.write");
  await expect(page.getByLabel("Blossom upload servers")).toHaveValue("https://blossom.example");
  await expect(page.getByLabel("Default zap amount")).toHaveValue("21");
  await expect(page.getByLabel("Default zap message")).toHaveValue("");
  await page.getByLabel("Default zap amount").fill("34");
  await page.getByLabel("Default zap message").fill("great default");
  await page.getByRole("button", { name: "Save zap defaults" }).click();
  await expect(page.getByText("Zap defaults saved.")).toBeVisible();
  await page.getByRole("button", { name: "Reset to profile" }).click();
  await expect(page.getByLabel("Default zap amount")).toHaveValue("34");
  await expect(page.getByLabel("Default zap message")).toHaveValue("great default");
  await page.getByLabel("NWC connection URI").fill(nwcUri);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Nostr Wallet Connect saved in this browser.")).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain(nwcSecret);
  expect(await page.evaluate((key) => localStorage.getItem(key), `canopy.nwc.${ownerPubkey}`)).toBe(nwcUri);
  await page.getByRole("button", { name: "Close Settings" }).click();
  const beforeImmediateDefault = zapRequests.length;
  await page.evaluate(() => { window.__CANOPY_MOCK_NWC_DELAY__ = 300; });
  await failingNote.getByRole("button", { name: "Zap note" }).click();
  await expect(failingNote.getByRole("button", { name: "Zap note, 34 sats pending" })).toHaveText("34 sats");
  await expect(failingNote.getByRole("button", { name: "Reply to note" })).toBeEnabled();
  await expect(failingNote.getByText("Zapped 34 sats through Nostr Wallet Connect.")).toBeVisible();
  expect(zapRequests).toHaveLength(beforeImmediateDefault + 1);
  expect(zapRequests.at(-1)).toEqual({ amount: "34000", content: "great default" });
  await page.evaluate(() => { window.__CANOPY_MOCK_NWC_DELAY__ = 0; });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: /^Settings(?: →)?$/ }).click();
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Default zap amount")).toHaveValue("34");
  await expect(page.getByLabel("Default zap message")).toHaveValue("great default");
  await page.getByRole("button", { name: "Close Settings" }).click();

  const reloadedFirstNote = page.getByTestId("event-card").first();
  const reloadedFailingNote = page.getByTestId("event-card").last();
  const beforeReloadedDefault = zapRequests.length;
  await reloadedFirstNote.getByRole("button", { name: "Zap note" }).click();
  await expect(reloadedFirstNote.getByText("Zapped 34 sats through Nostr Wallet Connect.")).toBeVisible();
  expect(zapRequests).toHaveLength(beforeReloadedDefault + 1);
  expect(zapRequests.at(-1)).toEqual({ amount: "34000", content: "great default" });
  const beforeLongPress = zapRequests.length;
  const longPressZap = reloadedFirstNote.getByRole("button", { name: /^Zap note/ });
  await longPressZap.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7, clientX: 20, clientY: 20 });
  await longPressZap.dispatchEvent("pointermove", { pointerType: "touch", pointerId: 7, clientX: 50, clientY: 20 });
  await page.waitForTimeout(600);
  await expect(reloadedFirstNote.getByLabel("Zap amount in sats")).toHaveCount(0);
  expect(zapRequests).toHaveLength(beforeLongPress);
  await longPressZap.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 8, clientX: 20, clientY: 20 });
  await longPressZap.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 8, clientX: 20, clientY: 20 });
  await page.waitForTimeout(600);
  await expect(reloadedFirstNote.getByLabel("Zap amount in sats")).toHaveCount(0);
  expect(zapRequests).toHaveLength(beforeLongPress);
  await longPressZap.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 9, clientX: 20, clientY: 20 });
  await page.waitForTimeout(600);
  await expect(reloadedFirstNote.getByLabel("Zap amount in sats")).toHaveValue("34");
  await expect(reloadedFirstNote.getByLabel("Zap message")).toHaveValue("great default");
  expect(zapRequests).toHaveLength(beforeLongPress);
  await longPressZap.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 9, clientX: 20, clientY: 20 });
  await longPressZap.dispatchEvent("click");
  await page.waitForTimeout(50);
  expect(zapRequests).toHaveLength(beforeLongPress);
  await reloadedFirstNote.getByLabel("Zap amount in sats").fill("45");
  await reloadedFirstNote.getByLabel("Zap message").fill("one time only");
  await reloadedFirstNote.getByRole("button", { name: "Zap with NWC" }).click();
  await expect(reloadedFirstNote.getByText("Zapped 45 sats through Nostr Wallet Connect.")).toBeVisible();
  expect(zapRequests.at(-1)).toEqual({ amount: "45000", content: "one time only" });

  const beforeContext = zapRequests.length;
  const contextZap = reloadedFailingNote.getByRole("button", { name: "Zap note" });
  await contextZap.dispatchEvent("contextmenu");
  await expect(reloadedFailingNote.getByLabel("Zap amount in sats")).toHaveValue("34");
  await expect(reloadedFailingNote.getByLabel("Zap message")).toHaveValue("great default");
  await contextZap.dispatchEvent("click");
  await page.waitForTimeout(50);
  expect(zapRequests).toHaveLength(beforeContext);
  await reloadedFailingNote.getByRole("button", { name: "Reply to note" }).click();
  await expect(reloadedFailingNote.getByLabel("Zap amount in sats")).toHaveCount(0);
  await reloadedFailingNote.getByRole("button", { name: "Reply to note" }).click();
  await contextZap.press("Shift+Enter");
  await expect(reloadedFailingNote.getByLabel("Zap amount in sats")).toHaveValue("34");
  expect(zapRequests).toHaveLength(beforeContext);
  await reloadedFailingNote.getByRole("button", { name: "Reply to note" }).click();
  await reloadedFailingNote.getByRole("button", { name: "Reply to note" }).click();

  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: /^Settings(?: →)?$/ }).click();
  await expect(page.getByLabel("Default zap amount")).toHaveValue("34");
  await expect(page.getByLabel("Default zap message")).toHaveValue("great default");
  await page.getByRole("button", { name: "Close Settings" }).click();

  await page.evaluate(() => { window.__CANOPY_MOCK_NWC_DELAY__ = 500; });
  await reloadedFailingNote.getByRole("button", { name: "Zap note" }).dispatchEvent("contextmenu");
  await reloadedFailingNote.getByLabel("Zap amount in sats").fill("42");
  const beforePending = zapRequests.length;
  await reloadedFailingNote.getByRole("button", { name: "Zap with NWC" }).click();
  await expect(reloadedFailingNote.getByRole("button", { name: "Zap note, 42 sats pending" })).toHaveText("42 sats");
  await expect(reloadedFailingNote.getByRole("button", { name: "Reply to note" })).toBeEnabled();
  await reloadedFailingNote.getByRole("button", { name: "Zap note, 42 sats pending" }).dispatchEvent("click");
  await page.waitForTimeout(50);
  expect(zapRequests).toHaveLength(beforePending + 1);
  await expect(reloadedFailingNote.getByText("Zapped 42 sats through Nostr Wallet Connect.")).toBeVisible();
  await expect(reloadedFailingNote.getByRole("button", { name: "Zap note, 42 sats sent" })).toBeEnabled();
  await page.evaluate(() => { window.__CANOPY_MOCK_NWC_FAILURE__ = true; window.__CANOPY_MOCK_NWC_DELAY__ = 300; });
  await reloadedFailingNote.getByRole("button", { name: "Zap note, 42 sats sent" }).dispatchEvent("contextmenu");
  await reloadedFailingNote.getByLabel("Zap amount in sats").fill("43");
  await reloadedFailingNote.getByRole("button", { name: "Zap with NWC" }).click();
  await expect(reloadedFailingNote.getByRole("button", { name: "Zap note, 43 sats pending" })).toBeVisible();
  await expect(reloadedFailingNote.getByRole("button", { name: "Reply to note" })).toBeEnabled();
  await expect(reloadedFailingNote.getByText("The NIP-47 wallet rejected the payment.")).toBeVisible();
  await expect(reloadedFailingNote.getByRole("button", { name: "Zap note, 42 sats sent" })).toBeEnabled();
  await page.evaluate(() => { window.__CANOPY_MOCK_NWC_FAILURE__ = false; window.__CANOPY_MOCK_NWC_DELAY__ = 0; });

  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: /^Settings(?: →)?$/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Wallet removed locally. Its removal will sync when backup is available.")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), `canopy.nwc.${ownerPubkey}`)).toBeNull();
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.evaluate(() => { delete window.webln; });
  await reloadedFirstNote.getByRole("button", { name: "Zap note, 45 sats sent" }).dispatchEvent("contextmenu");
  await reloadedFirstNote.getByLabel("Zap amount in sats").fill("46");
  await reloadedFirstNote.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(reloadedFirstNote.getByText("Invoice ready. Open it in your Lightning wallet or copy it below.")).toBeVisible();
  await expect(reloadedFirstNote.getByRole("button", { name: "Zap note, 45 sats sent" })).toBeEnabled();

  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: "NStack connection" }).click();
  await expect(page.getByRole("dialog", { name: "Connect an NStack" })).toBeVisible();
  await expect(page.getByText("NStack available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discover my NStacks" }).click();
  await expect(page.getByText("NStack destination imported", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Pete’s NStack/ }).click();
  await expect(page.getByRole("button", { name: /Personal/ })).toBeVisible();
  await page.getByRole("button", { name: /Wingman Suite/ }).click();
  await page.getByRole("button", { name: "Import connection" }).click();
  await expect(page.getByText("NStack destination imported", { exact: true })).toBeVisible();
  await expect(page.getByText(/configured public Nostr relays and Blossom servers independently/)).toBeVisible();
  expect(nstackCalls.slice(0, 5)).toEqual([
    { method: "requestDiscovery", value: { workspaces: true } },
    { method: "listNStacks", value: undefined },
    { method: "listWorkspaces", value: "personal" },
    { method: "listWorkspaces", value: "work" },
    { method: "getConnection", value: { stackId: "personal", workspaceId: "suite" } },
  ]);
  const allStorage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(allStorage).toContain("real-suite");
  expect(allStorage).not.toContain("opaque-browser-handle");
  expect(allStorage).not.toContain('"stackId":"personal"');
  expect(allStorage).not.toContain('"id":"suite"');
  await page.evaluate(() => (window as unknown as { triggerNStackChange(): void }).triggerNStackChange());
  await expect(page.getByText(/changed or was revoked/)).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("real-suite");
  await page.getByRole("button", { name: "Close Connect an NStack" }).click();
  await page.evaluate(() => { delete window.NStack; });
  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: "NStack connection" }).click();
  await expect(page.getByText("NStack bridge unavailable")).toBeVisible();
  await expect(page.getByText(/Ordinary NIP-07 browsing, signing, relays, and uploads still work/)).toBeVisible();
  await page.getByRole("button", { name: "Close Connect an NStack" }).click();

  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("dialog", { name: "Create a post" })).toBeVisible();
  const composerDialog = page.getByRole("dialog", { name: "Create a post" });
  await composerDialog.getByRole("button", { name: "Emoji" }).click();
  await composerDialog.getByLabel("Search emoji").fill("rocket");
  await composerDialog.getByRole("button", { name: "rocket" }).click();
  await composerDialog.getByRole("button", { name: "GIF", exact: true }).click();
  await composerDialog.getByLabel("Search GIFs").fill("happy dance");
  await composerDialog.getByRole("button", { name: "Search", exact: true }).click();
  const gifPreview = composerDialog.getByTestId("gif-preview");
  await expect(gifPreview).toBeVisible();
  expect((await gifPreview.boundingBox())?.width).toBeGreaterThan(240);
  await composerDialog.getByRole("button", { name: "Add Canopy dance.gif" }).click();
  await expect(page.getByRole("textbox", { name: "Share a note with Nostr…" })).toHaveText("🚀\nhttps://upload.wikimedia.org/canopy-dance.gif");
  const postBox = page.getByRole("textbox", { name: "Share a note with Nostr…" });
  await postBox.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([4, 5, 6])], "pasted-post.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(composerDialog.getByText("1 pasted image uploaded.")).toBeVisible();
  await expect(postBox).toHaveText("🚀\nhttps://upload.wikimedia.org/canopy-dance.gif\nhttps://blossom.example/mock-image.png");
  await page.locator('input[type="file"]').setInputFiles({ name: "garden.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByText("1 image uploaded.")).toBeVisible();
  const uploadAuthorization = signedTemplates.find((template) => template.kind === 24242);
  expect(uploadAuthorization?.tags).toContainEqual(["t", "upload"]);
  expect(uploadAuthorization?.tags).toContainEqual(["x", expect.stringMatching(/^[0-9a-f]{64}$/)]);
  await page.getByRole("textbox", { name: "Share a note with Nostr…" }).fill("Posted through the mocked signer 🚀\nhttps://upload.wikimedia.org/canopy-dance.gif");
  await page.getByRole("button", { name: "Post note", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create a post" })).toHaveCount(0);
  expect(signedTemplates.findLast((template) => template.kind === 1)?.content).toContain("https://blossom.example/mock-image.png");
  expect(signedTemplates.findLast((template) => template.kind === 1)?.content).toContain("https://upload.wikimedia.org/canopy-dance.gif");

  await page.getByRole("button", { name: /Activity/ }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await page.reload();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText(/does not send push notifications/)).toBeVisible();
  await page.getByRole("button", { name: /Alice Canopy replied to a thread/ }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page.getByText("From notification")).toBeVisible();
  const notificationFocus = page.locator(`[data-thread-event-id="${replyEvent.id}"]`);
  await expect(notificationFocus).toHaveClass(/thread-card--focus/);
  await expect.poll(async () => (await notificationFocus.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  await expect(page.getByText("A quiet corner of the web.")).toBeVisible();
  await expect(page.getByText("This client feels wonderfully fast.")).toBeVisible();
  await page.getByTestId("event-card").first().getByRole("button", { name: "View Alice Canopy's profile" }).click();
  await expect(page.getByRole("heading", { name: "Alice Canopy" })).toBeVisible();
  await page.getByRole("button", { name: "Back from profile" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await expect(page.getByText(/does not send push notifications/)).toBeVisible();
  await page.getByRole("button", { name: "Canopy home, scroll to top" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole("button", { name: "Create post" }).click();
  const mentionComposer = page.getByRole("dialog", { name: "Create a post" });
  const mentionPostBox = mentionComposer.getByRole("textbox", { name: "Share a note with Nostr…" });
  await mentionPostBox.fill("Hello @ali");
  await mentionPostBox.press("ArrowDown");
  await mentionPostBox.press("Enter");
  await expect(mentionPostBox.locator(".mention-composer-pill")).toHaveText("@Alice Canopy");
  await expect(mentionPostBox).not.toContainText("nostr:nprofile");
  await mentionPostBox.pressSequentially("from Canopy");
  await expect(mentionPostBox).toHaveText("Hello @Alice Canopy from Canopy");
  await mentionPostBox.press("Enter");
  await mentionPostBox.pressSequentially("second line");
  await expect(mentionPostBox).toContainText("second line");
  await mentionComposer.getByRole("button", { name: "Post note" }).click();
  await expect(mentionComposer).toHaveCount(0);
  const mentionPost = signedTemplates.findLast((template) => template.kind === 1)!;
  expect(mentionPost.tags.filter(([name, value]) => name === "p" && value === authorPubkey)).toHaveLength(1);
  expect(mentionPost.content).toContain("nostr:nprofile1");
  expect(mentionPost.content).toContain("\nsecond line");

  const compositionCard = page.getByTestId("event-card").filter({ hasText: "A quiet corner of the web." });
  await compositionCard.getByRole("button", { name: "Reply to note" }).click();
  const mentionReplyBox = compositionCard.getByRole("textbox", { name: "Write a reply…" });
  await mentionReplyBox.fill("Thanks @tut");
  const tutorialOption = page.getByRole("option", { name: /Tutorial Author/ });
  await tutorialOption.dispatchEvent("pointerdown", { pointerType: "touch" });
  await tutorialOption.click();
  await expect(mentionReplyBox.locator(".mention-composer-pill")).toHaveText("@Tutorial Author");
  await expect(mentionReplyBox).not.toContainText("nostr:nprofile");
  await mentionReplyBox.press("ArrowLeft");
  await mentionReplyBox.press("Backspace");
  await expect(mentionReplyBox.locator(".mention-composer-pill")).toHaveCount(0);
  await mentionReplyBox.pressSequentially("for this");
  await compositionCard.getByRole("button", { name: "Publish reply" }).click();
  await expect(compositionCard.getByRole("textbox", { name: "Write a reply…" })).toHaveCount(0);
  const mentionReply = signedTemplates.findLast((template) => template.kind === 1)!;
  expect(mentionReply.tags.filter(([name, value]) => name === "p" && value === referencePubkey)).toHaveLength(0);
  expect(mentionReply.tags.filter(([name, value]) => name === "p" && value === authorPubkey)).toHaveLength(1);
  expect(mentionReply.tags.some(([name, value]) => name === "e" && value === root.id)).toBe(true);

  await compositionCard.getByRole("button", { name: "Quote note" }).click();
  await expect(compositionCard.getByLabel("Quoting Alice Canopy")).toContainText("A quiet corner of the web.");
  await expect(compositionCard.getByRole("button", { name: "Emoji" })).toBeVisible();
  await expect(compositionCard.getByRole("button", { name: "GIF", exact: true })).toBeVisible();
  await compositionCard.getByRole("button", { name: "Cancel quote" }).click();
  await expect(compositionCard.getByLabel("Quoting Alice Canopy")).toHaveCount(0);
  await compositionCard.getByRole("button", { name: "Quote note" }).click();
  await compositionCard.getByRole("textbox", { name: "Add a comment (optional)…" }).fill("Worth sharing");
  const quoteButton = compositionCard.getByRole("button", { name: "Publish quote" });
  await quoteButton.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(compositionCard.getByText("Quote published.")).toBeVisible();
  const quotePost = signedTemplates.findLast((template) => template.kind === 1)!;
  expect(quotePost.tags.filter(([name]) => name === "q")).toEqual([["q", root.id, "wss://profile.one", authorPubkey]]);
  const quoteReference = quotePost.content.split("\n\n").at(-1)!;
  expect(nip19.decode(quoteReference.slice(6))).toMatchObject({ type: "nevent", data: { id: root.id, author: authorPubkey, relays: ["wss://profile.one"] } });
  const directEventPath = `/event/${nip19.neventEncode({ id: replyEvent.id, author: replyEvent.pubkey, kind: 1, relays: ["wss://mock.relay"] })}`;
  await page.goto(directEventPath);
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Original post → 2 replies deep → opened note")).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await expect(page).toHaveURL(/\/feed$/);
  await page.goto("/unsupported/deep-link");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("button", { name: "Go to Feed" }).click();
  await expect(page).toHaveURL(/\/feed$/);
  expect(pageErrors, "login-to-app rendering should not produce React hook or subscription errors").toEqual([]);
  expect(relaySockets, "mock mode must not open live relay WebSockets").toEqual([]);
});

