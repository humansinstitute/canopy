import { BlossomListEditor } from "./components/BlossomListEditor";
import { GuestAccess } from "./components/GuestAccess";
import { changeSettings } from "./lib/settings-state";
import { SettingsSync } from "./components/SettingsSync";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "./types";
import { forgetLogin, getAccountProvider, setSessionAccount, getNostrProvider, hasRememberedLogin, rememberLogin, requestLogin, watchNostrProvider } from "./lib/session";
import { DEFAULT_RELAYS, getRelayPlan, uniqueRelays, type RelayPlan } from "./lib/relays";
import { addLocalEvent, eventStore, fetchLatestContactList, fetchProfileServiceEvents, getReferencedEvent, relayPool, seedDemoEvents, startNostrStreams, subscribeFollowingFeed, subscribeTimeline, type FollowingFeedState, type NetworkState } from "./lib/nostr";
import { notificationsFrom, unreadCount } from "./lib/notifications";
import { compactPubkey } from "./lib/content";
import { EventCard } from "./components/EventCard";
import { Composer } from "./components/Composer";
import { Notifications } from "./components/Notifications";
import { ThreadView } from "./components/ThreadView";
import { ProfilePage } from "./components/ProfilePage";
import { useProfile } from "./components/Avatar";
import { Avatar } from "./components/Avatar";
import { Modal } from "./components/Modal";
import { SettingsPanel } from "./components/SettingsPanel";
import { NStackPanel } from "./components/NStackPanel";
import { SearchPage } from "./components/SearchPage";
import { BookmarkProvider } from "./components/BookmarkProvider";
import { BookmarksPage } from "./components/BookmarksPage";
import { clearSavedSettings, loadSavedSettings, profileNetworkSettings, type NetworkSettings } from "./lib/settings";
import { clearNwcConnection, loadNwcConnection, payInvoiceWithNwc, saveNwcConnection } from "./lib/nwc";
import { indexSeenEvent } from "./lib/local-search";
import { browserFollowingCacheDependencies, FollowingCacheController, type FollowingCacheStatus } from "./lib/following-cache";
import { ContactListController } from "./lib/identity";
import { ProfileEditor } from "./components/ProfileEditor";
import { DEFAULT_ZAP_PREFERENCES, loadZapPreferences, saveZapPreferences, type ZapPreferences } from "./lib/zap-preferences";
import type { OpenThread, ThreadNavigationTarget } from "./lib/threading";
import { canonicalRoute, eventRoute, formatRoute, parseRoute, profileRoute, type CanopyRoute } from "./lib/routes";

type LoginState = "checking" | "ready" | "missing" | "connecting" | "error";
type HistoryState = { canopy?: boolean; canopyBack?: boolean; returnPath?: string; scrollY?: number; eventTarget?: ThreadNavigationTarget };

function Welcome({ state, message, onConnect }: { state: LoginState; message?: string; onConnect(): void }) {
  const available = state !== "missing";
  return (
    <main className="welcome-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="welcome-card">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
        <p className="eyebrow">A calmer Nostr client</p>
        <h1>Find your signal.</h1>
        <p className="welcome-copy">A quick, image-first feed made for NBrowser and your favourite NIP-07 extension.</p>
        <div className="privacy-promise"><span>◇</span><p><strong>Your keys stay yours.</strong><br />Canopy asks your signer for a public key and signed events. It never sees, accepts or stores your private key.</p></div>
        {available ? (
          <button className="primary-button" onClick={onConnect} disabled={state === "checking" || state === "connecting"}>
            {state === "connecting" ? "Waiting for signer…" : state === "checking" ? "Checking browser…" : "Continue with Nostr"}
          </button>
        ) : (
          <div className="guidance" role="status"><strong>No signer found</strong><p>Open Canopy in NBrowser from an approved app origin, or install and unlock a NIP-07 browser extension. Canopy will detect it automatically; no reload is needed.</p></div>
        )}
        {message && <p className="login-error" role="alert">{message}</p>}
        <p className="microcopy">No account form. No password. No nsec.</p>
      </section>
    </main>
  );
}

