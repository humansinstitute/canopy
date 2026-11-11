import type { MentionQuery, SelectedMention } from "./composer";

const TOKEN_SELECTOR = "[data-mention-token]";

function tokenValue(node: Node | null): string {
  return node instanceof HTMLElement && node.matches(TOKEN_SELECTOR) ? node.dataset.mentionToken ?? "" : "";
}

export function createMentionPill(document: Document, mention: SelectedMention): HTMLElement {
  const pill = document.createElement("span");
  const label = mention.label?.trim() || "Nostr user";
  pill.className = "mention-composer-pill";
  pill.contentEditable = "false";
  pill.dataset.mentionToken = mention.reference;
  pill.dataset.mentionPubkey = mention.pubkey;
  pill.dataset.mentionLabel = label;
  pill.setAttribute("role", "img");
  pill.setAttribute("aria-label", `Mention ${label}`);
  pill.textContent = `@${label}`;
  return pill;
}

function serializeNode(node: Node, root?: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  const token = tokenValue(node);
  if (token) return token;
  if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return "";
  if (node instanceof HTMLBRElement) return "\n";
  const content = [...node.childNodes].map((child) => serializeNode(child, root)).join("");
  return node !== root && node instanceof HTMLDivElement && !content.endsWith("\n") ? `${content}\n` : content;
}

export function serializeMentionEditor(root: HTMLElement | DocumentFragment): string {
  let value = "";
  for (const node of root.childNodes) {
    if (node instanceof HTMLDivElement && value && !value.endsWith("\n")) value += "\n";
    value += serializeNode(node, root);
  }
  return value.replace(/\n$/, "");
}

export function hydrateMentionEditor(root: HTMLElement, value: string, mentions: Iterable<SelectedMention>): void {
  const document = root.ownerDocument;
  const byReference = new Map([...mentions].map((mention) => [mention.reference, mention]));
  const references = [...byReference.keys()].sort((left, right) => right.length - left.length);
  const fragment = document.createDocumentFragment();
  if (!references.length) {
    fragment.append(document.createTextNode(value));
  } else {
    const pattern = new RegExp(references.map(escapeRegExp).join("|"), "g");
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      if (match.index! > cursor) fragment.append(document.createTextNode(value.slice(cursor, match.index)));
      fragment.append(createMentionPill(document, byReference.get(match[0])!));
      cursor = match.index! + match[0].length;
    }
    if (cursor < value.length) fragment.append(document.createTextNode(value.slice(cursor)));
  }
  root.replaceChildren(fragment);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectionRange(root: HTMLElement): Range | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return undefined;
  const element = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  if (element?.closest(TOKEN_SELECTOR)) return undefined;
  return range;
}

export function mentionEditorCaretOffset(root: HTMLElement): number {
  return mentionEditorSelectionOffsets(root)[1];
}

function offsetBefore(root: HTMLElement, container: Node, offset: number): number {
  const before = root.ownerDocument.createRange();
  before.selectNodeContents(root);
  before.setEnd(container, offset);
  return serializeMentionEditor(before.cloneContents()).length;
}

export function mentionEditorSelectionOffsets(root: HTMLElement): [number, number] {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) {
    const end = serializeMentionEditor(root).length;
    return [end, end];
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    const end = serializeMentionEditor(root).length;
    return [end, end];
  }
  return [offsetBefore(root, range.startContainer, range.startOffset), offsetBefore(root, range.endContainer, range.endOffset)];
}

export function mentionQueryAtSelection(root: HTMLElement): MentionQuery | undefined {
  const range = selectionRange(root);
  if (!range) return undefined;
  const prefix = serializeMentionEditor(root).slice(0, mentionEditorCaretOffset(root));
  const match = prefix.match(/(?:^|\s)@([^\s@]{0,96})$/u);
  if (!match) return undefined;
  const typed = `@${match[1]}`;
  return { start: prefix.length - typed.length, end: prefix.length, query: match[1] };
}

interface Boundary { node: Node; offset: number }

function childIndex(node: Node): number {
  let index = 0;
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) index += 1;
  return index;
}

function boundaryForOffset(root: HTMLElement, requested: number): Boundary {
  let remaining = Math.max(0, requested);
  const visit = (node: Node): Boundary | undefined => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      return undefined;
    }
    const token = tokenValue(node);
    if (token) {
      if (remaining === 0) return { node: node.parentNode!, offset: childIndex(node) };
      remaining -= token.length;
      if (remaining <= 0) return { node: node.parentNode!, offset: childIndex(node) + 1 };
      return undefined;
    }
    if (node instanceof HTMLBRElement) {
      if (remaining === 0) return { node: node.parentNode!, offset: childIndex(node) };
      remaining -= 1;
      return undefined;
    }
    for (const child of node.childNodes) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(root) ?? { node: root, offset: root.childNodes.length };
}

export function replaceMentionEditorRange(root: HTMLElement, start: number, end: number, replacement: string | Node | Array<string | Node>): void {
  const document = root.ownerDocument;
  const range = document.createRange();
  const startBoundary = boundaryForOffset(root, start);
  const endBoundary = boundaryForOffset(root, end);
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  range.deleteContents();
  let last: Node | undefined;
  for (const item of Array.isArray(replacement) ? replacement : [replacement]) {
    last = typeof item === "string" ? document.createTextNode(item) : item;
    range.insertNode(last);
    range.setStartAfter(last);
    range.collapse(true);
  }
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function setMentionEditorCaret(root: HTMLElement, offset: number): void {
  const boundary = boundaryForOffset(root, offset);
  const range = root.ownerDocument.createRange();
  range.setStart(boundary.node, boundary.offset);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function insertMentionPill(root: HTMLElement, query: MentionQuery, mention: SelectedMention): void {
  const content = serializeMentionEditor(root);
  const trailingSpace = content.slice(query.end).startsWith(" ") ? "" : " ";
  replaceMentionEditorRange(root, query.start, query.end, [createMentionPill(root.ownerDocument, mention), trailingSpace]);
}

export function insertTextAtMentionEditorSelection(root: HTMLElement, text: string): void {
  const range = selectionRange(root);
  if (!range) {
    root.append(root.ownerDocument.createTextNode(text));
    return;
  }
  range.deleteContents();
  const node = root.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function adjacentNode(root: HTMLElement, range: Range, direction: "backward" | "forward"): Node | undefined {
  if (range.startContainer === root) return root.childNodes[range.startOffset + (direction === "backward" ? -1 : 0)];
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const length = range.startContainer.nodeValue?.length ?? 0;
    const atEdge = direction === "backward" ? range.startOffset === 0 : range.startOffset === length;
    if (!atEdge) return undefined;
    return direction === "backward" ? range.startContainer.previousSibling ?? undefined : range.startContainer.nextSibling ?? undefined;
  }
  return undefined;
}

export function removeAdjacentMentionPill(root: HTMLElement, direction: "backward" | "forward"): boolean {
  const range = selectionRange(root);
  if (!range) return false;
  const candidate = adjacentNode(root, range, direction);
  if (!tokenValue(candidate ?? null)) return false;
  const next = root.ownerDocument.createRange();
  next.setStartBefore(candidate!);
  next.collapse(true);
  candidate!.parentNode?.removeChild(candidate!);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(next);
  return true;
}

export function selectedPlainText(root: HTMLElement): string | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return undefined;
  return serializeMentionEditor(range.cloneContents());
}
