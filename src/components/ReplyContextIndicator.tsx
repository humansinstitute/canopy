import { useEffect, useState } from "react";
import type { NostrEvent } from "../types";
import type { OpenThread, ReplyContext } from "../lib/threading";
import { subscribeReferencedEvent } from "../lib/nostr";
import { useProfile } from "./Avatar";

function ResolvedReplyContext({ eventId, context, parent, onOpenThread }: {
  eventId: string;
  context: ReplyContext;
  parent?: NostrEvent;
  onOpenThread: OpenThread;
}) {
  const target = { rootId: context.rootId, focusId: eventId, relayHints: [...new Set([...context.rootRelayHints, ...context.directParentRelayHints])] };
  if (!parent) return <button className="reply-context" type="button" onClick={() => onOpenThread(target)} aria-label="Replying to a note. Open conversation"><span aria-hidden="true">↳</span>Replying to a note</button>;
  return <ResolvedParentReplyContext target={target} parent={parent} onOpenThread={onOpenThread} />;
}

function ResolvedParentReplyContext({ target, parent, onOpenThread }: {
  target: Parameters<OpenThread>[0];
  parent: NostrEvent;
  onOpenThread: OpenThread;
}) {
  const profile = useProfile(parent.pubkey);
  const label = `Replying to ${profile.name}`;
  return <button className="reply-context" type="button" onClick={() => onOpenThread(target)} aria-label={`${label}. Open conversation`}><span aria-hidden="true">↳</span>{label}</button>;
}

export function ReplyContextIndicator({ eventId, context, readRelays, mock = false, onOpenThread }: {
  eventId: string;
  context: ReplyContext;
  readRelays: string[];
  mock?: boolean;
  onOpenThread: OpenThread;
}) {
  const [parent, setParent] = useState<NostrEvent>();
  useEffect(() => {
    setParent(undefined);
    const subscription = subscribeReferencedEvent(
      { id: context.directParentId, relays: context.directParentRelayHints },
      readRelays,
      setParent,
      !mock,
    );
    return () => subscription.unsubscribe();
  }, [context.directParentId, context.directParentRelayHints, readRelays, mock]);
  return <ResolvedReplyContext eventId={eventId} context={context} parent={parent} onOpenThread={onOpenThread} />;
}

