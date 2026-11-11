# Canopy

Canopy is a lightweight, mobile-first Nostr web client for NBrowser and ordinary browsers with a NIP-07 extension. It uses Applesauce for reactive event storage, relay subscriptions, profile models, event creation, signing, and publication.

## Security boundary

Canopy never accepts, imports, derives, logs, or stores a Nostr identity private key. Login calls `window.nostr.getPublicKey()` and every post, reply, like, repost, contact-list/profile update, bookmark-list update, and zap request calls `window.nostr.signEvent()` through the NIP-07 boundary. Browser persistence contains public local-search records and per-account preferences, including an explicitly saved NWC payment capability. It never contains the user’s Nostr identity private key or media blobs. NWC capabilities are masked in the interface and encrypted to the user with NIP-44 before any remote backup.

The home feed is built from the signed-in account's current kind-3 contact list. Applesauce's reactive contact and timeline models are composed with RxJS so account/contact changes replace the active author subscription instead of leaking global notes into the feed. Profiles are resolved as they arrive; clicking an author opens a reactive, single-author post feed; and notifications open an in-app NIP-10 conversation view rooted at the referenced note.

Canopy prefers every valid relay in the signed-in account's current NIP-65 kind-10002 list, respecting read/write markers, and falls back to signer hints plus documented defaults only when no usable profile list is available. The header account menu provides per-account relay and Blossom server overrides plus a reset to profile defaults. The centre Post button opens a modal composer; image attachments upload to the configured Blossom servers with kind-24242 authorization signed through `window.nostr` before their URLs are included in the note.

The Canopy wordmark returns to the home feed and scrolls to its top. Pulling down from the top restarts the reactive relay subscriptions to request fresh notes. Note actions use consistent inline SVG icons so rendering does not depend on platform emoji.

## Signer startup and session restoration

Canopy passively watches for the complete NIP-07 surface, including late injection after NBrowser finishes loading the document. Missing-signer guidance updates automatically without a reload. NStack readiness is independent and does not authorize login. A remembered session makes one automatic restoration attempt per document; a denied or locked signer stays retryable through **Continue with Nostr**. First-time visitors are never prompted automatically. Relay hints are requested after public-key approval.

Connection attempts are single-flight. Bridge replacement/removal, account-change handling, unmount and **Sign out** invalidate pending account results. Sign out removes remembered reconnect intent, preserves saved per-account preferences, and prevents later injection from reconnecting automatically in that document. Same-account bridge replacement, temporary removal or locked-signer errors preserve the authenticated route, mounted dialogs and drafts. Account-bound operations resolve the current bridge and check its public key before signing/encryption and after asynchronous results; stale or different-account results are cancelled before publication or restoration. Verified account changes revoke the old session and require **Continue with Nostr** again. Optional NIP-44 support is feature-detected on the current bridge. All signing remains through `window.nostr`.

## Following cache maintenance

Canopy keeps a public, per-viewer following snapshot in browser-local storage. On a signed-in visit it catches up a due NIP-02 kind-3 sync every 72 hours, then uses the newest healthy snapshot for a due kind-0 profile refresh every 24 hours. It rechecks every 15 minutes while the page is visible and online, and when the page becomes visible or returns online; a closed browser does not run these schedules.

Profile metadata is requested sequentially in batches of 100 through deduplicated active read relays and inserted into the shared Applesauce event store. Every valid followed pubkey gets a fallback local-search person record before metadata requests begin. Failed or partial relay work keeps the previous snapshot, profile data, and successful timestamps, records the current error, and retries when next due. Search shows both last-successful times, the following count, progress/errors, and a single-flight **Refresh now** action that forces both stages.

Other-user profiles expose an optimistic Follow/Following control backed by the signed-in user's newest NIP-02 kind-3 event. Replacements preserve the existing content, relay/petname fields, and extension tags; rapid changes serialize against the latest successful signed replacement. The account menu also provides a public-profile editor for standard kind-0 metadata. It removes blank managed fields, requires HTTPS media/website URLs, and preserves unknown properties from valid prior metadata.

## Bookmarks and network discovery

