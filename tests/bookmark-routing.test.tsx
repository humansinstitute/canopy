// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookmarksPage } from "../src/components/BookmarksPage";

vi.mock("../src/components/BookmarkProvider", () => ({ useBookmarks: () => ({ event: undefined, saved: new Set(), pending: new Set(), errors: new Map(), toggle: vi.fn() }) }));
vi.mock("../src/lib/nostr", () => ({ subscribeDiscovery: vi.fn((_pubkey, _relays, onState) => { onState({ followedPubkeys: [], events: [], truncatedFollows: false }); return { unsubscribe: vi.fn() }; }), getReferencedEvent: vi.fn(), subscribeReferencedEvent: vi.fn(() => ({ unsubscribe: vi.fn() })) }));
vi.mock("../src/components/EventCard", () => ({ EventCard: () => null }));

describe("bookmark route tabs", () => {
  it("renders the selected saved subroute and requests URL-backed tab changes", () => {
    const onViewChange = vi.fn();
    const props = { pubkey: "11".repeat(32), view: "highlights" as const, onViewChange, readRelays: [], writeRelays: [], blossomServers: [], pool: { publish: vi.fn() } as never, onPublished: vi.fn(), onOpenProfile: vi.fn(), onOpenThread: vi.fn(), zapPreferences: { amount: 21, message: "" }, mock: true };
    render(<BookmarksPage {...props} />);
    expect(screen.getByRole("tab", { name: "Highlights" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "LookMarks" }));
    expect(onViewChange).toHaveBeenCalledWith("lookmarks");
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    expect(onViewChange).toHaveBeenCalledWith("bookmarks");
  });
});
