package com.wingman.canopy

import androidx.lifecycle.lifecycleScope
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import fr.acinq.secp256k1.Secp256k1
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The signed release's actual repository + real Amber, with a controlled TLS relay. */
class ControlledNativeTest {
    @Test
    fun actualNativePublishReplaceFollowReplyAndOfflineCache() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("controlledNative") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as CanopyApplication
        val original = app.dependencies
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls =
            HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val records = ConcurrentHashMap<String, Event>()
        val subscriptions = ConcurrentHashMap<String, List<JSONObject>>()
        val received = java.util.concurrent.CopyOnWriteArrayList<Event>()
        val uploads = java.util.concurrent.CopyOnWriteArrayList<Event>()
        val walletSecret = ("0".repeat(63) + "1").bytes()
        val walletPubkey = Secp256k1.pubkeyCreate(walletSecret).copyOfRange(1, 33).hex()
        fun walletEvent(kind: Int, content: String, tags: List<List<String>> = emptyList()): Event {
            val event = Event.template(walletPubkey, kind, content, tags)
            return event.copy(
                sig = Secp256k1.signSchnorr(event.id.bytes(), walletSecret, ByteArray(32)).hex()
            )
        }
        fun acceptUpload(request: okhttp3.mockwebserver.RecordedRequest): MockResponse {
            val token =
                request.getHeader("Authorization")?.removePrefix("Nostr ")
                    ?: error("No Blossom authorization")
            val auth =
                Event.parse(
                    JSONObject(
                        android.util.Base64.decode(token, android.util.Base64.NO_WRAP)
                            .toString(Charsets.UTF_8)
                    )
                )
            val hash = sha256(request.body.readByteArray()).hex()
            check(
                auth.valid() &&
                    auth.kind == 24242 &&
                    hash in auth.values("x") &&
                    "upload" in auth.values("t") &&
                    auth.values("expiration").first().toLong() > now()
            )
            uploads.add(auth)
            return MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    JSONObject()
                        .put("url", "https://blossom.example/$hash.png")
                        .put("sha256", hash)
                        .toString()
                )
        }
        val server = MockWebServer().apply { useHttps(serverTls.sslSocketFactory(), false) }
        // Amber pauses and resumes the app. Every reconnect receives the same controlled relay.
        server.dispatcher =
            object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(
                    request: okhttp3.mockwebserver.RecordedRequest
                ): MockResponse =
                    if (request.method == "PUT" && request.path == "/upload") acceptUpload(request)
                    else
                        MockResponse()
                            .withWebSocketUpgrade(
                                object : WebSocketListener() {
                                    override fun onMessage(webSocket: WebSocket, text: String) {
                                        val a = JSONArray(text)
                                        when (a.optString(0)) {
                                            "REQ" -> {
                                                val id = a.getString(1)
                                                val filters =
                                                    (2 until a.length()).map { a.getJSONObject(it) }
                                                subscriptions[id] = filters
                                                records.values
                                                    .sortedByDescending { it.createdAt }
                                                    .filter { e ->
                                                        filters.any {
                                                            RelayTransport.matches(e, it)
                                                        }
                                                    }
                                                    .take(256)
                                                    .forEach {
                                                        webSocket.send(
                                                            JSONArray()
                                                                .put("EVENT")
                                                                .put(id)
                                                                .put(it.json())
                                                                .toString()
                                                        )
                                                    }
                                                webSocket.send(
                                                    JSONArray().put("EOSE").put(id).toString()
                                                )
                                            }
                                            "CLOSE" -> subscriptions.remove(a.getString(1))
                                            "EVENT" -> {
                                                val e = Event.parse(a.getJSONObject(1))
                                                check(e.valid())
                                                records[e.id] = e
                                                received.add(e)
                                                if (e.kind == 23194) {
                                                    check("nip44_v2" in e.values("encryption"))
                                                    val command =
                                                        JSONObject(
                                                            com.vitorpamplona.quartz.nip44Encryption
                                                                .Nip44
                                                                .v2
                                                                .decrypt(
                                                                    e.content,
                                                                    walletSecret,
                                                                    e.pubkey.bytes(),
                                                                )
                                                        )
                                                    check(
                                                        command.getString("method") == "pay_invoice"
                                                    )
                                                    val payload =
                                                        JSONObject()
                                                            .put("result_type", "pay_invoice")
                                                            .put(
                                                                "result",
                                                                JSONObject()
                                                                    .put("preimage", "f".repeat(64)),
                                                            )
                                                            .toString()
                                                    val response =
                                                        walletEvent(
                                                            23195,
                                                            com.vitorpamplona.quartz.nip44Encryption
                                                                .Nip44
                                                                .encrypt(
                                                                    payload,
                                                                    walletSecret,
                                                                    e.pubkey.bytes(),
                                                                )
                                                                .encodePayload(),
                                                            listOf(
                                                                listOf("p", e.pubkey),
                                                                listOf("e", e.id),
                                                                listOf("encryption", "nip44_v2"),
                                                            ),
                                                        )
                                                    records[response.id] = response
                                                    subscriptions.forEach { (id, filters) ->
                                                        if (
                                                            filters.any {
                                                                RelayTransport.matches(response, it)
                                                            }
                                                        )
                                                            webSocket.send(
                                                                JSONArray()
                                                                    .put("EVENT")
                                                                    .put(id)
                                                                    .put(response.json())
                                                                    .toString()
                                                            )
                                                    }
                                                }
                                                webSocket.send(
                                                    JSONArray()
                                                        .put("OK")
                                                        .put(e.id)
                                                        .put(true)
                                                        .put("controlled native acceptance")
                                                        .toString()
                                                )
                                                subscriptions.forEach { (id, filters) ->
                                                    if (
                                                        filters.any {
                                                            RelayTransport.matches(e, it)
                                                        }
                                                    )
                                                        webSocket.send(
                                                            JSONArray()
                                                                .put("EVENT")
                                                                .put(id)
                                                                .put(e.json())
                                                                .toString()
                                                        )
                                                }
                                            }
                                        }
                                    }

                                    override fun onClosing(
                                        webSocket: WebSocket,
                                        code: Int,
                                        reason: String,
                                    ) {
                                        webSocket.close(code, reason)
                                    }
                                }
                            )
            }
        server.start()
        val url = server.url("/").toString().replace("https://", "wss://").trimEnd('/')
        app.dependencies =
            NativeDependencies(
                OkHttpClient.Builder()
                    .sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
                    .addInterceptor { chain ->
                        val request = chain.request()
                        chain.proceed(
                            if (request.url.host == "blossom.example")
                                request
                                    .newBuilder()
                                    .url(server.url(request.url.encodedPath))
                                    .build()
                            else request
                        )
                    }
                    .build()
            )
        val device = UiDevice.getInstance(instrumentation)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var model: CanopyModel
                scenario.onActivity {
                    model = it.model
                    model.foreground(false)
                }
                fun waitUntil(condition: () -> Boolean) {
                    val deadline = System.currentTimeMillis() + 20000
                    while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(100)
                    assertTrue(condition())
                }
                val login = CompletableDeferred<String>()
                scenario.onActivity {
                    it.lifecycleScope.launch { login.complete(model.signer.login()) }
                }
                device
                    .wait(Until.findObject(By.text("Manually approve each permission")), 5000)
                    ?.click()
                device.wait(Until.findObject(By.text("Connect")), 5000)?.click()
                val key = runBlocking { withTimeout(20000) { login.await() } }
                scenario.onActivity {
                    model.account.value = key
                    model.storage.remember(key)
                    model.saveSettings(NetworkSettings(listOf(url), listOf(url)))
                    model.foreground(true)
                }
                waitUntil { model.transport.status.value[url] == true && !model.loading.value }
                fun action(name: String, perform: () -> Unit, check: () -> Boolean) {
                    scenario.onActivity { perform() }
                    val accept = device.wait(Until.findObject(By.text("Accept")), 15000)
                    assertNotNull("Amber approval: $name", accept)
                    accept!!.click()
                    waitUntil { !model.busy.value }
                    assertTrue("Controlled relay result: $name; ${model.message.value}", check())
                }
                action(
                    "profile",
                    {
                        model.editProfile(
                            mapOf(
                                "display_name" to "Native Amber Tester",
                                "about" to "Controlled native test",
                            )
                        ) {}
                    },
                    {
                        received.any {
                            it.kind == 0 &&
                                JSONObject(it.content).optString("display_name") ==
                                    "Native Amber Tester"
                        }
                    },
                )
                action(
                    "note",
                    { model.post("Native controlled publication 🌱\nNo public relay.") {} },
                    {
                        received.any {
                            it.kind == 1 && it.content.startsWith("Native controlled publication")
                        }
                    },
                )
                val note = received.last { it.kind == 1 }
                assertTrue(
                    "New native publication must render without navigation or refresh",
                    device.wait(Until.hasObject(By.text(note.content)), 5000),
                )
                action(
                    "reply",
                    { model.post("A native threaded reply", note, false) {} },
                    { received.any { it.kind == 1 && it.parent() == note.id } },
                )
                action(
                    "quote",
                    { model.post("Native quote", note, true) {} },
                    { received.any { it.kind == 1 && note.id in it.values("q") } },
                )
                action(
                    "reaction",
                    { model.like(note) },
                    { received.any { it.kind == 7 && note.id in it.values("e") } },
                )
                action(
                    "repost",
                    { model.repost(note) },
                    { received.any { it.kind == 6 && note.id in it.values("e") } },
                )
                action(
                    "bookmark",
                    { model.bookmark(note) },
                    { received.any { it.kind == 10003 && note.id in it.values("e") } },
                )
                val peer =
                    Secp256k1.pubkeyCreate(("0".repeat(63) + "1").bytes()).copyOfRange(1, 33).hex()
                action(
                    "follow",
                    { model.follow(peer) },
                    { received.any { it.kind == 3 && peer in it.values("p") } },
                )
                val resolver = instrumentation.targetContext.contentResolver
                val uri =
                    resolver.insert(
                        android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        android.content.ContentValues().apply {
                            put(
                                android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                                "Canopy native controlled image.png",
                            )
                            put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                        },
                    )!!
                try {
                    resolver.openOutputStream(uri)!!.use { output ->
                        instrumentation.targetContext.resources
                            .openRawResource(R.drawable.ic_canopy)
                            .use { it.copyTo(output) }
                    }
                    val uploaded = CompletableDeferred<Result<String>>()
                    scenario.onActivity { activity ->
                        activity.lifecycleScope.launch {
                            uploaded.complete(
                                runCatching {
                                    model.media.upload(
                                        activity,
                                        uri,
                                        listOf("https://blossom.example"),
                                        key,
                                        model.signer,
                                    )
                                }
                            )
                        }
                    }
                    val accept = device.wait(Until.findObject(By.text("Accept")), 15000)
                    assertNotNull("Amber Blossom authorization", accept)
                    accept!!.click()
                    val imageUrl = runBlocking {
                        withTimeout(20000) { uploaded.await().getOrThrow() }
                    }
                    assertTrue(imageUrl.startsWith("https://blossom.example/"))
                    assertEquals(1, uploads.size)
                } finally {
                    resolver.delete(uri, null, null)
                }
                val walletInfo =
                    walletEvent(
                        13194,
                        "pay_invoice get_info",
                        listOf(listOf("encryption", "nip44_v2")),
                    )
                records[walletInfo.id] = walletInfo
                val walletUri =
                    android.net.Uri.Builder()
                        .scheme("nostr+walletconnect")
                        .authority(walletPubkey)
                        .appendQueryParameter("relay", url)
                        .appendQueryParameter("secret", "0".repeat(63) + "2")
                        .build()
                        .toString()
                val paid = CompletableDeferred<Result<Unit>>()
                scenario.onActivity { activity ->
                    activity.lifecycleScope.launch {
                        paid.complete(
                            runCatching {
                                model.media.pay(walletUri, "lnbccontrolledprotocolfixture")
                            }
                        )
                    }
                }
                runBlocking { withTimeout(20000) { paid.await().getOrThrow() } }
                assertTrue(received.any { it.kind == 23194 })
                scenario.onActivity { model.foreground(false) }
                assertTrue(model.feed().any { it.id == note.id })
                assertTrue(runBlocking { model.cache.load() }.any { it.id == note.id })
                scenario.onActivity { model.foreground(true) }
                waitUntil { model.transport.status.value[url] == true }
                device.executeShellCommand("mkdir -p /data/local/tmp/canopy-native-validation")
                device.executeShellCommand(
                    "screencap -p /data/local/tmp/canopy-native-validation/controlled-native-feed.png"
                )
                val file =
                    File(
                        instrumentation.targetContext.getExternalFilesDir(null),
                        "controlled-results.json",
                    )
                file.writeText(
                    JSONObject()
                        .put("package", BuildConfig.APPLICATION_ID)
                        .put("version", BuildConfig.VERSION_NAME)
                        .put("relay", url)
                        .put("acceptedEvents", jsonArray(received.map { it.json() }))
                        .put("simulatedNwcProtocol", true)
                        .put("livePayment", false)
                        .put("blossomAuthorizations", jsonArray(uploads.map { it.json() }))
                        .put("publicRelayPublication", false)
                        .put("offlineCache", true)
                        .toString(2)
                )
                device.executeShellCommand(
                    "cp ${file.absolutePath} /data/local/tmp/canopy-native-validation/controlled-results.json"
                )
            }
        } finally {
            app.dependencies = original
            server.shutdown()
        }
    }
}
