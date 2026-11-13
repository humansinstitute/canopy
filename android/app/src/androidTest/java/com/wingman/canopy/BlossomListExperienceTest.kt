package com.wingman.canopy

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import fr.acinq.secp256k1.Secp256k1
import java.util.concurrent.CopyOnWriteArrayList
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.tls.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain

/** Isolated TLS relay and disposable signer exercise the real native model and Compose UI. */
class BlossomListExperienceTest {
    private val ui = createAndroidComposeRule<MainActivity>()
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as CanopyApplication
    private val secret = ("0".repeat(63) + "1").bytes()
    private val key = Secp256k1.pubkeyCreate(secret).copyOfRange(1, 33).hex()
    private fun signed(e: Event) = e.copy(sig = Secp256k1.signSchnorr(e.id.bytes(), secret, ByteArray(32)).hex())
    @Volatile private var remote = signed(Event.template(key, 10063, "", listOf(listOf("server", "https://one.example/path", "retain"), listOf("server", "https://two.example"), listOf("custom", "keep")), now() - 30))
    @Volatile private var timeoutEvent: Event? = null
    @Volatile private var absent = false
    @Volatile private var changeDuringSign = false
    @Volatile private var accept = true
    @Volatile private var cancel = false
    private val received = CopyOnWriteArrayList<Event>()
    private val server = MockWebServer()
    private lateinit var original: NativeDependencies
    private lateinit var url: String
    private val fixture = object : ExternalResource() {
        override fun before() {
            original = app.dependencies
            val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
            val tls = HandshakeCertificates.Builder().heldCertificate(cert).build()
            val trusted = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
            server.useHttps(tls.sslSocketFactory(), false)
            server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: RecordedRequest) = MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onMessage(ws: WebSocket, text: String) {
                        val a = JSONArray(text)
                        if (a.optString(0) == "REQ") {
                            if (request.path == "/closed") {
                                ws.send(JSONArray().put("CLOSED").put(a.getString(1)).put("blocked").toString()); return
                            }
                            if (request.path == "/reject") { ws.close(1000, "offline"); return }
                            if (request.path == "/timeout") {
                                timeoutEvent?.let { ws.send(JSONArray().put("EVENT").put(a.getString(1)).put(it.json()).toString()) }
                                return
                            }
                            if (!absent) ws.send(JSONArray().put("EVENT").put(a.getString(1)).put(remote.json()).toString())
                            ws.send(JSONArray().put("EOSE").put(a.getString(1)).toString())
                        } else if (a.optString(0) == "EVENT") {
                            val event = Event.parse(a.getJSONObject(1)); received.add(event)
                            if (accept) remote = event
                            ws.send(JSONArray().put("OK").put(event.id).put(accept).put(if (accept) "stored" else "blocked").toString())
                        }
                    }
                    override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, reason) }
                })
            }
            server.start()
            url = server.url("/").toString().replace("https://", "wss://").trimEnd('/')
            app.dependencies = original.copy(http = OkHttpClient.Builder().sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager).build())
        }
        override fun after() { app.dependencies = original; server.shutdown() }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(fixture).around(ui)

    private fun capture(name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.getExternalFilesDir(null), name).outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun editConfirmCancelRejectStaleAndAccountIsolation() {
        val model = ui.activity.model
        ui.waitUntil(10000) { model.initialized.value }
        var signs = 0
        ui.runOnIdle {
            model.foreground(false)
            model.account.value = key
            model.events.value = emptyList()
            model.settings.value = NetworkSettings(listOf(url, "$url/timeout", "$url/closed", "$url/reject"), listOf(url), listOf("https://local.example"))
            model.storage.put(key, "network", model.settings.value.json())
            model.transport.start(model.settings.value.read)
            model.signer.launch = { intent ->
                signs++
                if (cancel) model.signer.result(ActivityResult(Activity.RESULT_CANCELED, null))
                else {
                    val request = Event.parse(org.json.JSONObject(intent.data!!.schemeSpecificPart))
                    if (changeDuringSign) remote = signed(Event.template(key, 10063, "", listOf(listOf("server", "https://during.example")), remote.createdAt + 1))
                    model.signer.result(ActivityResult(Activity.RESULT_OK, Intent().putExtra("id", intent.getStringExtra("id")).putExtra("event", signed(request).json().toString())))
                }
            }
            ui.activity.setContent { CanopyTheme { SettingsPage(model) } }
        }
        fun click(text: String) = ui.onNodeWithText(text, substring = false).performScrollTo().performClick()
        click("Load published list")
        ui.waitUntil(10000) { !model.busy.value }
        ui.onNodeWithText("https://one.example/path").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Only 1 of 4", substring = true).performScrollTo().assertIsDisplayed()
        capture("blossom-partial-existing.png")
        click("Up 2")
        click("Publish profile list")
        ui.onNodeWithText("Publish Blossom list?").assertIsDisplayed()
        ui.onNodeWithText("Cancel", substring = false).performClick()
        assertEquals(0, signs)
        cancel = true
        click("Publish profile list")
        ui.onNodeWithText("Confirm publish").performClick()
        ui.waitUntil(10000) { !model.busy.value }
        assertTrue(model.message.value!!.contains("cancelled"))
        assertTrue(received.isEmpty())
        cancel = false
        click("Publish profile list")
        ui.onNodeWithText("Confirm publish").performClick()
        ui.waitUntil(15000) { !model.busy.value }
        assertEquals(1, received.size)
        assertEquals(listOf(listOf("server", "https://two.example"), listOf("server", "https://one.example/path", "retain"), listOf("custom", "keep")), received.first().tags)
        assertEquals("", received.first().content)
        assertEquals(listOf("https://local.example"), model.settings.value.blossom)
        assertTrue(model.message.value!!.contains("1 of 1 relays confirmed"))
        // Avoid the just-published second when testing the explicit future-date safety rule.
        ui.waitUntil(5000) { now() >= remote.createdAt }
        accept = false
        click("Publish profile list")
        ui.onNodeWithText("Confirm publish").performClick()
        ui.waitUntil(15000) { !model.busy.value }
        assertTrue(model.message.value!!.contains("No relay confirmed"))
        val before = signs
        remote = signed(Event.template(key, 10063, "", listOf(listOf("server", "https://new.example")), remote.createdAt + 1))
        click("Publish profile list")
        ui.onNodeWithText("Confirm publish").performClick()
        ui.waitUntil(15000) { !model.busy.value }
        assertTrue(model.message.value!!.contains("newer Blossom list"))
        assertEquals(before, signs)
        click("Reload published list")
        ui.onNodeWithText("Reload", substring = false).performClick()
        ui.waitUntil(10000) { !model.busy.value }
        ui.waitUntil(5000) { now() >= remote.createdAt }
        changeDuringSign = true
        click("Publish profile list")
        ui.onNodeWithText("Confirm publish").performClick()
        ui.waitUntil(15000) { !model.busy.value }
        assertTrue(model.message.value!!.contains("during signer approval"))
        assertEquals(before + 1, signs)
        changeDuringSign = false
        // A valid newer event before missing EOSE still contributes to newest known state.
        timeoutEvent = signed(Event.template(key, 10063, "", listOf(listOf("server", "https://timeout-newer.example")), remote.createdAt + 1))
        click("Reload published list")
        ui.onNodeWithText("Reload", substring = false).performClick()
        ui.waitUntil(10000) { !model.busy.value }
        ui.onNodeWithText("https://timeout-newer.example").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Keeping your newest verified cached list", substring = true).performScrollTo().assertIsDisplayed()
        timeoutEvent = null
        // A partial absence keeps the newest verified cache and warns persistently.
        absent = true
        click("Reload published list")
        ui.onNodeWithText("Reload", substring = false).performClick()
        ui.waitUntil(10000) { !model.busy.value }
        ui.onNodeWithText("Keeping your newest verified cached list", substring = true).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("https://timeout-newer.example").performScrollTo().assertIsDisplayed()
        ui.runOnIdle { model.account.value = "b".repeat(64) }
        ui.onNodeWithText("Load published list").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Publish profile list").assertDoesNotExist()
        ui.runOnIdle { model.transport.pause(); model.storage.put(key, "network", ""); model.account.value = null }
    }

    @Test fun partialAbsenceCreatesDraftOnlyAfterExplicitConfirmationAndAllOfflineNeverSigns() {
        absent = true
        val model = ui.activity.model
        ui.waitUntil(10000) { model.initialized.value }
        var signs = 0
        ui.runOnIdle {
            model.foreground(false)
            model.account.value = key
            model.events.value = emptyList()
            model.settings.value = NetworkSettings(listOf(url, "$url/timeout", "$url/closed", "$url/reject"), listOf(url), listOf("https://local.example"))
            model.storage.put(key, "network", model.settings.value.json())
            model.transport.start(model.settings.value.read)
            model.signer.launch = { intent ->
                signs++
                if (cancel) model.signer.result(ActivityResult(Activity.RESULT_CANCELED, null))
                else {
                    val request = Event.parse(org.json.JSONObject(intent.data!!.schemeSpecificPart))
                    if (changeDuringSign) remote = signed(Event.template(key, 10063, "", listOf(listOf("server", "https://during.example")), remote.createdAt + 1))
                    model.signer.result(ActivityResult(Activity.RESULT_OK, Intent().putExtra("id", intent.getStringExtra("id")).putExtra("event", signed(request).json().toString())))
                }
            }
            ui.activity.setContent { CanopyTheme { SettingsPage(model) } }
        }

        absent = true
        fun click(text: String) = ui.onNodeWithText(text, substring = false).performScrollTo().performClick()
        click("Load published list")
        ui.waitUntil(10000) { !model.busy.value }
        ui.onNodeWithText("No list found on responding relays", substring = true).performScrollTo().assertIsDisplayed()
        capture("blossom-partial-absence.png")
        click("Copy local servers to draft")
        assertEquals(0, signs)
        assertTrue(received.isEmpty())
        click("Publish profile list")
        ui.onNodeWithText("Coverage is incomplete", substring = true).assertIsDisplayed()
        ui.onNodeWithText("Cancel", substring = false).performClick()
        assertEquals(0, signs)
        click("Publish profile list")
        ui.onNodeWithText("Confirm publish").performClick()
        ui.waitUntil(15000) { !model.busy.value }
        assertEquals(1, signs)
        ui.onNodeWithText("No list found on responding relays", substring = true).assertDoesNotExist()
        assertEquals(10063, received.single().kind)
        assertEquals(listOf(listOf("server", "https://local.example")), received.single().tags)
        assertEquals(listOf("https://local.example"), model.settings.value.blossom)
        // Remove the only usable relay. Reload must fail and remove publish controls.
        ui.runOnIdle {
            model.settings.value = model.settings.value.copy(read = listOf("$url/timeout", "$url/closed", "$url/reject"), write = listOf("$url/timeout"))
            model.transport.start(model.settings.value.read)
        }
        click("Reload published list")
        ui.onNodeWithText("Reload", substring = false).performClick()
        ui.waitUntil(10000) { !model.busy.value }
        assertTrue(model.message.value!!.contains("No relay completed"))
        ui.onNodeWithText("Publish profile list").assertDoesNotExist()
        assertEquals(1, signs)
        ui.runOnIdle { model.transport.pause(); model.storage.put(key, "network", ""); model.account.value = null }
    }
}
