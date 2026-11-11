import { expect, test } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";

test("desktop reconnects through window.nostr and refreshes the followed feed", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const ownerSecret = generateSecretKey();
  const ownerPubkey = getPublicKey(ownerSecret);
  const authorSecret = generateSecretKey();
  const authorPubkey = getPublicKey(authorSecret);
  const now = Math.floor(Date.now() / 1000);
  const desktopRoot = finalizeEvent({ kind: 1, created_at: now - 40, tags: [], content: "Desktop conversation root" }, ownerSecret);
  const followedNote = finalizeEvent({
    kind: 1,
    created_at: now - 30,
    tags: [
      ["imeta", "url https://blossom.example/image-hash", "m image/jpeg"],
      ["imeta", "url https://blossom.example/video-hash", "m video/mp4"],
      ["e", desktopRoot.id, "wss://relay.damus.io", "root"],
    ],
    content: "Already in the followed feed https://blossom.example/image-hash https://blossom.example/video-hash",
  }, authorSecret);
  const bookmarkList = finalizeEvent({ kind: 10003, created_at: now - 29, tags: [["e", followedNote.id, "wss://desktop.example"], ["x", "desktop-extension"]], content: "desktop-private-content" }, ownerSecret);
  const seeded = [
    finalizeEvent({ kind: 3, created_at: now - 60, tags: [["p", authorPubkey, "wss://desktop.example", "Friend"], ["x", "desktop-contact"]], content: "desktop-contact-content" }, ownerSecret),
    finalizeEvent({ kind: 10002, created_at: now - 59, tags: [["r", "wss://desktop.example"]], content: "" }, ownerSecret),
    finalizeEvent({ kind: 0, created_at: now - 58, tags: [], content: JSON.stringify({ display_name: "Desktop Friend" }) }, authorSecret),
    finalizeEvent({ kind: 0, created_at: now - 57, tags: [], content: JSON.stringify({ display_name: "Desktop Owner", lud06: "lnurl1desktop", custom: "preserve" }) }, ownerSecret),
    desktopRoot,
    followedNote,
    bookmarkList,
    finalizeEvent({ kind: 9802, created_at: now - 20, tags: [["e", followedNote.id], ["comment", "Desktop followed highlight"]], content: "Already in the followed feed" }, authorSecret),
    finalizeEvent({ kind: 7, created_at: now - 19, tags: [["e", followedNote.id]], content: "👀" }, authorSecret),
  ];
  const latest = finalizeEvent({ kind: 1, created_at: now, tags: [], content: "Fetched after clicking refresh" }, authorSecret);
  const signedTemplates: EventTemplate[] = [];

  await page.exposeFunction("signCanopyEvent", (template: EventTemplate) => { signedTemplates.push(template); return finalizeEvent(template, ownerSecret); });
  await page.addInitScript(({ pubkey, events }) => {
    window.__CANOPY_MOCK__ = true;
    window.__CANOPY_EVENTS__ = events;
    window.nostr = {
      getPublicKey: async () => pubkey,
      getRelays: async () => ({ "wss://desktop.example": { read: true, write: true } }),
      signEvent: (template) => (window as unknown as { signCanopyEvent(t: EventTemplate): Promise<ReturnType<typeof finalizeEvent>> }).signCanopyEvent(template),
    };
  }, { pubkey: ownerPubkey, events: seeded });
  await page.route("https://blossom.example/image-hash", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#456b53"/></svg>',
  }));
  await page.route("https://blossom.example/video-hash", (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from([]) }));

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Nostr" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByText("Already in the followed feed")).toBeVisible();
  const desktopCard = page.getByTestId("event-card").first();
  await expect(desktopCard.getByRole("button", { name: "Replying to Desktop Owner. Open conversation" })).toBeVisible();
  await desktopCard.getByRole("button", { name: "Replying to Desktop Owner. Open conversation" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page).toHaveURL(/\/event\/nevent1/);
  await expect(page.getByText("Opened here")).toBeVisible();
  await expect(page.getByText("Original post → 1 reply deep → opened note")).toBeVisible();
  const desktopThread = page.getByRole("region", { name: "Message thread" }).getByTestId("event-card");
  await expect(desktopThread).toHaveCount(2);
  await expect(desktopThread.nth(0)).toContainText("Desktop conversation root");
  await expect(desktopThread.nth(1)).toContainText("Already in the followed feed");
  await page.getByRole("button", { name: "Back from thread" }).click();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  const desktopZap = desktopCard.getByRole("button", { name: "Zap note" });
  await expect(desktopCard.locator(".event-actions svg")).toHaveCount(6);
  await desktopCard.getByRole("button", { name: "Reply to note" }).click();
  const desktopReply = desktopCard.getByRole("textbox", { name: "Write a reply…" });
  await desktopReply.fill("Hello @owner");
  await desktopCard.getByRole("option", { name: /Desktop Owner/ }).click();
  await expect(desktopReply.locator(".mention-composer-pill")).toHaveText("@Desktop Owner");
  await expect(desktopReply).not.toContainText("nostr:nprofile");
  await desktopReply.pressSequentially("from desktop");
  await desktopCard.getByRole("button", { name: "Publish reply" }).click();
  await expect(desktopCard.getByRole("textbox", { name: "Write a reply…" })).toHaveCount(0);
  const desktopMentionReply = signedTemplates.findLast((template) => template.kind === 1)!;
  expect(desktopMentionReply.tags.filter(([name, value]) => name === "p" && value === ownerPubkey)).toHaveLength(1);
  expect(desktopMentionReply.tags.filter(([name, value]) => name === "p" && value === authorPubkey)).toHaveLength(1);

  await desktopCard.getByRole("button", { name: "Quote note" }).click();
  await expect(desktopCard.getByLabel("Quoting Desktop Friend")).toContainText("Already in the followed feed");
  await desktopCard.getByRole("button", { name: "Cancel quote" }).click();
  await expect(desktopCard.getByLabel("Quoting Desktop Friend")).toHaveCount(0);
  await desktopCard.getByRole("button", { name: "Quote note" }).click();
  await desktopCard.getByRole("textbox", { name: "Add a comment (optional)…" }).fill("Desktop quote");
  await desktopCard.getByRole("button", { name: "Publish quote" }).click();
  await expect(desktopCard.getByText("Quote published.")).toBeVisible();
  const desktopQuote = signedTemplates.findLast((template) => template.kind === 1)!;
  expect(desktopQuote.tags.find(([name]) => name === "q")).toEqual(["q", followedNote.id, "wss://desktop.example", authorPubkey]);
  expect(nip19.decode(desktopQuote.content.split("\n\n").at(-1)!.slice(6))).toMatchObject({ type: "nevent", data: { id: followedNote.id, author: authorPubkey } });
  const zapSignatureCount = signedTemplates.filter((template) => template.kind === 9734).length;
  await desktopZap.dispatchEvent("contextmenu");
  await expect(desktopCard.getByLabel("Zap amount in sats")).toHaveValue("21");
  await expect(desktopCard.getByLabel("Zap message")).toHaveValue("");
  await desktopZap.dispatchEvent("click");
  await page.waitForTimeout(50);
  expect(signedTemplates.filter((template) => template.kind === 9734)).toHaveLength(zapSignatureCount);
  await desktopCard.getByRole("button", { name: "Reply to note" }).click();
  await desktopCard.getByRole("button", { name: "Reply to note" }).click();
  await page.getByTestId("event-card").first().getByRole("button", { name: "View Desktop Friend's profile" }).click();
  await expect(page.getByRole("button", { name: "Following", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/profile/${nip19.npubEncode(authorPubkey)}$`));
  await page.getByRole("button", { name: "Following", exact: true }).click();
  await expect(page.getByText("Unfollowed.")).toBeVisible();
  const desktopContact = signedTemplates.findLast((template) => template.kind === 3);
  expect(desktopContact?.content).toBe("desktop-contact-content");
  expect(desktopContact?.tags).toEqual([["x", "desktop-contact"]]);
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByText("Following.")).toBeVisible();
  await page.getByRole("button", { name: "Back from profile" }).click();
  await page.getByRole("button", { name: /Open account options/ }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  const profileEditor = page.getByRole("dialog", { name: "Edit profile" });
  await expect(profileEditor.getByLabel("Display name")).toHaveValue("Desktop Owner");
  await profileEditor.getByLabel("Display name").fill("Desktop Owner Updated");
  await profileEditor.getByLabel("Picture URL").fill("https://images.example/owner.jpg");
  await profileEditor.getByRole("button", { name: "Save profile" }).click();
  await expect(profileEditor.getByText(/Profile saved to 1 relay/)).toBeVisible();
  const desktopProfile = signedTemplates.findLast((template) => template.kind === 0);
  expect(desktopProfile?.tags).toEqual([]);
  expect(JSON.parse(desktopProfile!.content)).toMatchObject({ display_name: "Desktop Owner Updated", picture: "https://images.example/owner.jpg", lud06: "lnurl1desktop", custom: "preserve" });
  await page.getByRole("button", { name: "Close Edit profile" }).click();
  await page.getByRole("button", { name: "Open image attached to this note" }).click();
  await expect(page.getByRole("dialog", { name: "Image viewer" })).toBeVisible();
  await page.getByRole("button", { name: "Close media viewer" }).click();
  await page.getByRole("button", { name: "Play video attached to this note" }).click();
  const videoViewer = page.getByRole("dialog", { name: "Video player" });
  await expect(videoViewer).toBeVisible();
  await expect(videoViewer.getByRole("button", { name: "Mute", exact: true })).toBeVisible();
  await expect(videoViewer.locator("video")).toHaveAttribute("src", "https://blossom.example/video-hash");
  await page.getByRole("button", { name: "Close media viewer" }).click();

  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNav.getByRole("button")).toHaveCount(5);
  const navBounds = await primaryNav.boundingBox();
  const searchBounds = await primaryNav.getByRole("button", { name: "Search" }).boundingBox();
  const postBounds = await primaryNav.getByRole("button", { name: "Create post" }).boundingBox();
  const bookmarkBounds = await primaryNav.getByRole("button", { name: "Bookmarks" }).boundingBox();
  expect(navBounds!.width).toBeGreaterThanOrEqual(420);
  expect(postBounds!.x - (searchBounds!.x + searchBounds!.width)).toBeGreaterThan(10);
  expect(bookmarkBounds!.x - (postBounds!.x + postBounds!.width)).toBeGreaterThan(10);

  await primaryNav.getByRole("button", { name: "Bookmarks" }).click();
  await expect(page).toHaveURL(/\/saved\/bookmarks$/);
  const personal = page.getByRole("region", { name: "Personal bookmarks" });
  await expect(personal.getByText("Already in the followed feed", { exact: false })).toBeVisible();
  await personal.getByRole("button", { name: "Remove bookmark" }).click();
  await expect(page.getByText("No public note bookmarks")).toBeVisible();
  expect(signedTemplates.findLast((template) => template.kind === 10003)?.tags).toContainEqual(["x", "desktop-extension"]);
  await page.getByRole("tab", { name: "Highlights" }).click();
  await expect(page).toHaveURL(/\/saved\/highlights$/);
  await expect(page.getByRole("region", { name: "Network highlights" })).toContainText("Desktop followed highlight");
  await page.getByRole("button", { name: "Open source note" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await page.getByRole("tab", { name: "LookMarks" }).click();
  await expect(page).toHaveURL(/\/saved\/lookmarks$/);
  await expect(page.getByRole("region", { name: "Network LookMarks" })).toContainText("reaction");
  await page.getByRole("button", { name: "Open target" }).click();
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await expect(page.getByText("Already in the followed feed", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Back from thread" }).click();
  await primaryNav.getByRole("button", { name: "Home" }).click();
  const saveBookmark = page.getByTestId("event-card").first().getByRole("button", { name: "Bookmark note" });
  await saveBookmark.click();
  await expect(page.getByTestId("event-card").first().getByRole("button", { name: "Remove bookmark" })).toHaveText("Saved");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find your signal." })).toHaveCount(0);

  await page.evaluate((event) => window.__CANOPY_EVENTS__?.push(event), latest);
  const refresh = page.getByRole("button", { name: "Refresh feed" });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.getByRole("button", { name: "Refreshing feed" })).toBeDisabled();
  await expect(page.getByText("Fetched after clicking refresh")).toBeVisible();
  await expect(page.getByTestId("event-card")).toHaveCount(2);
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search Canopy" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/search$/);
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await page.goto("/saved/lookmarks");
  await expect(page.getByRole("region", { name: "Network LookMarks" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/saved\/lookmarks$/);
  const profilePath = `/profile/${nip19.npubEncode(authorPubkey)}`;
  await page.goto(profilePath);
  await expect(page.getByRole("heading", { name: "Desktop Friend" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${profilePath}$`));
  const eventPath = `/event/${nip19.neventEncode({ id: followedNote.id, author: authorPubkey, kind: 1, relays: ["wss://desktop.example"] })}`;
  await page.goto(eventPath);
  await expect(page.getByRole("heading", { name: "Message thread" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Already in the followed feed", { exact: false })).toBeVisible();
  await page.goto("/saved/not-a-view");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(pageErrors, "login-to-app rendering should not produce React hook or subscription errors").toEqual([]);
});
