// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { activeMentionPubkeys, type SelectedMention } from "../src/lib/composer";
import { createMentionPill, hydrateMentionEditor, insertTextAtMentionEditorSelection, mentionQueryAtSelection, removeAdjacentMentionPill, serializeMentionEditor, setMentionEditorCaret } from "../src/lib/mention-editor";

const alice: SelectedMention = { pubkey: "11".repeat(32), reference: "nostr:nprofile1alice", label: "Alice" };
const bob: SelectedMention = { pubkey: "22".repeat(32), reference: "nostr:nprofile1bob", label: "Bob" };

function root() {
  const element = document.createElement("div");
  element.contentEditable = "true";
  document.body.append(element);
  return element;
}

describe("atomic mention editor", () => {
  it("hydrates and serializes several selected pills and line breaks exactly", () => {
    const editor = root();
    const value = `Hello ${alice.reference}\nthen ${bob.reference}!`;
    hydrateMentionEditor(editor, value, [alice, bob]);
    expect([...editor.querySelectorAll(".mention-composer-pill")].map((pill) => pill.textContent)).toEqual(["@Alice", "@Bob"]);
    expect(editor.textContent).not.toContain("nostr:nprofile");
    expect(serializeMentionEditor(editor)).toBe(value);
  });

  it("normalizes browser block and br line-break DOM without losing lines", () => {
    const editor = root();
    editor.append(document.createTextNode("first"));
    const second = document.createElement("div");
    second.textContent = "second";
    const blank = document.createElement("div");
    blank.append(document.createElement("br"));
    const fourth = document.createElement("div");
    fourth.textContent = "fourth";
    editor.append(second, blank, fourth);
    expect(serializeMentionEditor(editor)).toBe("first\nsecond\n\nfourth");
  });

  it("keeps raw references as ordinary text and never starts a query inside a pill", () => {
    const editor = root();
    hydrateMentionEditor(editor, alice.reference, []);
    expect(editor.querySelector(".mention-composer-pill")).toBeNull();
    expect(editor.textContent).toBe(alice.reference);
    editor.replaceChildren(createMentionPill(document, alice));
    const pillText = editor.firstChild!.firstChild!;
    const range = document.createRange();
    range.setStart(pillText, 2);
    range.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(mentionQueryAtSelection(editor)).toBeUndefined();
  });

  it("removes an adjacent pill atomically with Backspace or Delete semantics", () => {
    for (const direction of ["backward", "forward"] as const) {
      const editor = root();
      const before = document.createTextNode("before ");
      const pill = createMentionPill(document, alice);
      const after = document.createTextNode(" after");
      editor.append(before, pill, after);
      const range = document.createRange();
      range.setStart(direction === "backward" ? after : before, direction === "backward" ? 0 : before.length);
      range.collapse(true);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
      expect(removeAdjacentMentionPill(editor, direction)).toBe(true);
      expect(editor.querySelector(".mention-composer-pill")).toBeNull();
      expect(serializeMentionEditor(editor)).toBe("before  after");
      expect(activeMentionPubkeys(serializeMentionEditor(editor), [alice])).toEqual([]);
    }
  });

  it("moves the caret around a pill and inserts ordinary text on either side", () => {
    const editor = root();
    hydrateMentionEditor(editor, alice.reference, [alice]);
    setMentionEditorCaret(editor, 0);
    insertTextAtMentionEditorSelection(editor, "Hi ");
    setMentionEditorCaret(editor, serializeMentionEditor(editor).length);
    insertTextAtMentionEditorSelection(editor, " there");
    expect(serializeMentionEditor(editor)).toBe(`Hi ${alice.reference} there`);
    expect(editor.querySelector(".mention-composer-pill")?.textContent).toBe("@Alice");
  });

  it("serializes copied pill selections as portable plain text", () => {
    const editor = root();
    hydrateMentionEditor(editor, `x ${alice.reference} y`, [alice]);
    expect(serializeMentionEditor(editor)).toBe(`x ${alice.reference} y`);
  });
});
