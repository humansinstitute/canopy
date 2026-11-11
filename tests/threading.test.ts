import { describe, expect, it } from "vitest";
import type { NostrEvent } from "../src/types";
import { buildThreadTree, getReplyContext, navigationTargetForEvent } from "../src/lib/threading";

const ROOT = "1".repeat(64);
const PARENT = "2".repeat(64);
const SELF = "3".repeat(64);

function note(tags: string[][], id = SELF): NostrEvent {
  return { id, pubkey: "a".repeat(64), created_at: 1, kind: 1, tags, content: "note", sig: "b".repeat(128) };
}

function treeNote(id: string, createdAt: number, root?: string, parent?: string): NostrEvent {
  const tags = root ? [["e", root, "", "root"]] : [];
  if (parent && parent !== root) tags.push(["e", parent, "", "reply"]);
  return { ...note(tags, id), created_at: createdAt, content: id.slice(0, 4) };
}

describe("NIP-10 reply context", () => {
  it("ignores standalone and mention-only notes", () => {
    expect(getReplyContext(note([]))).toBeUndefined();
    expect(getReplyContext(note([["e", ROOT, "wss://mention.example", "mention"]]))).toBeUndefined();
  });

  it("uses a root-only marker as both direct parent and navigation root", () => {
    expect(getReplyContext(note([["e", ROOT, "wss://relay.damus.io", "root"]]))).toEqual({
      directParentId: ROOT,
      rootId: ROOT,
      directParentRelayHints: ["wss://relay.damus.io"],
      rootRelayHints: ["wss://relay.damus.io"],
    });
  });

  it("keeps the direct parent distinct from the marked conversation root", () => {
    expect(getReplyContext(note([
      ["e", ROOT, "wss://relay.damus.io", "root"],
      ["e", PARENT, "wss://nos.lol", "reply"],
    ]))).toEqual({
      directParentId: PARENT,
      rootId: ROOT,
      directParentRelayHints: ["wss://nos.lol"],
      rootRelayHints: ["wss://relay.damus.io"],
    });
  });

  it("uses first and last legacy positional e tags as root and parent", () => {
    const context = getReplyContext(note([["e", ROOT], ["e", PARENT, "wss://nos.lol"]]));
    expect(context?.rootId).toBe(ROOT);
    expect(context?.directParentId).toBe(PARENT);
    expect(context?.directParentRelayHints).toEqual(["wss://nos.lol"]);
  });

  it("rejects invalid direct-parent IDs and self references", () => {
    expect(getReplyContext(note([["e", "not-hex", "", "reply"]]))).toBeUndefined();
    expect(getReplyContext(note([["e", SELF, "", "reply"]]))).toBeUndefined();
  });

  it("falls back to the safe direct parent when a marked root is invalid", () => {
    expect(getReplyContext(note([["e", "bad", "", "root"], ["e", PARENT, "", "reply"]]))).toMatchObject({
      directParentId: PARENT,
      rootId: PARENT,
    });
  });
});

describe("thread tree", () => {
  const root = "a".repeat(64);
  const direct = "b".repeat(64);
  const nested = "c".repeat(64);
  const deep = "d".repeat(64);

  it("builds root-first nested branches with stable oldest-first siblings and ancestry", () => {
    const sibling = "e".repeat(64);
    const tree = buildThreadTree([
      treeNote(sibling, 30, root, root),
      treeNote(deep, 40, root, nested),
      treeNote(root, 10),
      treeNote(nested, 35, root, direct),
      treeNote(direct, 20, root, root),
    ], root, deep);
    expect(tree.root?.children.map(({ event }) => event.id)).toEqual([direct, sibling]);
    expect(tree.nodes.get(direct)?.children[0]?.event.id).toBe(nested);
    expect(tree.focusPath).toEqual([root, direct, nested, deep]);
    expect(tree.focusDepth).toBe(3);
    expect(tree.pathComplete).toBe(true);
    expect(tree.root?.descendantCount).toBe(4);
  });

  it("keeps missing-parent, conflicting-root, invalid and cyclic events visible as other replies", () => {
    const missing = "e".repeat(64);
    const orphan = "f".repeat(64);
    const otherRoot = "0".repeat(64);
    const cycleA = "1".repeat(64);
    const cycleB = "2".repeat(64);
    const invalid = { ...treeNote("3".repeat(64), 50), tags: [["e", "bad", "", "reply"]] };
    const tree = buildThreadTree([
      treeNote(root, 1),
      treeNote(orphan, 20, root, missing),
      treeNote(otherRoot, 25, "4".repeat(64), "4".repeat(64)),
      treeNote(cycleA, 30, root, cycleB),
      treeNote(cycleB, 31, root, cycleA),
      invalid,
    ], root, orphan);
    expect(tree.otherReplies.map(({ event }) => event.id)).toEqual([orphan, otherRoot, cycleA, cycleB, invalid.id]);
    expect(tree.nodes.size).toBe(6);
    expect(tree.pathComplete).toBe(false);
    expect(tree.focusDepth).toBeUndefined();
  });

  it("collapses only busy off-path branches by default in a large thread", () => {
    const focus = "5".repeat(64);
    const side = "6".repeat(64);
    const events = [treeNote(root, 1), treeNote(focus, 2, root, root), treeNote(side, 3, root, root)];
    let parent = side;
    for (let index = 0; index < 9; index += 1) {
      const id = (index + 7).toString(16).padStart(64, "0");
      events.push(treeNote(id, 4 + index, root, parent));
      parent = id;
    }
    const tree = buildThreadTree(events, root, focus);
    expect(tree.nodes.size).toBe(12);
    expect(tree.initialCollapsed.has(side)).toBe(true);
    expect(tree.initialCollapsed.has(root)).toBe(false);
    expect(tree.initialCollapsed.has(focus)).toBe(false);
  });

  it("derives a truthful root/focus target and merges relay hints", () => {
    const event = treeNote(nested, 3, root, direct);
    event.tags[0][2] = "wss://relay.damus.io";
    event.tags[1][2] = "wss://nos.lol";
    expect(navigationTargetForEvent(event, ["wss://relay.primal.net"])).toEqual({
      rootId: root,
      focusId: nested,
      relayHints: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
      source: "note",
    });
  });
});
