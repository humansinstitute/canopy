# Native Canopy parity and validation

The website is the behavior reference. Native implementation uses Compose, Flow,
SQLite, Android Activity Results and native networking; no web UI is packaged.
This checklist records scope, not an assertion that planned features pass tests.

| Web reference | Native behavior required | Validation gate |
| --- | --- | --- |
| App, session, GuestAccess | Amber connect, account switch/logout, remembered public identity, guest profile/event | Real Amber; missing/cancel/reject; process restart |
| nostr, relays, following-cache | Following-only feed; self posts; no accidental global feed; refresh, pagination, stale cache, reconnection, close subscriptions | Controlled relay, offline and lifecycle |
| EventCard, content, references | Rich text, safe URLs, expandable text, mentions, embedded events, image/video/fullscreen, note menu, copy/share | Native UI and malicious links/media |
| Composer, EnhancedTextarea, mention-editor | Persisted account drafts, 2800-character limit, replies, mentions, emoji, Commons GIF search, quotes, up to four images, upload removal/errors | Sign immutable request, picker/back, publication OK |
| threading, ThreadView | Marked and legacy NIP-10 parents/root, focus context, nested replies, branch collapse, disconnected replies | Cycle/missing-root fixtures and UI |
| interactions, relay-publish | Verified likes/reposts, duplicate guards, partial/error relay outcomes, NIP-57 invoice then wallet | Controlled acknowledgements; no silent test payments |
| ProfilePage, identity, ProfileEditor | Profile timeline, follow/unfollow, preserve unknown tags/metadata, edit eight fields, validated URLs, public share/copy/QR | Replacement-event preservation; native navigation |
| Notifications | Mentions, replies, reactions/reposts, unread watermark, navigate target | Fixture classification and UI |
| BookmarkProvider, bookmarks | Public kind-10003 save/remove, preserve encrypted content/unknown tags/article addresses | Serialized updates; failed publication rollback |
| BookmarksPage, discovery | Personal, kind-9802 Highlights, deduplicated LookMarks from followed 👀/reply/quote signals | Source-bound discovery fixtures |
| SearchPage, local-search, remote-identity | Public local people/text search, bounded 21,256 notes, stats, npub/nprofile/hex remote identity, cache refresh | Persistence/search/restart; no media/key index |
| SettingsPanel, settings | Per-account read/write relays and Blossom defaults from kind 10002/10063, overrides/reset, zap amount/message | Validation; readback; reconnect |
| nwc, zap-preferences | Encrypted local NWC connection, NIP-47 request correlation/verified response, external wallet fallback, payment errors | Protocol fixtures; live payments explicitly untested |
| routes, profile-share | Public HTTPS and Nostr deep links, share sheet, QR and clipboard, Android Back/restored stack | External intent launch and native UI |
| NStackPanel, SettingsSync | Website retains browser-mediated NStack backup. Native authority unavailable; show honest limitation, no Tower credentials | No unsupported native backup claim |
| all screens | Loading/empty/error/offline states, accessibility, keyboard/insets, lifecycle-safe state | Compose instrumentation and exact signed APK |

Architecture: immutable protocol models; verified relay ingress; repository with
SQLite public cache and account-scoped encrypted preferences; one ViewModel per
activity; lifecycle-driven networking; ActivityResultRegistry signer launcher
retained through configuration changes with a ViewModel pending request and a
bounded timeout. After process death an orphan result is discarded; saved drafts
remain available, and publication requires a new user action. Media uses Coil and
Media3. Crypto and NIP-19/NIP-04/NIP-44 use maintained Quartz/ACINQ libraries.

Primary contracts: [NIP-55](https://github.com/nostr-protocol/nips/blob/master/55.md),
[Quartz](https://github.com/vitorpamplona/quartz),
[ACINQ secp256k1](https://github.com/ACINQ/secp256k1-kmp).