The five-position navigation is Home, Search, centre Post, Bookmarks, and Activity. Bookmarks reads the signed-in account's newest NIP-51 kind-10003 list from active read relays and resolves public `e` entries through the existing event store and relay pool. Replacements preserve the complete existing content and every unrelated tag—including encrypted/private content, `a` article addresses, and extension tags—and add or remove only the selected note's `e` tag. Optimistic updates are serialized so rapid actions use the freshest successfully signed list; a total relay failure rolls back only that note's control.

The same destination shows recent NIP-84 kind-9802 highlights and LookMarks-compatible 👀 signals from the current kind-3 follow list. Highlights retain their `e`, `a`, `i`, or `r` source, context, and comment. LookMarks accepts only kind-7 👀 reactions, kind-1 👀 NIP-10 replies, and kind-1 👀 NIP-18 quotes, then deduplicates their targets. Discovery subscriptions are capped, account/relay reactive, and disposed when their view inputs change.

## NStack discovery

When NBrowser injects the connection-autofill `window.NStack` bridge, the account menu first requests origin-scoped discovery and only then lists the NStacks and workspaces approved for Canopy. A selected workspace is accepted only when it contains the supported method surface and a complete safe descriptor: a canonical HTTPS Tower endpoint, the real workspace ID, and public workspace/service npubs. Canopy imports those fields into the same browser-local network/service configuration as its relay and upload settings, never NBrowser's origin-specific aliases. Browser `change` events invalidate the imported destination and require fresh consent; compatibility is feature-detected rather than pinned to a numeric provider version.

`window.NStack` is connection autofill, not service authority. Canopy does not request capabilities or accept tokens, credentials, keys, cached signatures, or signing responses from it. Authentication and event signing continue through ordinary `window.nostr`. Feeds/posts use the account's configured public relays; uploads use its configured Blossom servers.

## Private settings backup

**Save settings** validates and saves the network form, zap defaults, and any newly entered NWC URI together in one atomic per-account browser record. **Connect wallet** also saves the wallet independently. A failed local write is shown as a failed save, rather than pretending the preference will survive reload. Existing valid browser-local preferences migrate without requiring the user to re-enter them.

The small layers icon immediately beside relay status opens compact backup controls. Its accessible label, title and status dot distinguish local/unsynced, pending, encrypted backup, and connected-but-empty states. When NStack is present without a selected destination, **Connect your NStack** opens the consented workspace selector. The app detects late injection, readiness, visibility/online changes, and bridge/account changes. A changed/revoked connection requires a fresh selection. Denied or failed sync pauses automatic attempts until an explicit retry or connection change; it does not repeatedly open discovery consent. Account checks also run while sync is paused, and late results from an old identity or destination cannot restore into the new account.

Canopy uses the native Tower PG app-row surface:

```text
/api/v4/flightdeck-pg/workspaces/{workspaceId}/apps/{canopyAppNpub}/db/settings-v1/rows
```

The public Canopy namespace is derived from SHA-256 of UTF-8 `org.wingman.canopy.app-namespace.v1:1`, the first counter starting from zero whose digest lifts to a secp256k1 point. Its hex public identifier is `2b6ea3734328c87e8dcdb9c4b51902041ac8a403eb3c3b1710a61c50da68de50`; `CANOPY_APP_NPUB` exports the Bech32 representation. This is a public release namespace with no bundled signing secret. A workspace manager must enable it with `storage.private` and `app_rows.private_only`. The backup controls offer **Enable Canopy backup** when registration is missing; permission denial remains visible and a member can ask a manager to enable the namespace. No shared contract or host-storage fallback is used.

Every request has a fresh kind-27235 NIP-98 signature for the exact URL, method and JSON payload hash through `window.nostr`. Each private row contains only a schema marker and the complete settings snapshot encrypted user-to-self with `window.nostr.nip44`. Restore checks workspace, namespace, private ownership, schema, account and field validity before applying any settings. The browser destination itself is local consent-bound configuration and is not restored from a backup. All portable app preferences are included: read/write relays, Blossom servers, NWC payment capability, default zap amount and default zap message (including empty messages and explicit removals). Device-local exclusions are remembered-login consent, selected NStack connection and legacy selector, following-cache refresh/check timestamps, notification-read checkpoint, IndexedDB public search/identity/event records, and backup success checkpoints. Public profile/contact/bookmark events remain relay-backed data; media is not a preference. Identity keys and authorization signatures are never backup inputs.

