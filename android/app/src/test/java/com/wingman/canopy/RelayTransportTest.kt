package com.wingman.canopy

import fr.acinq.secp256k1.Secp256k1
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class RelayTransportTest {
    private open class ClosingListener : WebSocketListener() {
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
        }
    }

    private val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()

    private fun server() =
        MockWebServer().apply {
            val tls = HandshakeCertificates.Builder().heldCertificate(cert).build()
            useHttps(tls.sslSocketFactory(), false)
        }

    private fun http(): OkHttpClient {
        val tls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        return OkHttpClient.Builder()
            .sslSocketFactory(tls.sslSocketFactory(), tls.trustManager)
            .build()
    }

    private fun url(s: MockWebServer) =
        s.url("/").toString().replace("https://", "wss://").trimEnd('/')

    private fun event(): Event {
        val secret = ("0".repeat(63) + "1").bytes()
        val key = Secp256k1.pubkeyCreate(secret).copyOfRange(1, 33).hex()
        val e = Event.template(key, 1, "controlled relay test")
        return e.copy(sig = Secp256k1.signSchnorr(e.id.bytes(), secret, ByteArray(32)).hex())
    }

    @Test
    fun firstAcceptanceDoesNotWaitForSilentRelay() = runBlocking {
        val fast = server()
        val silent = server()
        fast.enqueue(
            MockResponse()
                .withWebSocketUpgrade(
                    object : ClosingListener() {
                        override fun onMessage(ws: WebSocket, text: String) {
                            val a = JSONArray(text)
                            if (a.optString(0) == "EVENT")
                                ws.send(
                                    JSONArray()
                                        .put("OK")
                                        .put(a.getJSONObject(1).getString("id"))
                                        .put(true)
                                        .put("")
                                        .toString()
                                )
                        }
                    }
                )
        )
        silent.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingListener() {}))
        fast.start()
        silent.start()
        val pool = RelayTransport(this, http())
        val urls = listOf(url(fast), url(silent))
        try {
            pool.start(urls)
            withTimeout(6000) { pool.status.first { it.values.count { v -> v } == 2 } }
            val start = System.currentTimeMillis()
            val result = withTimeout(2000) { pool.publish(event(), urls) }
            assertEquals(1, result.first)
            assertTrue(System.currentTimeMillis() - start < 2000)
        } finally {
            pool.close()
            fast.shutdown()
            silent.shutdown()
        }
    }

    @Test
    fun duplicateEoseCannotCompleteAnotherRelayAndClosedIsNotEose() = runBlocking {
        val one = server()
        val two = server()
        one.enqueue(
            MockResponse()
                .withWebSocketUpgrade(
                    object : ClosingListener() {
                        override fun onMessage(ws: WebSocket, text: String) {
                            val a = JSONArray(text)
                            if (a.optString(0) == "REQ")
                                repeat(5) {
                                    ws.send(JSONArray().put("EOSE").put(a.getString(1)).toString())
                                }
                        }
                    }
                )
        )
        two.enqueue(
            MockResponse()
                .withWebSocketUpgrade(
                    object : ClosingListener() {
                        override fun onMessage(ws: WebSocket, text: String) {
                            val a = JSONArray(text)
                            if (a.optString(0) == "REQ")
                                ws.send(
                                    JSONArray()
                                        .put("CLOSED")
                                        .put(a.getString(1))
                                        .put("blocked")
                                        .toString()
                                )
                        }
                    }
                )
        )
        one.start()
        two.start()
        val pool = RelayTransport(this, http())
        val urls = listOf(url(one), url(two))
        try {
            pool.start(urls)
            withTimeout(6000) { pool.status.first { it.values.count { v -> v } == 2 } }
            val result = pool.fetchResult(listOf(filter(listOf(1))), 500)
            assertFalse(result.reliable)
            assertEquals(setOf(url(one)), result.completed)
        } finally {
            pool.close()
            one.shutdown()
            two.shutdown()
        }
    }

    @Test
    fun pauseDiscardsOldSocketMessagesAndSubscriptionsClose() = runBlocking {
        val s = server()
        var old: WebSocket? = null
        val closes = AtomicInteger(0)
        s.enqueue(
            MockResponse()
                .withWebSocketUpgrade(
                    object : ClosingListener() {
                        override fun onOpen(ws: WebSocket, response: Response) {
                            old = ws
                        }

                        override fun onMessage(ws: WebSocket, text: String) {
                            if (JSONArray(text).optString(0) == "CLOSE") closes.incrementAndGet()
                        }
                    }
                )
        )
        s.start()
        val pool = RelayTransport(this, http())
        var received = 0
        try {
            pool.start(listOf(url(s)))
            withTimeout(6000) { pool.status.first { it.values.any { v -> v } } }
            val close = pool.subscribe(listOf(filter(listOf(1))), { received++ })
            close()
            delay(100)
            assertEquals(1, closes.get())
            pool.pause()
            old?.send(JSONArray().put("EVENT").put("stale").put(event().json()).toString())
            delay(100)
            assertEquals(0, received)
            assertFalse(pool.status.value.values.any { it })
        } finally {
            pool.close()
            s.shutdown()
        }
    }

    @Test
    fun verificationFinishingAfterPauseCannotDeliverToClosedSubscription() = runBlocking {
        val server = server()
        val e = event()
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        server.enqueue(
            MockResponse()
                .withWebSocketUpgrade(
                    object : ClosingListener() {
                        override fun onMessage(webSocket: WebSocket, text: String) {
                            val a = JSONArray(text)
                            if (a.optString(0) == "REQ")
                                webSocket.send(
                                    JSONArray()
                                        .put("EVENT")
                                        .put(a.getString(1))
                                        .put(e.json())
                                        .toString()
                                )
                        }
                    }
                )
        )
        server.start()
        val pool =
            RelayTransport(this, http()) { incoming ->
                entered.countDown()
                release.await(3, java.util.concurrent.TimeUnit.SECONDS)
                incoming.valid()
            }
        var received = 0
        try {
            pool.start(listOf(url(server)))
            withTimeout(6000) { pool.status.first { it.values.any { value -> value } } }
            val close = pool.subscribe(listOf(filter(listOf(1))), { received++ })
            withContext(Dispatchers.IO) {
                assertTrue(entered.await(3, java.util.concurrent.TimeUnit.SECONDS))
            }
            close()
            pool.pause()
            release.countDown()
            delay(200)
            assertEquals(0, received)
        } finally {
            release.countDown()
            pool.close()
            server.shutdown()
        }
    }
}
