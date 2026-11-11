import { getNip10References } from "applesauce-common/helpers/threading";
import type { NostrEvent } from "../types";
import { uniqueRelays } from "./relays";

const EVENT_ID = /^[0-9a-f]{64}$/i;

export interface ReplyContext {
  directParentId: string;
  rootId: string;
  directParentRelayHints: string[];
  rootRelayHints: string[];
}

export type ThreadEntrySource = "note" | "notification";

export interface ThreadNavigationTarget {
  rootId: string;
  focusId: string;
  relayHints: string[];
  source?: ThreadEntrySource;
}

export type OpenThread = (target: ThreadNavigationTarget) => void;

export interface ThreadTreeNode {
  event: NostrEvent;
  parentId?: string;
  children: ThreadTreeNode[];
  descendantCount: number;
}

export interface ThreadTree {
  root?: ThreadTreeNode;
  otherReplies: ThreadTreeNode[];
  nodes: Map<string, ThreadTreeNode>;
  focusPath: string[];
  focusDepth?: number;
  pathComplete: boolean;
  initialCollapsed: Set<string>;
  replyCount: number;
}

function validPointer(pointer: { id: string; relays?: string[] } | undefined, eventId: string) {
  if (!pointer || !EVENT_ID.test(pointer.id) || pointer.id.toLowerCase() === eventId.toLowerCase()) return undefined;
  return { id: pointer.id.toLowerCase(), relays: uniqueRelays(pointer.relays ?? []) };
}

/**
 * Return safe NIP-10 event references for a kind-1 reply. Applesauce owns marker
 * and legacy positional interpretation; Canopy adds strict event-id and
 * self-reference validation before using those references for navigation.
 */
export function getReplyContext(event: NostrEvent): ReplyContext | undefined {
  if (event.kind !== 1) return undefined;
  const references = getNip10References(event);
  const parent = validPointer(references.reply?.e, event.id);
  if (!parent) return undefined;
  const root = validPointer(references.root?.e, event.id) ?? parent;
  return {
    directParentId: parent.id,
    rootId: root.id,
    directParentRelayHints: parent.relays,
    rootRelayHints: root.relays,
  };
}

export function navigationTargetForEvent(event: NostrEvent, relayHints: string[] = [], source: ThreadEntrySource = "note"): ThreadNavigationTarget {
  const context = getReplyContext(event);
  return {
    rootId: context?.rootId ?? event.id,
    focusId: event.id,
    relayHints: uniqueRelays([...(context?.rootRelayHints ?? []), ...(context?.directParentRelayHints ?? []), ...relayHints]),
    source,
  };
}

function eventOrder(left: NostrEvent, right: NostrEvent): number {
  return left.created_at - right.created_at || left.id.localeCompare(right.id);
}

function createsCycle(childId: string, parentId: string, parents: Map<string, string>): boolean {
  const visited = new Set([childId]);
  let current: string | undefined = parentId;
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = parents.get(current);
  }
  return false;
}

function countDescendants(node: ThreadTreeNode): number {
  node.descendantCount = node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
  return node.descendantCount;
}

/** Build a deterministic, cycle-safe tree without hiding disconnected replies. */
export function buildThreadTree(events: NostrEvent[], rootId: string, focusId: string): ThreadTree {
  const normalizedRoot = rootId.toLowerCase();
  const normalizedFocus = focusId.toLowerCase();
  const unique = new Map<string, NostrEvent>();
  for (const event of events) {
    const id = event.id.toLowerCase();
    if (event.kind === 1 && EVENT_ID.test(id) && !unique.has(id)) unique.set(id, { ...event, id });
  }

  const nodes = new Map<string, ThreadTreeNode>();
  [...unique.values()].sort(eventOrder).forEach((event) => nodes.set(event.id, { event, children: [], descendantCount: 0 }));
  const candidateParents = new Map<string, string>();
  for (const event of unique.values()) {
    if (event.id === normalizedRoot) continue;
    const context = getReplyContext(event);
    if (context?.rootId === normalizedRoot && nodes.has(context.directParentId)) candidateParents.set(event.id, context.directParentId);
  }

  for (const [childId, parentId] of candidateParents) {
    if (createsCycle(childId, parentId, candidateParents)) continue;
    const child = nodes.get(childId);
    const parent = nodes.get(parentId);
    if (!child || !parent) continue;
    child.parentId = parentId;
    parent.children.push(child);
  }
  for (const node of nodes.values()) node.children.sort((left, right) => eventOrder(left.event, right.event));

  const root = nodes.get(normalizedRoot);
  const topLevel = [...nodes.values()].filter((node) => !node.parentId && node !== root).sort((left, right) => eventOrder(left.event, right.event));
  if (root) countDescendants(root);
  topLevel.forEach(countDescendants);

  const reversePath: string[] = [];
  const pathVisited = new Set<string>();
  let cursor = nodes.get(normalizedFocus);
  while (cursor && !pathVisited.has(cursor.event.id)) {
    reversePath.push(cursor.event.id);
    pathVisited.add(cursor.event.id);
    cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
  }
  const focusPath = reversePath.reverse();
  const pathComplete = Boolean(root && focusPath[0] === normalizedRoot && focusPath.at(-1) === normalizedFocus);
  const focusDepth = pathComplete ? focusPath.length - 1 : undefined;
  const focusPathSet = new Set(focusPath);
  const initialCollapsed = new Set<string>();
  if (nodes.size > 10) {
    for (const node of nodes.values()) {
      if (node.descendantCount > 3 && !focusPathSet.has(node.event.id)) initialCollapsed.add(node.event.id);
    }
  }

  return {
    root,
    otherReplies: topLevel,
    nodes,
    focusPath,
    focusDepth,
    pathComplete,
    initialCollapsed,
    replyCount: Math.max(0, nodes.size - (root ? 1 : 0)),
  };
}