function AccountIntro({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return <div><p className="eyebrow">Hello, {profile.name}</p><h1>Your feed</h1></div>;
}

function HeaderAccount({ pubkey, onClick }: { pubkey: string; onClick(): void }) {
  const profile = useProfile(pubkey);
  return <button className="header-account" type="button" onClick={onClick} aria-label={`Open account options for ${profile.name}`}><Avatar pubkey={pubkey} /></button>;
}

function NavIcon({ name }: { name: "home" | "search" | "bookmark" | "activity" }) {
  if (name === "home") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></svg>;
  if (name === "search") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>;
  if (name === "bookmark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
}

export default function App() {
  const [loginState, setLoginState] = useState<LoginState>("checking");
  const [loginMessage, setLoginMessage] = useState<string>();
  const [pubkey, setPubkey] = useState<string>();
  const [relays, setRelays] = useState<RelayPlan>();
  const [blossomServers, setBlossomServers] = useState<string[]>([]);
  const [profileDefaults, setProfileDefaults] = useState<NetworkSettings>();
  const [nwcConnection, setNwcConnection] = useState<string>();
  const [zapPreferences, setZapPreferences] = useState<ZapPreferences>({ ...DEFAULT_ZAP_PREFERENCES });
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [feedState, setFeedState] = useState<FollowingFeedState>({ status: "loading", events: [], followCount: 0 });
  const [network, setNetwork] = useState<NetworkState>("connecting");
  const [route, setRoute] = useState<CanopyRoute>(() => parseRoute(window.location.pathname));
  const [seenAt, setSeenAt] = useState(() => Number(localStorage.getItem("canopy.notificationSeenAt") || 0));
  const [modal, setModal] = useState<"post" | "account" | "profile" | "settings" | "nstack">();
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<FollowingCacheStatus>();
  const pullStart = useRef<number | undefined>(undefined);
  const autoConnectStarted = useRef(false);
  const connectionGeneration = useRef(0);
  const connectionPending = useRef(false);
  const signedIn = useRef(false);
  const accountRef = useRef(pubkey);
  accountRef.current = pubkey;
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const pendingScrollRestore = useRef<number | undefined>(undefined);
  const routeRef = useRef(route);
  const publicReadRelays = useMemo(() => uniqueRelays([...(route.kind === "event" ? route.target.relayHints : []), ...DEFAULT_RELAYS]), [route]);
  const mockPublishPool = useMemo(() => ({ publish: async (_relays: string[], event: NostrEvent) => {
    const delay = window.__CANOPY_MOCK_PUBLISH_DELAY__ ?? 0;
    const shouldFail = Boolean(window.__CANOPY_MOCK_PUBLISH_FAILURE__);
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    return [{ from: "wss://mock.relay", ok: !shouldFail, message: shouldFail ? "offline" : "saved", event }];
  } }), []);
  const followingCache = useMemo(() => pubkey && relays ? new FollowingCacheController(
    pubkey,
    browserFollowingCacheDependencies(pubkey, relays.read, window.__CANOPY_MOCK__ ? window.__CANOPY_EVENTS__ ?? [] : undefined),
  ) : undefined, [pubkey, relays]);

  useLayoutEffect(() => {
    if (pendingScrollRestore.current === undefined) return;
    const top = pendingScrollRestore.current;
    pendingScrollRestore.current = undefined;
    const restore = () => window.scrollTo({ top, left: 0, behavior: "auto" });
    restore();
    let secondFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      restore();
      secondFrame = window.requestAnimationFrame(restore);
    });
    const settleInterval = window.setInterval(() => {
      restore();
      if (window.scrollY === top) window.clearInterval(settleInterval);
    }, 50);
    const settleObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(restore);
    settleObserver?.observe(document.documentElement);
    const settleTimer = window.setTimeout(() => {
      restore();
      window.clearInterval(settleInterval);
      settleObserver?.disconnect();
    }, 5_000);
    return () => {
      window.cancelAnimationFrame(frame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.clearInterval(settleInterval);
      settleObserver?.disconnect();
      window.clearTimeout(settleTimer);
    };
  }, [route]);

  useEffect(() => { routeRef.current = route; }, [route]);

  useEffect(() => {
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const existingState = (history.state ?? {}) as HistoryState;
    let parsed = parseRoute(window.location.pathname);
    if (parsed.kind === "event" && existingState.eventTarget?.focusId === parsed.eventId) parsed = { ...parsed, target: existingState.eventTarget };
    routeRef.current = parsed;
    setRoute(parsed);
    history.replaceState({ ...existingState, canopy: true, canopyBack: existingState.canopy ? existingState.canopyBack : false, scrollY: existingState.scrollY ?? window.scrollY }, "", formatRoute(parsed));
    const onPopState = (event: PopStateEvent) => {
      const state = (event.state ?? {}) as HistoryState;
      let next = parseRoute(window.location.pathname);
      if (next.kind === "event" && state.eventTarget?.focusId === next.eventId) next = { ...next, target: state.eventTarget };
      pendingScrollRestore.current = state.scrollY ?? 0;
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (!pubkey || route.kind !== "root") return;
    const next = canonicalRoute(route);
    history.replaceState({ ...(history.state as HistoryState), canopy: true, scrollY: 0 }, "", formatRoute(next));
    routeRef.current = next;
    setRoute(next);
  }, [pubkey, route]);

  useEffect(() => {
    const stop = watchNostrProvider((provider) => {
      // A replaced or removed bridge invalidates any in-flight account result.
      connectionGeneration.current++;
      connectionPending.current = false;
      // Bridge availability is not account identity. Keep the mounted UI/drafts.
      if (signedIn.current) {
        if (provider) {
          const generation = connectionGeneration.current;
          void requestLogin(provider).then((identity) => {
            if (generation === connectionGeneration.current && provider === getNostrProvider() && signedIn.current && identity !== accountRef.current) signOut();
          }, () => undefined);
        }
        return;
      }
      setLoginState(provider ? "ready" : "missing");
      if (provider && hasRememberedLogin() && !autoConnectStarted.current) {
        autoConnectStarted.current = true;
        void connectRef.current();
      }
    });
    return () => {
      stop();
      connectionGeneration.current++;
      connectionPending.current = false;
    };
  }, []);

  useEffect(() => {
    const subscription = eventStore.insert$.subscribe(indexSeenEvent);
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (window.__CANOPY_MOCK__) seedDemoEvents(window.__CANOPY_EVENTS__ ?? []);
  }, []);


  useEffect(() => {
    const subscription = subscribeTimeline([1, 6, 7, 16], setEvents);
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!followingCache) { setCacheStatus(undefined); return; }
    const unsubscribe = followingCache.subscribe(setCacheStatus);
    followingCache.start();
    return () => { unsubscribe(); followingCache.stop(); };
  }, [followingCache]);

  useEffect(() => {
    if (!pubkey || !relays) return;
    if (window.__CANOPY_MOCK__) {
      seedDemoEvents(window.__CANOPY_EVENTS__ ?? []);
      setNetwork("online");
    } else {
      const streams = startNostrStreams(pubkey, relays.read, setNetwork);
      return () => streams.close();
    }
  }, [pubkey, relays, refreshRevision]);

  useEffect(() => {
    if (!pubkey || !relays) return;
    const subscription = subscribeFollowingFeed(pubkey, relays.read, setFeedState, !window.__CANOPY_MOCK__);
    return () => subscription.unsubscribe();
  }, [pubkey, relays, refreshRevision]);

  const notifications = useMemo(() => pubkey ? notificationsFrom(events, pubkey) : [], [events, pubkey]);
  const unread = unreadCount(notifications, seenAt);

  async function connect() {
    if (connectionPending.current) return;
    autoConnectStarted.current = true;
    const provider = getNostrProvider();
    if (!provider) { setLoginState("missing"); return; }
    connectionPending.current = true;
    const generation = ++connectionGeneration.current;
    const isCurrent = () => generation === connectionGeneration.current && getNostrProvider() === provider;
    setLoginState("connecting");
    setLoginMessage(undefined);
    try {
      const nextPubkey = await requestLogin(provider);
      if (!isCurrent()) return;
      const relayPlan = await getRelayPlan(provider);
      if (!isCurrent()) return;
      if (window.__CANOPY_MOCK__) seedDemoEvents(window.__CANOPY_EVENTS__ ?? []);
      const serviceEvents = window.__CANOPY_MOCK__
        ? (window.__CANOPY_EVENTS__ ?? []).filter((event) => event.pubkey === nextPubkey && (event.kind === 0 || event.kind === 10002 || event.kind === 10063))
        : await fetchProfileServiceEvents(nextPubkey, relayPlan.read).catch(() => []);
      if (!isCurrent()) return;
      const defaults = profileNetworkSettings(serviceEvents, relayPlan);
      const saved = loadSavedSettings(nextPubkey);
      const selected = saved ?? defaults;
      signedIn.current = true;
      setSessionAccount(nextPubkey);
      setPubkey(nextPubkey);
      setProfileDefaults(defaults);
      setRelays(selected.relays);
      setBlossomServers(selected.blossomServers);
      setNwcConnection(loadNwcConnection(nextPubkey));
      setZapPreferences(loadZapPreferences(nextPubkey));
      rememberLogin();
      setModal(undefined);
    } catch (error) {
      if (!isCurrent()) return;
      setLoginState("error");
      setLoginMessage(error instanceof Error ? error.message : "The signer did not approve access.");
    } finally {
      if (generation === connectionGeneration.current) connectionPending.current = false;
    }
  }

  function signOut() {
    // Explicit logout wins over pending login and later bridge injection.
    autoConnectStarted.current = true;
    connectionGeneration.current++;
    connectionPending.current = false;
    signedIn.current = false;
    setSessionAccount();
    forgetLogin();
    setPubkey(undefined);
    setNwcConnection(undefined);
    setModal(undefined);
    setLoginMessage(undefined);
    setLoginState(getNostrProvider() ? "ready" : "missing");
  }

  function navigate(next: CanopyRoute, replace = false) {
    const current = routeRef.current;
    const currentState = (history.state ?? {}) as HistoryState;
    history.replaceState({ ...currentState, canopy: true, scrollY: window.scrollY }, "", formatRoute(current));
    const nextState: HistoryState = {
      canopy: true,
      canopyBack: replace ? currentState.canopyBack : true,
      returnPath: currentState.returnPath ?? formatRoute(current),
      scrollY: 0,
      ...(next.kind === "event" ? { eventTarget: next.target } : {}),
    };
    history[replace ? "replaceState" : "pushState"](nextState, "", formatRoute(next));
    pendingScrollRestore.current = 0;
    routeRef.current = next;
    setRoute(next);
    if (next.kind === "activity") {
      const now = Math.floor(Date.now() / 1000);
      setSeenAt(now);
      localStorage.setItem("canopy.notificationSeenAt", String(now));
    }
  }

  const openThread: OpenThread = (target) => {
    const event = getReferencedEvent({ id: target.focusId });
    navigate(eventRoute(target.focusId, target.relayHints, { author: event?.pubkey, kind: event?.kind, target }));
  };

  function returnFromDetail() {
    const state = (history.state ?? {}) as HistoryState;
    if (state.canopy && state.canopyBack) {
      history.back();
      return;
    }
    const fallback = state.returnPath ? parseRoute(new URL(state.returnPath, window.location.origin).pathname) : { kind: "feed" } as CanopyRoute;
    navigate(fallback.kind === "not-found" || fallback.kind === "root" ? { kind: "feed" } : fallback, true);
  }

  function openProfile(nextPubkey: string) {
    navigate(profileRoute(nextPubkey));
  }

  function goHomeTop() {
    navigate({ kind: "feed" });
  }

  function refreshFeed() {
    if (refreshing) return;
    setRefreshing(true);
    setNetwork("connecting");
    setRefreshRevision((revision) => revision + 1);
    window.setTimeout(() => setRefreshing(false), 700);
  }

  function startPull(event: React.TouchEvent) {
    if (route.kind === "feed" && window.scrollY <= 0) pullStart.current = event.touches[0]?.clientY;
  }

  function movePull(event: React.TouchEvent) {
    if (pullStart.current === undefined) return;
    setPullDistance(Math.min(90, Math.max(0, (event.touches[0]?.clientY ?? pullStart.current) - pullStart.current) * 0.55));
  }

  function endPull() {
    if (pullDistance >= 54) refreshFeed();
    pullStart.current = undefined;
    setPullDistance(0);
  }

  const publishPool = window.__CANOPY_MOCK__ ? mockPublishPool : relayPool;
  const provider = useMemo(() => pubkey ? getAccountProvider(pubkey) : undefined, [pubkey]);
  const contactController = useMemo(() => pubkey && relays && provider ? new ContactListController(
    provider.signEvent.bind(provider), publishPool, relays.write,
    () => fetchLatestContactList(pubkey, relays.read, !window.__CANOPY_MOCK__), addLocalEvent,
  ) : undefined, [provider, publishPool, pubkey, relays]);

  if (!pubkey || !relays || !provider || !contactController) {
    if (route.kind !== "profile" && route.kind !== "event" && route.kind !== "not-found") return <Welcome state={loginState} message={loginMessage} onConnect={connect} />;
    const publicProps = { readRelays: publicReadRelays, writeRelays: [], blossomServers: [], pool: publishPool, onPublished: addLocalEvent, onOpenProfile: openProfile, onOpenThread: openThread, zapPreferences: DEFAULT_ZAP_PREFERENCES, mock: Boolean(window.__CANOPY_MOCK__), onBack: returnFromDetail };
    return <GuestAccess.Provider value={() => setModal("account")}>
      <div className="app-shell">
        <header className="topbar">
          <button className="wordmark" type="button" onClick={goHomeTop} aria-label="Canopy home, scroll to top"><div className="mini-mark"><i /><i /><i /></div>Canopy</button>
          <button className="header-account" type="button" onClick={() => setModal("account")} aria-label="Open account options"><div className="avatar" aria-hidden="true">◇</div></button>
        </header>
        <main className="main-column">
          {route.kind === "profile" ? <ProfilePage {...publicProps} pubkey={route.pubkey} />
            : route.kind === "event" ? <ThreadView {...publicProps} target={route.target} />
            : <div className="empty-state not-found-state"><span>?</span><h1>Page not found</h1><p>{route.reason}</p></div>}
        </main>
        {modal === "account" && <Modal title="Log in to Canopy" onClose={() => setModal(undefined)}><div className="account-menu">
          <p>Browse public profiles and notes without an account. Log in to follow, post, save or zap.</p>
          <button type="button" onClick={() => void connect()} disabled={loginState === "checking" || loginState === "connecting"}>{loginState === "connecting" ? "Waiting for signer…" : "Continue with Nostr"}</button>
          {loginState === "missing" && <p role="status">No signer found. Open Canopy in NBrowser or install and unlock a NIP-07 extension, then try again.</p>}
          {loginMessage && <p role="alert">{loginMessage}</p>}
        </div></Modal>}
      </div>
    </GuestAccess.Provider>;
  }
  const invoicePayer = nwcConnection ? async (invoice: string) => {
    if (window.__CANOPY_MOCK__) {
      const delay = window.__CANOPY_MOCK_NWC_DELAY__ ?? 0;
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (window.__CANOPY_MOCK_NWC_FAILURE__) throw new Error("The NIP-47 wallet rejected the payment.");
      return { preimage: "mock-nwc-preimage" };
    }
    return payInvoiceWithNwc(nwcConnection, invoice, relayPool);
  } : undefined;

  return (
    <BookmarkProvider pubkey={pubkey} readRelays={relays.read} writeRelays={relays.write} pool={publishPool} mock={Boolean(window.__CANOPY_MOCK__)}>
    <div className="app-shell" onTouchStart={startPull} onTouchMove={movePull} onTouchEnd={endPull}>
      <header className="topbar">
        <button className="wordmark" type="button" onClick={goHomeTop} aria-label="Canopy home, scroll to top"><div className="mini-mark"><i /><i /><i /></div>Canopy</button>
        <div className="topbar-actions">
          <div className={`network-pill network-pill--${network}`}><i />{network === "online" ? `${relays.read.length} relays` : network}</div>
          <SettingsSync key={pubkey} pubkey={pubkey} onConnect={() => setModal("nstack")} onAccountChanged={signOut} onRestored={() => {
            const restored = loadSavedSettings(pubkey) ?? profileDefaults;
            if (restored) { setRelays(restored.relays); setBlossomServers(restored.blossomServers); }
            setNwcConnection(loadNwcConnection(pubkey)); setZapPreferences(loadZapPreferences(pubkey));
          }} />
          {route.kind === "feed" && <button className={`feed-refresh-button ${refreshing ? "is-refreshing" : ""}`} type="button" onClick={refreshFeed} disabled={refreshing} aria-label={refreshing ? "Refreshing feed" : "Refresh feed"} title="Refresh feed">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M18.2 15.5a7 7 0 1 1 .4-6.4L20 11" /></svg>
          </button>}
          <HeaderAccount pubkey={pubkey} onClick={() => setModal("account")} />
        </div>
      </header>
      <div className={`pull-refresh ${refreshing ? "is-refreshing" : ""}`} style={{ height: refreshing ? 34 : pullDistance }} role="status" aria-live="polite"><span>{refreshing ? "Refreshing feed…" : pullDistance >= 54 ? "Release to refresh" : "Pull to refresh"}</span></div>
      <main className="main-column">
        {route.kind === "feed" || route.kind === "root" ? (
          <>
            <div className="page-intro"><AccountIntro pubkey={pubkey} /></div>
            <section className="feed" aria-label="Notes from people you follow">
              {feedState.events.length ? feedState.events.map((event) => <EventCard event={event} readRelays={relays.read} writeRelays={relays.write} blossomServers={blossomServers} pool={publishPool} onPublished={addLocalEvent} onOpenProfile={openProfile} onOpenThread={openThread} payInvoice={invoicePayer} zapPreferences={zapPreferences} mock={Boolean(window.__CANOPY_MOCK__)} key={event.id} />)
                : feedState.status === "loading" ? <div className="empty-state"><span>◌</span><h2>Loading your follows</h2><p>Canopy is finding your contact list before opening the feed.</p></div>
                : <div className="empty-state"><span>◌</span><h2>No followed notes yet</h2><p>Your contact list is empty, unavailable, or the people you follow have no recent notes on these relays. Canopy will not substitute a global feed.</p></div>}
            </section>
          </>
        ) : route.kind === "search" ? (
          <SearchPage readRelays={relays.read} mock={Boolean(window.__CANOPY_MOCK__)} onOpenProfile={openProfile} onOpenThread={openThread} cacheStatus={cacheStatus} onRefreshCache={() => { void followingCache?.check(true); }} />
        ) : route.kind === "saved" ? (
          <BookmarksPage view={route.view} onViewChange={(view) => navigate({ kind: "saved", view })} pubkey={pubkey} readRelays={relays.read} writeRelays={relays.write} blossomServers={blossomServers} pool={publishPool} onPublished={addLocalEvent} onOpenProfile={openProfile} onOpenThread={openThread} payInvoice={invoicePayer} zapPreferences={zapPreferences} mock={Boolean(window.__CANOPY_MOCK__)} />
        ) : route.kind === "activity" ? (
          <><div className="page-intro"><div><p className="eyebrow">Recent activity</p><h1>Notifications</h1></div></div><Notifications items={notifications} onOpenThread={openThread} /></>
        ) : route.kind === "event" ? <ThreadView target={route.target} readRelays={uniqueRelays([...route.target.relayHints, ...relays.read])} writeRelays={relays.write} blossomServers={blossomServers} pool={publishPool} onPublished={addLocalEvent} onOpenProfile={openProfile} onOpenThread={openThread} payInvoice={invoicePayer} zapPreferences={zapPreferences} mock={Boolean(window.__CANOPY_MOCK__)} onBack={returnFromDetail} />
          : route.kind === "profile" ? <ProfilePage pubkey={route.pubkey} viewerPubkey={pubkey} contacts={contactController} readRelays={relays.read} writeRelays={relays.write} blossomServers={blossomServers} pool={publishPool} onPublished={addLocalEvent} onOpenProfile={openProfile} onOpenThread={openThread} payInvoice={invoicePayer} zapPreferences={zapPreferences} mock={Boolean(window.__CANOPY_MOCK__)} onBack={returnFromDetail} />
          : <div className="empty-state not-found-state"><span>?</span><h1>Page not found</h1><p>{route.kind === "not-found" ? route.reason : "Canopy could not open this address."}</p><button className="primary-button compact" type="button" onClick={() => navigate({ kind: "feed" }, true)}>Go to Feed</button></div>}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={route.kind === "feed" ? "active" : ""} onClick={() => navigate({ kind: "feed" })}><NavIcon name="home" />Home</button>
        <button className={route.kind === "search" ? "active" : ""} onClick={() => navigate({ kind: "search" })}><NavIcon name="search" />Search</button>
        <button className="post-nav-button" aria-label="Create post" onClick={() => setModal("post")}><span>＋</span>Post</button>
        <button className={route.kind === "saved" ? "active" : ""} onClick={() => navigate({ kind: "saved", view: "bookmarks" })}><NavIcon name="bookmark" />Bookmarks</button>
        <button className={`activity-nav-button ${route.kind === "activity" ? "active" : ""}`} onClick={() => navigate({ kind: "activity" })}><span className="bell"><NavIcon name="activity" />{unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}</span>Activity</button>
      </nav>
      {modal === "post" && <Modal title="Create a post" onClose={() => setModal(undefined)}><Composer writeRelays={relays.write} readRelays={relays.read} blossomServers={blossomServers} pool={publishPool} onPublished={addLocalEvent} onComplete={() => setModal(undefined)} /></Modal>}
      {modal === "account" && <Modal title="Your account" onClose={() => setModal(undefined)}><div className="account-menu"><div className="account-summary"><Avatar pubkey={pubkey} /><div><strong>{compactPubkey(pubkey)}</strong><span>Your keys remain in NBrowser.</span></div></div><button type="button" onClick={() => { setModal(undefined); openProfile(pubkey); }}>View my profile <span>→</span></button><button type="button" onClick={() => setModal("profile")}>Edit profile <span>→</span></button><button type="button" onClick={() => setModal("nstack")}>NStack connection <span>→</span></button><button type="button" onClick={() => setModal("settings")}>Settings <span>→</span></button><button type="button" onClick={signOut}>Sign out <span>→</span></button></div></Modal>}
      {modal === "profile" && <Modal title="Edit profile" onClose={() => setModal(undefined)}><ProfileEditor pubkey={pubkey} sign={provider.signEvent.bind(provider)} pool={publishPool} readRelays={relays.read} writeRelays={relays.write} connectRelays={!window.__CANOPY_MOCK__} onPublished={addLocalEvent} /></Modal>}
      {modal === "settings" && profileDefaults && <Modal title="Settings" onClose={() => setModal(undefined)}><SettingsPanel key={pubkey} settings={{ relays, blossomServers }} profileDefaults={profileDefaults} zapPreferences={zapPreferences} nwcConnection={nwcConnection} onSaveNwc={(connectionUri) => { setNwcConnection(saveNwcConnection(pubkey, connectionUri)); }} onRemoveNwc={() => { clearNwcConnection(pubkey); setNwcConnection(undefined); }} onSaveZapPreferences={(preferences) => setZapPreferences(saveZapPreferences(pubkey, preferences))} onSaveAll={(settings, zap, nwc) => { changeSettings(pubkey, { network: { read: settings.relays.read, write: settings.relays.write, blossom: settings.blossomServers }, zap, ...(nwc ? { nwc } : {}) }); setRelays(settings.relays); setBlossomServers(settings.blossomServers); setZapPreferences(zap); if (nwc) setNwcConnection(nwc); }} onReset={() => { clearSavedSettings(pubkey); setRelays(profileDefaults.relays); setBlossomServers(profileDefaults.blossomServers); }} /><BlossomListEditor localServers={blossomServers} key={pubkey} pubkey={pubkey} readRelays={relays.read} writeRelays={relays.write} pool={publishPool} onPublished={(event) => { addLocalEvent(event); const next = profileNetworkSettings([event], profileDefaults.relays); setProfileDefaults((current) => ({ ...(current ?? next), blossomServers: next.blossomServers })); if (!loadSavedSettings(pubkey)) setBlossomServers(next.blossomServers); }} /></Modal>}
      {modal === "nstack" && <Modal title="Connect an NStack" onClose={() => setModal(undefined)}><NStackPanel pubkey={pubkey} /></Modal>}
    </div>
    </BookmarkProvider>
  );
}

