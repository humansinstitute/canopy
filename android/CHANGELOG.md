# Changelog

## 0.2.2

Load and edit the published Blossom list when some relays are offline. Show incomplete coverage beside the editor, preserve the newest verified cached list, and require informed confirmation before publishing with uncertainty. All-offline reads remain retryable failures. Copy local servers into a new profile draft without changing the local override.

## 0.2.1

Read, edit, reorder and explicitly publish the public BUD-03 Blossom server list from Settings through Amber. Local upload overrides stay separate. Publication preserves unknown tags, checks newest account-bound relay state before and after approval, validates unique secure URLs and reports relay acknowledgement failures without losing edits.

## 0.2.0

Full Kotlin/Jetpack Compose Android interface with native Flow state, verified relay transport, SQLite cache/search, Android navigation/pickers/sharing, Coil/Media3 media, and account-bound Amber Activity Results. Replaces the historical bundled React host. Includes following feeds, profiles/edit/follow, notes/replies/quotes/mentions, reactions/reposts, saved/discovery views, notifications, encrypted wallet settings and NWC/external-wallet zaps. Website remains intact. NStack backup remains browser-only.

## 0.1.1

Bundle the interface fonts locally so the strict Android content policy permits offline startup. Version code 2 is the first validated public release.

## 0.1.0

First Android release: native host with bundled Canopy React UI, origin-scoped Amber NIP-55 intents, signed-event verification and NIP-44 transport. Includes public/Nostr deep links, system back, external wallet links, file selection and fullscreen media. Feeds, profiles, mentions, quotes, threads, search/cache, bookmarks and NWC use the shared web client. NStack backup remains available only in compatible browsers.
