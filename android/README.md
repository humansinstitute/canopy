# Canopy for Android

Canopy is a Kotlin/Jetpack Compose Android app. Its interface, reactive state,
relay transport, public cache/search, navigation, media and file selection run
natively. The APK contains no React application, JavaScript bridge, web assets,
WebView UI or website fallback. The React website remains a separate application.

Android 11+ is supported (min 30, target 36). Install Amber separately. Identity
keys remain in Amber; Canopy never accepts an identity nsec. Public profiles and
events open without signing in. Signing, account switching, reactions, publishing,
profile/list edits and upload authorization use native NIP-55 Activity Results.

## Architecture and security

- `Protocol.kt`: immutable event contracts, exact-request hash/Schnorr validation,
  NIP-10, list preservation, discovery and primary-library NIP-19 links.
- `RelayTransport.kt`: OkHttp NIP-01 sockets, bounded verified ingress, socket
  generation isolation, subscription cleanup/retry, distinct EOSE and first-OK
  publication. Uncertain record reads cannot erase replacement-list content.
- `Storage.kt`: bounded SQLite public events and account-scoped preferences.
  Wallet credentials use Android Keystore AES-GCM with the account as associated
  data. Android backup/transfer is excluded. Identity signing keys are never stored.
- `CanopyModel.kt`: lifecycle-aware Flow state, following-only feeds, read/write
  preferences, profile refresh, publishing and serialized replacement changes.
- `AmberSigner.kt`: explicit Amber intents, account binding, one correlated bounded
  request, cancellation/rejection/timeout errors and exact immutable verification.
  ViewModel retention handles rotation. Orphan results after process death are
  discarded; drafts persist and require a new publish action.
- Native Compose screens use Android navigation and share/clipboard/photo picker
  controls, Coil images and Media3 video. All network media must use HTTPS.
- Quartz and ACINQ supply NIP-19, NIP-04/44 and secp256k1 primitives. Identity
  encryption, when requested, stays in Amber; NWC uses only its scoped wallet
  authorization, with its own relay pool and verified correlated responses.

See [PARITY.md](PARITY.md) for the complete source-derived feature checklist.
NStack backup requires the website's browser-mediated authority. Native Canopy
shows this limit and does not access Tower credentials. Live payments and physical
devices require separate validation; tests never silently post to public relays.

## Build and test

Install Java 17+ and Android SDK 37.2/build tools. Compilation uses SDK 37.2 because
current maintained Quartz/Compose artifacts require it; this does not require a
newer Android device. Runtime target stays API 36. Gradle, Kotlin, Android plugins
and all libraries are pinned in the project. Set `JAVA_HOME` and `ANDROID_HOME`.

```sh
./android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
./android/gradlew -p android connectedDebugAndroidTest
npm run check
```

Debug builds use `com.wingman.canopy.debug`, so they can coexist with the release.
Native unit tests cover immutable signed requests, replacement preservation,
NIP-19 links, thread/discovery/notification logic, and controlled TLS WebSocket
acceptance/race/EOSE behavior. Instrumentation exercises native navigation,
search/saved/thread/draft behavior and persistent/encrypted storage with signed
offline fixtures. It does not publish those fixtures.

## Release signing and publication

The update identity is `com.wingman.canopy`. Keep the established APK certificate;
the APK signing key is separate from the broker's Nostr publisher identity.
Private signing material must live outside the checkout in an owner-only durable
directory. Never print passwords or commit/export signing material.

```sh
CANOPY_SIGNING_DIRECTORY=/private/signing/directory node scripts/android-release.mjs
```

The script privately supplies signing values and builds/tests/lints the release.
Install and test that exact signed APK with real Amber before publication. Use
`-PnativeReleaseTests` with `connectedReleaseAndroidTest` when running the native
instrumentation suite against a signed release; supply signing environment through
the same private wrapper rather than pasting secrets into shell commands.

Confirm greater version/code, APK hash, certificate continuity, native startup,
Amber login/sign/reject/encrypt/decrypt, offline/reconnect behavior and native
navigation/media/back/deep links. Check APK contents for web assets and the final
manifest/package/signature. Compilation is insufficient for parity acceptance.

Use `scripts/export-public.mjs` for a fresh reviewed clean source export, which
includes Kotlin, Compose resources, tests and these product docs. Never publish
this checkout's private Git history. Review the exact export, then commit/push
only its clean public main and attach the tested APK/checksum to a greater release.

Canopy's Zapstore ownership is now Pete's Nostr identity, pinned in `zapstore.yaml`; the Android package and certificate are unchanged. Future publications use the enrolled native AP Vault release helper (`scripts/publish.ts` in that checkout) and its `docs/PUBLISHING.md`: prepare the verified public APK's application/asset/release triple, sign, independently verify, publish and read back the exact reviewed events. The active certificate ownership proof already exists; ordinary releases must not regenerate C1 proofs. Review renewal or ownership changes separately.

`scripts/zapstore-release.ts` and `android/release-policy.json` retain the legacy Rick broker workflow for audit/readback. Its signing and publication intentionally hold after the transfer, including retained signed events; do not change that policy or bypass its guard to simulate owner authority. No raw Nostr key, nsec or bunker fallback is allowed. Reconcile uncertain delivery before retries and verify current catalog attribution and anonymous APK download hashes separately from relay acceptance.

Protocol documentation: [NIP-55](https://github.com/nostr-protocol/nips/blob/master/55.md),
[Amber](https://github.com/greenart7c3/Amber),
[Quartz](https://github.com/vitorpamplona/quartz),
[ACINQ](https://github.com/ACINQ/secp256k1-kmp).

The legacy Zapstore broker adapter checks the complete official-relay certificate-claim snapshot before each signature and each publication, including retained signed events. A foreign publisher claim, ambiguous history or incomplete query holds publishing. This conservative Nostr-signature check is not app-key verification or a global ownership proof. After an ownership transfer, publish through the authorized owner's AP Vault workflow; never regenerate or replay old-owner certificate claims.

## Published Blossom profile list

Settings provides a separate public BUD-03 editor: load the newest list, edit/reorder HTTPS servers, review and explicitly confirm publication through Amber kind `10063`. Local upload overrides remain separate and retain existing reset/storage behavior. Login and reset do not publish. Publication preserves unknown tags and retained server-tag extensions, uses empty content, and requires at least one server (up to eight). Paths are preserved; credentials, queries, fragments and duplicates are refused. Complete queries from both configured read and write relays are required before and after signing; stale or future-dated baselines block replacement. Signer cancellation and missing relay ACK retain edits in the open editor. Account switching clears the editor, including any publication confirmation.
