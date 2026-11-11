// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventTemplate } from "nostr-tools";
import type { NostrEvent } from "../src/types";
import { ProfileEditor } from "../src/components/ProfileEditor";

const mocks = vi.hoisted(() => ({ fetchLatestProfile: vi.fn() }));

vi.mock("../src/lib/nostr", () => ({ fetchLatestProfile: mocks.fetchLatestProfile }));

function event(content: Record<string, unknown>): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: "a".repeat(64),
    created_at: 100,
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
    sig: "2".repeat(128),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((pass, fail) => { resolve = pass; reject = fail; });
  return { promise, resolve, reject };
}

describe("ProfileEditor metadata resolution", () => {
  beforeEach(() => mocks.fetchLatestProfile.mockReset());
  afterEach(cleanup);

  it("waits for a slow relay result when the store starts empty and preserves its unknown fields", async () => {
    const loading = deferred<NostrEvent | undefined>();
    mocks.fetchLatestProfile.mockReturnValue(loading.promise);
    const signedTemplates: EventTemplate[] = [];
    const previous = event({ display_name: "Old name", lud06: "lnurl1keep", custom: { theme: "moss" } });
    const onPublished = vi.fn();
    render(<ProfileEditor
      pubkey={previous.pubkey}
      sign={async (template) => {
        signedTemplates.push(template);
        return { ...previous, ...template, id: "3".repeat(64), sig: "4".repeat(128) };
      }}
      pool={{ publish: async () => [{ from: "wss://write.example", ok: true, message: "saved" }] } as never}
      readRelays={["wss://read.example"]}
      writeRelays={["wss://write.example"]}
      onPublished={onPublished}
    />);

    expect(screen.getByRole("status").textContent).toContain("Loading your latest profile");
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Display name").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(mocks.fetchLatestProfile).toHaveBeenCalledWith(previous.pubkey, ["wss://read.example"], true);

    await act(async () => loading.resolve(previous));
    await waitFor(() => expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Old name"));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(JSON.parse(signedTemplates[0]!.content)).toEqual({
      display_name: "New name",
      lud06: "lnurl1keep",
      custom: { theme: "moss" },
    });
  });

  it("keeps saving unavailable after resolution failure and retries without losing safety", async () => {
    mocks.fetchLatestProfile
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(event({ name: "safe", custom: "preserved" }));
    render(<ProfileEditor
      pubkey={"a".repeat(64)}
      sign={vi.fn()}
      pool={{ publish: vi.fn() } as never}
      readRelays={["wss://read.example"]}
      writeRelays={["wss://write.example"]}
      onPublished={vi.fn()}
    />);

    expect((await screen.findByRole("alert")).textContent).toContain("Retry before saving");
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading profile" }));
    await waitFor(() => expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("safe"));
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
