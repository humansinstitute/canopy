// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setSessionAccount } from "../src/lib/session";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { LocalPerson } from "../src/lib/local-search";

const people = vi.hoisted(() => {
  const aliceKey = "11".repeat(32);
  const bobKey = "22".repeat(32);
  return [
    { pubkey: aliceKey, npub: "npub1alicecachedidentity", name: "Alice Canopy", username: "alice", searchText: "alice", lastSeen: 2 },
    { pubkey: bobKey, npub: "npub1bobcachedidentity", name: "Bob Garden", username: "bob", searchText: "bob", lastSeen: 1 },
  ] satisfies LocalPerson[];
});

vi.mock("../src/lib/local-search", () => ({
  searchLocalIndex: vi.fn(async (query: string) => ({ people: people.filter((person) => !query || `${person.name} ${person.username} ${person.npub}`.toLowerCase().includes(query.toLowerCase())), posts: [] })),
}));
vi.mock("../src/lib/blossom", () => ({
  uploadImage: vi.fn(async () => ({ url: "https://blossom.example/pasted.png", sha256: "00".repeat(32), size: 3, type: "image/png" })),
}));
vi.mock("../src/components/Avatar", () => ({
  Avatar: () => <span data-testid="avatar" />,
  useProfile: () => ({ name: "Alice Canopy", picture: null }),
}));

import { EnhancedTextarea } from "../src/components/EnhancedTextarea";
import { Composer } from "../src/components/Composer";

function TextareaHarness({ onMention = vi.fn(), maxLength }: { onMention?(mention: { pubkey: string; reference: string }): void; maxLength?: number }) {
  const [value, setValue] = useState("");
  return <EnhancedTextarea id="draft" value={value} onChange={setValue} onMentionSelected={onMention} relayHints={["wss://read.example"]} blossomServers={[]} placeholder="Draft" maxLength={maxLength} />;
}

function setEditor(editor: HTMLElement, value: string, caret = value.length) {
  editor.textContent = value;
  const text = editor.firstChild!;
  const range = document.createRange();
  range.setStart(text, caret);
  range.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  fireEvent.input(editor, { inputType: "insertText" });
}

