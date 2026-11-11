// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "../src/types";
import { ThreadView } from "../src/components/ThreadView";

const mocks = vi.hoisted(() => ({
  events: [] as NostrEvent[],
  focus: undefined as NostrEvent | undefined,
  subscribeThread: vi.fn(),
  subscribeReferencedEvent: vi.fn(),
}));

vi.mock("../src/lib/nostr", () => ({
  subscribeThread: mocks.subscribeThread,
  subscribeReferencedEvent: mocks.subscribeReferencedEvent,
}));
vi.mock("../src/components/EventCard", () => ({
  EventCard: ({ event }: { event: NostrEvent }) => <article data-testid="event-card"><span>{event.content}</span><button type="button">Like note</button></article>,
}));

const root = "a".repeat(64);
const focus = "b".repeat(64);
const side = "c".repeat(64);

function note(id: string, createdAt: number, parent?: string): NostrEvent {
  const tags = parent ? [["e", root, "", "root"], ...(parent === root ? [] : [["e", parent, "", "reply"]])] : [];
  return { id, pubkey: "d".repeat(64), created_at: createdAt, kind: 1, tags, content: `note-${id.slice(0, 4)}`, sig: "e".repeat(128) };
}

function props() {
  return {
    target: { rootId: root, focusId: focus, relayHints: [], source: "notification" as const },
    readRelays: ["wss://read.example"],
    writeRelays: ["wss://write.example"],
    blossomServers: [],
    pool: { publish: vi.fn() } as never,
    onPublished: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenThread: vi.fn(),
    zapPreferences: { amount: 21, message: "" },
    mock: true,
    onBack: vi.fn(),
  };
}

describe("ThreadView tree controls", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.events = [];
    mocks.focus = undefined;
    mocks.subscribeThread.mockReset().mockImplementation((_root, _relays, onEvents) => {
      onEvents(mocks.events);
      return { unsubscribe: vi.fn() };
    });
    mocks.subscribeReferencedEvent.mockReset().mockImplementation((_pointer, _relays, onEvent) => {
      onEvent(mocks.focus);
      return { unsubscribe: vi.fn() };
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("marks and scrolls the exact notification focus while preserving card actions", async () => {
    mocks.events = [note(root, 1), note(focus, 2, root)];
    mocks.focus = mocks.events[1];
    render(<ThreadView {...props()} />);
    expect(await screen.findByText("From notification")).toBeTruthy();
    expect(screen.getByText("Original post → 1 reply deep → opened note")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Like note" })).toHaveLength(2);
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it("defaults a busy off-path branch closed and supports branch and thread-level buttons", async () => {
    const events = [note(root, 1), note(focus, 2, root), note(side, 3, root)];
    let parent = side;
    for (let index = 0; index < 9; index += 1) {
      const id = (index + 1).toString(16).padStart(64, "0");
      events.push(note(id, index + 4, parent));
      parent = id;
    }
    mocks.events = events;
    mocks.focus = events[1];
    render(<ThreadView {...props()} />);
    const sideToggle = await screen.findByRole("button", { name: /Expand replies to this note: 1 direct reply, 9 total/ });
    expect(sideToggle.tagName).toBe("BUTTON");
    expect(sideToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(sideToggle);
    expect(sideToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse side branches" }));
    expect((await screen.findByRole("button", { name: /Expand replies to this note: 1 direct reply, 9 total/ })).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect((await screen.findByRole("button", { name: /Collapse replies to this note: 1 direct reply, 9 total/ })).getAttribute("aria-expanded")).toBe("true");
  });
});