The app-row PATCH API has no compare-and-swap guard. Canopy therefore appends immutable snapshots and reads before writing. Independent network, NWC and zap registers merge by logical edit clock; concurrent edits within the same register have a deterministic tie-break, with removal winning equal-clock ties. Explicit removals/reset are tombstones, so a stale snapshot cannot resurrect a wallet. Legacy preferences have lowest priority and empty first-device defaults never overwrite a remote backup. Changes made during upload remain pending and trigger another pass. Unchanged snapshots are decrypted once per mounted account/destination and cached only in memory.

Canopy syncs meaningful settings edits after a 400 ms quiet period, or when 24 hours have elapsed since the last successful sync. A local SHA-256 fingerprint and success time are scoped to the account and canonical destination; reloads do not trigger redundant remote reads. Startup, visibility/online events and a one-minute local due check evaluate this schedule; fresh devices or destinations restore immediately. Failed writes never advance the checkpoint. Closed browsers do not sync. Recovery reads at most 1,000 immutable rows (50 per page), then pauses with a maintenance message rather than applying a partial history. There is no automatic history pruning. Removing a wallet removes the active preference across synced devices; it does not revoke the capability at the wallet or erase historical encrypted snapshots. Same-register concurrent edits resolve deterministically; independent registers are preserved.

NBrowser must approve the exact hosted origin and permit Nostr event kinds `0`, `1`, `3`, `6`, `7`, `9734`, `10003`, `24242`, and `27235` for settings storage authentication. NIP-44 self-encryption/decryption also requires browser consent. An ordinary NIP-07 browser without NStack or NIP-44 remains usable with local settings and explicit unsynced status.

Zaps use the recipient's NIP-57 Lightning address. Canopy signs the zap request, requests an invoice over HTTPS, and pays using the saved NIP-47 NWC connection, WebLN, or a copyable external-wallet invoice as available. NWC's scoped payment key remains distinct from the user's identity signing key.

## Development

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Set `CANOPY_BASE_URL=https://your-managed-origin.example` when running the browser smoke against an already-built hosted version.
Set `CANOPY_TEST_PORT=4187` (or another free port) when the default local browser-test port is occupied.

The production output is static in `dist/`. No application database or backend is required.

## Managed activation

Register the repository/build command with Autopilot's managed app runner, then add the resulting HTTPS launch origin to the NBrowser/Tower WApp signer trust profile with kinds `0`, `1`, `3`, `6`, `7`, `9734`, `10003`, `24242`, and `27235`. Do not serve this app from an unapproved or changing origin: NBrowser signer access is exact-origin scoped.


### Public links

Direct `/profile/<npub>` and `/event/<nevent>` links open without login, including on reload. Public views use the default read relays and any relay hints in the event link. Use the avatar menu to connect a NIP-07 signer when you want to follow, post, bookmark or zap; opening a public link as a guest does not prompt an installed signer. Remembered logins continue to reconnect as before. Missing content reports relay availability rather than requiring login. The main feed and personal pages continue to require login.

### Video playback

Clicking a note's **Play video** requests browser fullscreen and starts playback in the same user gesture. The player provides play/pause, seek and elapsed/total time, volume/mute, playback speed, fullscreen exit and **Open original**. Focus stays in the player and returns to the preview on close. With the player focused, Space/K toggles playback, left/right seeks five seconds, M toggles mute, F toggles fullscreen, and Escape exits fullscreen or closes the viewer. Native input/select/button keyboard behavior remains available; controls have touch-sized targets.

Fullscreen refusal leaves a usable in-page player and an explicit retry control. Safari's native video fullscreen is used when container fullscreen is unavailable; its native controls and device volume behavior apply. Browser codec support still determines playable formats: Canopy does not transcode or bypass unavailable/private hosts. Load/decode errors and long stalls offer Retry and Open original for another player. The production server explicitly permits HTTPS media in CSP (`media-src 'self' https:`); keep this directive when changing hosting headers.

The video browser tests run against `server.mjs` (including production CSP), decode a real MP4 and exercise controls, fullscreen/refusal and invalid-source recovery. `e2e/fixtures/playback.mp4` is a generated 12-second test pattern with a tone, created using:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 12 -c:v libx264 -pix_fmt yuv420p -preset veryslow -crf 35 -c:a aac -b:a 32k -movflags +faststart e2e/fixtures/playback.mp4
```
