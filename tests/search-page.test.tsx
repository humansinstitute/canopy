// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import { CacheStatus, SearchPage } from "../src/components/SearchPage";

vi.mock("../src/lib/local-search", () => ({
  searchLocalIndex: vi.fn(async () => ({ people: [], posts: [] })),
  localIndexStats: vi.fn(async () => ({ people: 0, posts: 0, estimatedIndexBytes: 0 })),
  onLocalIndexChange: vi.fn(() => () => undefined),
  upsertLocalIdentity: vi.fn(async () => undefined),
}));
vi.mock("../src/components/Avatar", () => ({ Avatar: () => null, useProfile: () => ({ name: "Profile", picture: null }) }));

describe("SearchPage exact identity action", () => {
  it("resolves only on submit and opens the canonical pubkey", async () => {
    const pubkey = "56".repeat(32);
    const npub = nip19.npubEncode(pubkey);
    const resolveIdentity = vi.fn(async (identity) => ({ identity, metadataFound: true, relays: [] }));
    const onOpenProfile = vi.fn();
    render(<SearchPage readRelays={["wss://read.example"]} mock onOpenProfile={onOpenProfile} onOpenThread={vi.fn()} resolveIdentity={resolveIdentity} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: npub } });
    expect(resolveIdentity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open identity" }));
    await waitFor(() => expect(resolveIdentity).toHaveBeenCalledOnce());
    await waitFor(() => expect(onOpenProfile).toHaveBeenCalledWith(pubkey));
  });

  it("shows retained successful cache state, progress/error, and forces one manual refresh", () => {
    vi.spyOn(Date, "now").mockReturnValue(10 * 24 * 60 * 60 * 1_000);
    const onRefresh = vi.fn();
    const { rerender } = render(<CacheStatus status={{
      version: 1,
      followedPubkeys: ["a".repeat(64), "b".repeat(64)],
      followingSyncedAt: Date.now() - 2 * 24 * 60 * 60 * 1_000,
      profilesRefreshedAt: Date.now() - 60 * 60 * 1_000,
      lastAttempt: { at: Date.now(), stage: "following", error: "Read relays timed out." },
      phase: "idle",
      pendingForce: false,
    }} onRefresh={onRefresh} />);
    expect(screen.getByText("2 days ago")).toBeTruthy();
    expect(screen.getByText("1 hr ago")).toBeTruthy();
    expect(screen.getByText("2", { selector: "dd" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("previous cache is still available");
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<CacheStatus status={{ version: 1, followedPubkeys: [], phase: "profiles", progress: { completed: 1, total: 3, profiles: 20 }, pendingForce: false }} onRefresh={onRefresh} />);
    expect((screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Refreshing profile batch 2 of 3/).textContent).toContain("batch 2 of 3");
    vi.restoreAllMocks();
  });
});
