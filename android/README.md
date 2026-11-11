# Canopy for Android

Canopy is an Android native host with its React UI bundled in the APK. It is not a rewrite into native UI controls and does not load the hosted website as its application shell. Android 11 or newer and a current Android System WebView are required. Install Amber separately to connect an account.

The same Applesauce/RxJS client provides feeds, profiles, search/cache, threads, mentions, quotes, media, bookmarks and wallet settings. The browser build remains unchanged. Android profile/event share links use the public Canopy HTTPS site. Android handles Nostr/public HTTPS deep links, system back, document/image selection, external Lightning wallet links and fullscreen video.

## Signer security

Only the bundled `https://appassets.androidplatform.net` main frame gets the AndroidX WebMessage listener. External top-level navigation opens the system browser; arbitrary intent URLs are never forwarded. The bridge allows only public-key, event signing and the used NIP-44 encrypt/decrypt operations. It addresses Amber explicitly, correlates each response, pins `current_user`, bounds payloads, rejects overlapping requests and expires abandoned prompts. Signed events must have the exact requested event hash, fields, account and a valid Schnorr signature before reaching Canopy. No identity secret is requested or stored.

Only the public Amber account key persists in host preferences. Repeated identity checks return that cached public key without repeatedly opening Amber. The native **Canopy · Amber account** menu provides **Switch Amber account**, invalidates pending requests and clears remembered login. Amber is always asked to operate as the connected account, regardless of which account is visible in Amber. Rejected, cancelled, missing-signer and failed-process requests remain retryable. Activity/process recreation discards pending results and loads a fresh document; it does not publish late signed events. Drafts in an active document survive a normal Amber round trip; unsaved drafts may be lost after OS process termination.

NStack discovery remains browser-mediated through `window.NStack`. The Android host does not impersonate that bridge or store Tower credentials; NStack backup is unavailable in this host. Local settings, public cache/search, NWC and external wallet invoice flows remain available. WebLN is not injected. NWC uses its separate wallet capability, never the identity signing key.

## Build and test

Install Node/npm, Java 17+ and Android SDK platform/build-tools 36. Set `JAVA_HOME` and `ANDROID_HOME` for your machine.

```sh
npm ci
npm run check
npx tsc -p android/tsconfig.json --noEmit
./android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
npx playwright install chromium webkit
npm run test:browser
```

The Android Gradle build bundles the shared web sources automatically. Build output stays under ignored `android/**/build/`; normal `dist/` remains the website build. The browser source and live managed app need no activation for Android-only changes.

## Durable release signing

Create the APK key once in an owner-only directory outside every repository. Keep an encrypted backup of the keystore and password together in the owner's secure backup system. Losing them prevents updates under the same Android identity. These are APK credentials, separate from any Nostr identity.

```sh
node scripts/android-signing-init.mjs /absolute/private/canopy-release
CANOPY_SIGNING_DIRECTORY=/absolute/private/canopy-release node scripts/android-release.mjs
apksigner verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
shasum -a 256 android/app/build/outputs/apk/release/app-release.apk
```

The initializer refuses existing material and never prints the password. The release runner reads private owner-only files and supplies signing values directly to the child process. Never put the password in command arguments, git, public build logs or a release attachment. Use the same package `com.wingman.canopy`; increment `versionCode` for every future release.

## Publishing

Review the exact public source tree, excluding operational instructions, private records, signing files, emulator data and local git history. Publish only a reviewed clean export when the local history is private. Attach the verified release APK and SHA-256 checksum to the source forge release.

Use current [Zapstore publishing documentation](https://zapstore.dev/docs/publish) and [zsp](https://github.com/zapstore/zsp). The supported external-signing path in zsp 0.4.17 uses `SIGN_WITH=<public-npub>` and `publish --offline --json` to prepare unsigned events. Sign the reviewed templates through the authorized capability broker, verify the returned publisher/fields/signatures, replace release asset references with the actual signed asset ID, and publish to the Zapstore relay. Do not export identity secrets or use an invented bunker credential. Newer zsp versions may have a different interface; verify before use.

For the certificate link, use `zsp identity --link-key ... --offline` with the public publisher and privately supplied keystore password. The certificate proof timestamp must match the broker-signed timestamp exactly. Verify the RSA proof against the exported public certificate. Publish the app, asset, release and certificate proof; reconcile uncertain deliveries before retrying. Relay acceptance is not availability: verify readback, the public listing and downloaded APK hash separately.

Protocol references: [NIP-55](https://github.com/nostr-protocol/nips/blob/master/55.md), [Amber](https://github.com/greenart7c3/Amber).
