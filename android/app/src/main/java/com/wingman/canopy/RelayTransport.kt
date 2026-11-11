package com.wingman.canopy

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject

/** Native NIP-01 transport. One pool per repository; bounded ingress and verified events. */
class RelayTransport(
    private val scope: CoroutineScope,
    val http: OkHttpClient =
        OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .callTimeout(25, TimeUnit.SECONDS)
            .build(),
    private val verifyIngress: (Event) -> Boolean = Event::valid,
) {
    data class Subscription(
        val filters: List<JSONObject>,
        val receive: (Event) -> Unit,
        val eose: (String) -> Unit,
        val targets: Set<String>?,
        val ended: MutableSet<String> = mutableSetOf(),
    )

    private inner class Connection(val url: String) {
        var socket: WebSocket? = null
        var connected = false
        var retry: Job? = null
        var failures = 0
        var generation = 0L

        fun owns(ws: WebSocket, token: Long) =
            active && generation == token && socket === ws && connections[url] === this

        fun connect() {
            if (socket != null || !active) return
            val token = ++generation
            socket =
                http.newWebSocket(
                    Request.Builder().url(url).build(),
                    object : WebSocketListener() {
                        override fun onOpen(ws: WebSocket, response: Response) {
                            scope.launch {
                                if (!owns(ws, token)) {
                                    ws.close(1000, "inactive")
                                    return@launch
                                }
                                connected = true
                                failures = 0
                                subscriptions.forEach { (id, s) ->
                                    if (s.targets == null || url in s.targets) {
                                        s.ended.remove(url)
                                        sendRequest(ws, id, s.filters)
                                    }
                                }
                                updateStatus()
                            }
                        }

                        override fun onMessage(ws: WebSocket, text: String) {
                            if (
                                text.length > 262144 ||
                                    !ingress
                                        .trySend(Frame(this@Connection, ws, token, text))
                                        .isSuccess
                            ) {
                                ws.cancel() // Overflow fails this connection; bounded reconnect
                                // resubscribes.
                            }
                        }

                        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                            scope.launch { if (owns(ws, token)) failed() }
                        }

                        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                            scope.launch { if (owns(ws, token)) failed() }
                        }

                        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                            ws.close(code, reason)
                        }
                    },
                )
        }

        fun failed() {
            socket = null
            connected = false
            updateStatus()
            if (active && connections[url] === this) {
                retry?.cancel()
                retry = scope.launch {
                    delay(min(30000L, 1000L shl min(failures++, 5)))
                    connect()
                }
            }
        }

        fun close() {
            generation++
            retry?.cancel()
            socket?.close(1000, "lifecycle")
            socket = null
            connected = false
        }
    }

    private data class Frame(
        val connection: Connection,
        val socket: WebSocket,
        val token: Long,
        val text: String,
    )

    private val ingress = Channel<Frame>(128)
    private val consumer = scope.launch {
        for (frame in ingress) if (frame.connection.owns(frame.socket, frame.token))
            handle(frame.connection.url, frame.text) {
                frame.connection.owns(frame.socket, frame.token)
            }
    }
    private val connections = linkedMapOf<String, Connection>()
    private val subscriptions = linkedMapOf<String, Subscription>()
    private val pending =
        ConcurrentHashMap<String, MutableMap<String, CompletableDeferred<Boolean>>>()
    private var active = false
    private val _status = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val status = _status.asStateFlow()

    private fun updateStatus() {
        _status.value = connections.mapValues { it.value.connected }
    }

    private fun sendRequest(ws: WebSocket, id: String, filters: List<JSONObject>) {
        ws.send(JSONArray().put("REQ").put(id).apply { filters.forEach(::put) }.toString())
    }

    fun start(urls: List<String>) {
        active = true
        configure(urls)
    }

    fun configure(urls: List<String>) {
        val wanted = urls.filter(::safeRelay).distinct().take(24)
        connections.keys
            .toList()
            .filter { it !in wanted }
            .forEach { connections.remove(it)?.close() }
        wanted.forEach { url -> connections.getOrPut(url) { Connection(url) }.connect() }
        updateStatus()
    }

    fun pause() {
        active = false
        connections.values.forEach { it.close() }
        updateStatus()
    }

    fun subscribe(
        filters: List<JSONObject>,
        receive: (Event) -> Unit,
        eose: (String) -> Unit = {},
        targets: Set<String>? = null,
    ): () -> Unit {
        val id = UUID.randomUUID().toString()
        subscriptions[id] =
            Subscription(filters.map { JSONObject(it.toString()) }, receive, eose, targets)
        connections.values
            .filter { it.connected && (targets == null || it.url in targets) }
            .forEach { it.socket?.let { ws -> sendRequest(ws, id, filters) } }
        return {
            subscriptions.remove(id)
            connections.values.forEach {
                it.socket?.send(JSONArray().put("CLOSE").put(id).toString())
            }
        }
    }

    private suspend fun handle(relay: String, text: String, current: () -> Boolean) {
        runCatching {
            val a = JSONArray(text)
            when (a.optString(0)) {
                "EVENT" -> {
                    val s = subscriptions[a.optString(1)] ?: return
                    if (s.targets != null && relay !in s.targets) return
                    val e = Event.parse(a.getJSONObject(2))
                    if (
                        withContext(Dispatchers.Default) { verifyIngress(e) } &&
                            current() &&
                            subscriptions[a.optString(1)] === s &&
                            s.filters.any { matches(e, it) }
                    )
                        s.receive(e)
                }
                "EOSE" ->
                    subscriptions[a.optString(1)]?.let { s ->
                        if ((s.targets == null || relay in s.targets) && s.ended.add(relay))
                            s.eose(relay)
                    }
                "OK" -> pending[a.optString(1)]?.get(relay)?.complete(a.optBoolean(2))
                "CLOSED" -> Unit // CLOSED is a refusal, never proof of a complete query.
            }
        }
    }

    data class FetchResult(
        val events: List<Event>,
        val completed: Set<String>,
        val requested: Set<String>,
    ) {
        val reliable
            get() = requested.isNotEmpty() && completed.containsAll(requested)
    }

    suspend fun fetchResult(
        filters: List<JSONObject>,
        timeout: Long = 5000,
        targets: Set<String>? = null,
    ): FetchResult {
        val wanted = targets ?: connections.keys.toSet()
        val found = linkedMapOf<String, Event>()
        val done = CompletableDeferred<Unit>()
        val ended = mutableSetOf<String>()
        val close =
            subscribe(
                filters,
                { found[it.id] = it },
                { relay ->
                    ended.add(relay)
                    if (ended.containsAll(wanted)) done.complete(Unit)
                },
                wanted,
            )
        try {
            withTimeoutOrNull(timeout) { done.await() }
        } finally {
            close()
        }
        return FetchResult(found.values.toList(), ended.toSet(), wanted)
    }

    suspend fun fetch(
        filters: List<JSONObject>,
        timeout: Long = 5000,
        targets: Set<String>? = null,
    ) = fetchResult(filters, timeout, targets).events

    suspend fun publish(
        event: Event,
        urls: List<String>,
        stillAuthorized: () -> Boolean = { true },
    ): Pair<Int, Int> {
        require(event.valid()) { "Refusing invalid event." }
        require(urls.isNotEmpty()) { "No write relays configured." }
        // Returning from Amber may precede WebSocket reconnection. Keep the exact signature.
        withTimeoutOrNull(12000) { status.first { s -> urls.any { s[it] == true } } }
        require(stillAuthorized()) { "Account changed; publication cancelled." }
        val waits = urls.associateWith { CompletableDeferred<Boolean>() }.toMutableMap()
        check(pending.putIfAbsent(event.id, waits) == null) { "This event is already publishing." }
        val outcome = Channel<Boolean>(urls.size)
        val observers = waits.values.map { d -> scope.launch { outcome.send(d.await()) } }
        try {
            urls.forEach { url ->
                val c = connections[url]
                if (c?.connected == true) {
                    if (
                        c.socket?.send(JSONArray().put("EVENT").put(event.json()).toString()) !=
                            true
                    )
                        waits[url]?.complete(false)
                } else waits[url]?.complete(false)
            }
            var accepted = 0
            withTimeoutOrNull(12000) {
                repeat(urls.size) {
                    if (outcome.receive()) {
                        accepted = 1
                        return@withTimeoutOrNull
                    }
                }
            }
            require(accepted > 0) {
                "No relay confirmed publication. Your draft is retained; check connectivity before retrying."
            }
            return accepted to urls.size
        } finally {
            pending.remove(event.id)
            observers.forEach { it.cancel() }
            outcome.close()
        }
    }

    fun close() {
        pause()
        consumer.cancel()
        ingress.close()
        subscriptions.clear()
        pending.values.forEach { it.values.forEach { d -> d.cancel() } }
        pending.clear()
    }

    companion object {
        fun matches(e: Event, f: JSONObject): Boolean {
            fun includes(name: String, value: String): Boolean {
                val a = f.optJSONArray(name) ?: return true
                return a.strings().any { value.startsWith(it) }
            }
            if (!includes("ids", e.id) || !includes("authors", e.pubkey)) return false
            f.optJSONArray("kinds")?.let { a ->
                if ((0 until a.length()).none { a.getInt(it) == e.kind }) return false
            }
            if (
                e.createdAt < f.optLong("since", 0) ||
                    e.createdAt > f.optLong("until", Long.MAX_VALUE)
            )
                return false
            f.keys().forEach { key ->
                if (key.startsWith("#")) {
                    val wanted = f.getJSONArray(key).strings()
                    if (
                        e.tags.none { it.firstOrNull() == key.drop(1) && it.getOrNull(1) in wanted }
                    )
                        return false
                }
            }
            return true
        }
    }
}

fun filter(
    kinds: List<Int>? = null,
    authors: List<String>? = null,
    ids: List<String>? = null,
    limit: Int = 100,
    until: Long? = null,
    tag: Pair<String, List<String>>? = null,
) =
    JSONObject().apply {
        kinds?.let { put("kinds", jsonArray(it)) }
        authors?.let { put("authors", jsonArray(it)) }
        ids?.let { put("ids", jsonArray(it)) }
        put("limit", limit)
        until?.let { put("until", it) }
        tag?.let { put("#${it.first}", jsonArray(it.second)) }
    }
