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

Use `scripts/zapstore-release.ts` and current `zapstore.yaml` only through the
inherited authorized broker. No raw Nostr key, nsec or bunker fallback is allowed.
For the certificate proof use the established offline `zsp identity --link-key`
flow with the public publisher and privately supplied keystore password; proof
and broker timestamps must match. Verify the RSA proof against the public APK
certificate. Reconcile uncertain delivery before retries. Verify all signed app,
asset, release and certificate events by relay readback, current catalog selection,
and anonymous APK/CDN download hashes. Relay acceptance alone is insufficient.

Protocol documentation: [NIP-55](https://github.com/nostr-protocol/nips/blob/master/55.md),
[Amber](https://github.com/greenart7c3/Amber),
[Quartz](https://github.com/vitorpamplona/quartz),
[ACINQ](https://github.com/ACINQ/secp256k1-kmp).