describe("mention and quote composition", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("selects a cached person by keyboard without losing surrounding draft text", async () => {
    const selected = vi.fn();
    render(<TextareaHarness onMention={selected} />);
    const textarea = screen.getByRole("textbox");
    setEditor(textarea, "Before @ali after", 11);
    const option = await screen.findByRole("option", { name: /Alice Canopy/ });
    expect(option).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(textarea.querySelector(".mention-composer-pill")?.textContent).toBe("@Alice Canopy"));
    expect(textarea.textContent).toBe("Before @Alice Canopy after");
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ pubkey: people[0].pubkey }));
    expect(screen.getByRole("button", { name: "Emoji" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GIF" })).toBeTruthy();
  });

  it("supports touch/click selection from the people list", async () => {
    render(<TextareaHarness />);
    const textarea = screen.getByRole("textbox");
    setEditor(textarea, "@bo");
    const option = await screen.findByRole("option", { name: /Bob Garden/ });
    fireEvent.pointerDown(option, { pointerType: "touch" });
    fireEvent.click(option);
    await waitFor(() => expect(textarea.querySelector(".mention-composer-pill")?.textContent).toBe("@Bob Garden"));
  });

  it("keeps a selected pill while inserting emoji, GIF and pasted Blossom media at its caret", async () => {
    render(<TextareaHarness />);
    const editor = screen.getByRole("textbox");
    setEditor(editor, "@ali");
    await screen.findByRole("option", { name: /Alice Canopy/ });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(editor.querySelector(".mention-composer-pill")?.textContent).toBe("@Alice Canopy"));

    fireEvent.click(screen.getByRole("button", { name: "Emoji" }));
    fireEvent.click(screen.getByTitle(":rocket:"));
    expect(editor.querySelector(".mention-composer-pill")?.textContent).toBe("@Alice Canopy");
    expect(editor.textContent).toContain("🚀");

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ query: { pages: [{ title: "File:Dance.gif", imageinfo: [{ mime: "image/gif", url: "https://upload.wikimedia.org/dance.gif", descriptionurl: "https://commons.wikimedia.org/wiki/File:Dance.gif", size: 123 }] }] } }) })));
    fireEvent.click(screen.getByRole("button", { name: "GIF" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search GIFs" }), { target: { value: "dance" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Dance.gif" }));
    expect(editor.textContent).toContain("https://upload.wikimedia.org/dance.gif");
    expect(editor.querySelector(".mention-composer-pill")?.textContent).toBe("@Alice Canopy");

    const image = new File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
    fireEvent.paste(editor, { clipboardData: { files: [image], items: [], getData: () => "" } });
    await waitFor(() => expect(editor.textContent).toContain("https://blossom.example/pasted.png"));
    expect(editor.querySelector(".mention-composer-pill")?.textContent).toBe("@Alice Canopy");
  });

  it("enforces max length against canonical serialized content, not the short pill label", async () => {
    const reference = "nostr:nprofile1canonical-reference";
    const mention = { pubkey: people[0].pubkey, reference, label: "A" };
    const onChange = vi.fn();
    render(<EnhancedTextarea id="limit" value={reference} mentions={[mention]} onChange={onChange} placeholder="Limited" maxLength={reference.length} />);
    const editor = screen.getByRole("textbox", { name: "Limited" });
    expect(editor.textContent).toBe("@A");
    const text = document.createTextNode("x");
    editor.append(text);
    const range = document.createRange();
    range.setStartAfter(text);
    range.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    fireEvent.input(editor, { inputType: "insertText" });
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.textContent).toBe("@A");
  });

  it("shows and cancels a compact quote preview", () => {
    const quoted = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "A compact source note" }, generateSecretKey());
    const cancel = vi.fn();
    render(<Composer writeRelays={["wss://write.example"]} readRelays={["wss://read.example"]} blossomServers={[]} pool={{ publish: vi.fn() } as never} quote={{ event: quoted, relayHint: "wss://read.example" }} onPublished={vi.fn()} onCancel={cancel} />);
    expect(screen.getByLabelText("Quoting Alice Canopy").textContent).toContain("A compact source note");
    expect(screen.getByRole("button", { name: "Emoji" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GIF" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel quote" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

});


describe("composer publication outcome", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  function signer() {
    const secret = generateSecretKey();
    setSessionAccount(getPublicKey(secret));
    window.nostr = { getPublicKey: async () => getPublicKey(secret), signEvent: vi.fn(async (template) => finalizeEvent(template, secret)) };
  }
  it("continues on first acceptance while another relay hangs and signs only once", async () => {
    signer();
    const published = vi.fn(); const complete = vi.fn();
    const pool = { publish: vi.fn(async ([relay]: string[]) => relay === "fast" ? [{ from: relay, ok: true, message: "saved" }] : new Promise<never>(() => {})) };
    render(<Composer writeRelays={["fast", "hang"]} pool={pool as never} blossomServers={[]} onPublished={published} onComplete={complete} />);
    const editor = screen.getByRole("textbox", { name: "Share a note with Nostr…" });
    setEditor(editor, "continue immediately");
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(published).toHaveBeenCalledTimes(1);
    expect(window.nostr!.signEvent).toHaveBeenCalledTimes(1);
    expect(pool.publish).toHaveBeenCalledTimes(2);
    expect(editor.textContent).toBe("");
  });
  it.each([{ relays: [] as string[] }, { relays: ["reject"] }])("retains the draft and permits retry when no relay accepts: %j", async ({ relays }) => {
    signer(); const published = vi.fn(); const complete = vi.fn();
    const pool = { publish: vi.fn(async ([relay]: string[]) => [{ from: relay, ok: false, message: "denied" }]) };
    render(<Composer writeRelays={relays} pool={pool as never} blossomServers={[]} onPublished={published} onComplete={complete} />);
    const editor = screen.getByRole("textbox", { name: "Share a note with Nostr…" });
    setEditor(editor, "keep my draft");
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));
    await screen.findByText("No relay accepted the post. Your draft is still here.");
    expect(editor.textContent).toBe("keep my draft");
    expect(published).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Post note" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
