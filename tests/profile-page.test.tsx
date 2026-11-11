// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "../src/components/ProfilePage";

const mocks = vi.hoisted(() => ({
  contactCleanups: [] as ReturnType<typeof vi.fn>[],
  feedCleanups: [] as ReturnType<typeof vi.fn>[],
  subscribeContactList: vi.fn(),
  subscribeProfileFeed: vi.fn(),
}));

vi.mock("../src/lib/nostr", () => ({
  subscribeContactList: mocks.subscribeContactList,
  subscribeProfileFeed: mocks.subscribeProfileFeed,
}));

vi.mock("../src/components/Avatar", () => ({
  Avatar: () => <div data-testid="avatar" />,
  useProfile: () => ({ name: "Profile", picture: null }),
}));
vi.mock("../src/components/EventCard", () => ({ EventCard: () => null }));
vi.mock("../src/components/ProfileShare", () => ({ ProfileShare: () => null }));

describe("ProfilePage subscriptions", () => {
  beforeEach(() => {
    mocks.contactCleanups.length = 0;
    mocks.feedCleanups.length = 0;
    mocks.subscribeContactList.mockReset().mockImplementation((_pubkey, onEvent) => {
      const unsubscribe = vi.fn();
      mocks.contactCleanups.push(unsubscribe);
      onEvent(undefined);
      return { unsubscribe };
    });
    mocks.subscribeProfileFeed.mockReset().mockImplementation(() => {
      const unsubscribe = vi.fn();
      mocks.feedCleanups.push(unsubscribe);
      return { unsubscribe };
    });
  });

  it("unsubscribes the follow-state listener when the viewed profile changes and on unmount", () => {
    const viewerPubkey = "a".repeat(64);
    const props = {
      viewerPubkey,
      contacts: { setRemote: vi.fn(), setFollowing: vi.fn() } as never,
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
    const view = render(<ProfilePage {...props} pubkey={"b".repeat(64)} />);
    expect(mocks.subscribeContactList).toHaveBeenCalledTimes(1);
    expect(mocks.contactCleanups[0]).not.toHaveBeenCalled();

    view.rerender(<ProfilePage {...props} pubkey={"c".repeat(64)} />);
    expect(mocks.contactCleanups[0]).toHaveBeenCalledOnce();
    expect(mocks.subscribeContactList).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(mocks.contactCleanups[1]).toHaveBeenCalledOnce();
  });

  it("does not create a follow-state subscription for the signed-in user's own profile", () => {
    const pubkey = "a".repeat(64);
    const view = render(<ProfilePage
      pubkey={pubkey}
      viewerPubkey={pubkey}
      contacts={{ setRemote: vi.fn(), setFollowing: vi.fn() } as never}
      readRelays={[]}
      writeRelays={[]}
      blossomServers={[]}
      pool={{ publish: vi.fn() } as never}
      onPublished={vi.fn()}
      onOpenProfile={vi.fn()}
      onOpenThread={vi.fn()}
      zapPreferences={{ amount: 21, message: "" }}
      mock
      onBack={vi.fn()}
    />);
    expect(mocks.subscribeContactList).not.toHaveBeenCalled();
    view.unmount();
  });
});
