package com.wingman.canopy

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

data class ZapOffer(
    val event: Event,
    val invoice: String,
    val sats: Long,
    val comment: String,
    val account: String,
)

class CanopyModel(app: Application) : AndroidViewModel(app) {
    val storage = AccountStorage(app)
    val cache = EventCache(app)
    val transport = RelayTransport(viewModelScope, (app as CanopyApplication).dependencies.http)
    val signer = AmberSigner()
    val media = NativeServices(transport)
    val account = MutableStateFlow(storage.get("device", "current").takeIf { hexKey.matches(it) })
    val events = MutableStateFlow<List<Event>>(emptyList())
    val settings = MutableStateFlow(NetworkSettings())
    val message = MutableStateFlow<String?>(null)
    val zapOffer = MutableStateFlow<ZapOffer?>(null)
    val busy = MutableStateFlow(false)
    val loading = MutableStateFlow(true)
    val initialized = MutableStateFlow(false)
    val draft = MutableStateFlow("")
    val seen = MutableStateFlow(0L)
    private var visible = false
    private var sessionJob: Job? = null
    private val subscriptions = mutableListOf<() -> Unit>()
    private val changes = Mutex()
    private val staged = linkedMapOf<String, Event>()
    private var flushJob: Job? = null
    private var oldest: Long? = null
    private var accountGeneration = 0L

    init {
        viewModelScope.launch {
            val initialGeneration = accountGeneration
            events.value =
                runCatching { cache.load() }
                    .getOrElse {
                        message.value =
                            "Local public cache could not load; online data is still available."
                        emptyList()
                    }
            if (initialGeneration == accountGeneration) select(account.value)
            initialized.value = true
        }
    }

    fun action(block: suspend () -> Unit) {
        if (busy.value) return
        viewModelScope.launch {
            busy.value = true
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                message.value = e.message ?: "Operation failed. Please retry."
            } finally {
                busy.value = false
            }
        }
    }

    fun login() = action {
        val generation = ++accountGeneration
        val key = signer.login()
        require(generation == accountGeneration) { "Login superseded by an account change." }
        select(key)
        message.value = "Connected to Amber."
    }

    fun switch(key: String) {
        if (busy.value) return
        accountGeneration++
        signer.cancel()
        action { select(key) }
    }

    fun logout() {
        accountGeneration++
        signer.cancel()
        viewModelScope.launch {
            storage.put("device", "current", "")
            select(null)
        }
    }

    private suspend fun select(key: String?) {
        val generation = accountGeneration
        sessionJob?.cancelAndJoin()
        if (generation != accountGeneration) return
        subscriptions.forEach { it() }
        subscriptions.clear()
        account.value = key
        zapOffer.value = null
        if (key != null) storage.remember(key)
        draft.value = key?.let { storage.get(it, "draft") } ?: ""
        seen.value = key?.let { storage.get(it, "seen", "0").toLongOrNull() } ?: 0
        settings.value =
            key?.let {
                NetworkSettings.fromJson(storage.get(it, "network"))
                    ?: NetworkSettings.profile(events.value, it)
            } ?: NetworkSettings()
        oldest = null
        reconnect()
    }

    fun draft(value: String) {
        if (value.length > 20000) return
        draft.value = value
        account.value?.let { storage.put(it, "draft", value) }
    }

    fun foreground(value: Boolean) {
        visible = value
        if (value) reconnect()
        else {
            sessionJob?.cancel()
            subscriptions.forEach { it() }
            subscriptions.clear()
            transport.pause()
        }
    }

    private fun reconnect() {
        if (!visible) return
        sessionJob?.cancel()
        subscriptions.forEach { it() }
        subscriptions.clear()
        val network = settings.value
        transport.start((network.read + network.write).distinct())
        val key =
            account.value
                ?: run {
                    loading.value = false
                    return
                }
        sessionJob = viewModelScope.launch {
            loading.value = true
            subscriptions +=
                transport.subscribe(
                    listOf(filter(listOf(0, 3, 10002, 10003, 10063), listOf(key))),
                    ::ingest,
                    targets = settings.value.read.toSet(),
                )
            subscriptions +=
                transport.subscribe(
                    listOf(filter(listOf(1, 6, 7, 16), tag = "p" to listOf(key))),
                    ::ingest,
                    targets = settings.value.read.toSet(),
                )
            delay(650)
            val remote = fetch(listOf(filter(listOf(0, 3, 10002, 10003, 10063), listOf(key))))
            remote.forEach(::ingest)
            flush()
            if (storage.get(key, "network").isBlank()) {
                val defaults = NetworkSettings.profile(events.value, key)
                settings.value = defaults
                transport.configure((defaults.read + defaults.write).distinct())
            }
            subscribeFollowing(key)
            while (isActive) {
                delay(60000)
                val last = storage.get(key, "profilesAt", "0").toLongOrNull() ?: 0
                if (now() - last > 86400) refreshIdentities(key)
            }
        }
    }

    private suspend fun fetch(filters: List<JSONObject>, timeout: Long = 5000) =
        transport.fetch(filters, timeout, settings.value.read.toSet())

    private suspend fun subscribeFollowing(key: String) {
        val follows =
            (latest(events.value, 3, key)?.values("p") ?: emptyList())
                .filter { hexKey.matches(it) }
                .distinct()
        val authors = (follows + key).distinct()
        authors.chunked(128).forEach { batch ->
            subscriptions +=
                transport.subscribe(
                    listOf(filter(listOf(1, 6, 7, 16, 9802), batch, limit = 100)),
                    ::ingest,
                    targets = settings.value.read.toSet(),
                )
        }
        var contacts = latest(events.value, 3, key)?.id
        subscriptions +=
            transport.subscribe(
                listOf(filter(listOf(3), listOf(key))),
                { e ->
                    ingest(e)
                    val current = latest(events.value, 3, key)
                    if (
                        e.id != contacts &&
                            (current == null ||
                                e.createdAt > current.createdAt ||
                                (e.createdAt == current.createdAt && e.id < current.id))
                    ) {
                        contacts = e.id
                        viewModelScope.launch {
                            delay(400)
                            flush()
                            reconnect()
                        }
                    }
                },
                targets = settings.value.read.toSet(),
            )
        loading.value = false
        val last = storage.get(key, "profilesAt", "0").toLongOrNull() ?: 0
        if (now() - last > 86400) refreshIdentities(key)
    }

    private suspend fun refreshIdentities(key: String) {
        val authors =
            ((latest(events.value, 3, key)?.values("p") ?: emptyList()) + key)
                .filter { hexKey.matches(it) }
                .distinct()
        authors.chunked(64).forEach { batch ->
            fetch(listOf(filter(listOf(0), batch, limit = 256))).forEach(::ingest)
        }
        flush()
        if (account.value == key && transport.status.value.any { it.value })
            storage.put(key, "profilesAt", now().toString())
    }

    fun refresh() = action {
        reconnect()
        message.value = "Refreshing active relays; cached notes remain available."
    }

    fun refreshCache() = action {
        val key = account.value ?: error("Connect Amber first.")
        fetch(listOf(filter(listOf(3), listOf(key)))).forEach(::ingest)
        flush()
        refreshIdentities(key)
        message.value = "Following profile refresh finished."
    }

    fun more() = action {
        val key = account.value ?: return@action
        val authors = ((latest(events.value, 3, key)?.values("p") ?: emptyList()) + key).distinct()
        val boundary = oldest ?: feed().minOfOrNull { it.createdAt } ?: now()
        val found =
            authors.chunked(128).flatMap {
                fetch(listOf(filter(listOf(1), it, limit = 50, until = boundary - 1)))
            }
        found.forEach(::ingest)
        flush()
        oldest = found.minOfOrNull { it.createdAt } ?: boundary
        if (found.isEmpty()) message.value = "No older posts returned by your relays."
    }

    private fun ingest(e: Event) {
        staged[e.id] = e
        if (flushJob?.isActive != true)
            flushJob = viewModelScope.launch {
                delay(100)
                flush()
            }
    }

    private suspend fun flush() {
        if (staged.isEmpty()) return
        val batch = staged.values.toList()
        staged.clear()
        events.value =
            (events.value + batch)
                .distinctBy { it.id }
                .sortedWith(compareByDescending<Event> { it.createdAt }.thenBy { it.id })
                .let { sorted ->
                    var notes = 0
                    var other = 0
                    sorted.filter { if (it.kind == 1) ++notes <= 21256 else ++other <= 2744 }
                }
        cache.put(batch)
    }

    fun profile(key: String): JSONObject = runCatching {
        JSONObject(latest(events.value, 0, key)?.content ?: "{}")
    }
        .getOrDefault(JSONObject())

    fun name(key: String) =
        profile(key).let {
            it.optString("display_name").ifBlank { it.optString("name").ifBlank { short(key) } }
        }

    fun followed() =
        account.value?.let { latest(events.value, 3, it)?.values("p")?.toSet() } ?: emptySet()

    fun feed() =
        events.value.filter {
            it.kind == 1 && (it.pubkey in followed() || it.pubkey == account.value)
        }

    fun markRead() {
        seen.value = now()
        account.value?.let { storage.put(it, "seen", seen.value.toString()) }
    }

    fun open(pointer: Pointer) = viewModelScope.launch {
        try {
            if (pointer.relays.isNotEmpty())
                transport.configure(
                    (settings.value.read + settings.value.write + pointer.relays).distinct()
                )
            val filters =
                if (pointer.kind == "profile") listOf(filter(listOf(0, 1), listOf(pointer.key)))
                else
                    listOf(
                        filter(ids = listOf(pointer.key)),
                        filter(listOf(1), tag = "e" to listOf(pointer.key)),
                    )
            transport
                .fetch(filters, targets = (settings.value.read + pointer.relays).toSet())
                .forEach(::ingest)
            flush()
            if (pointer.kind == "event") {
                val e = events.value.find { it.id == pointer.key }
                val ids = listOfNotNull(e?.root(), e?.parent()).distinct()
                if (ids.isNotEmpty()) {
                    fetch(listOf(filter(ids = ids), filter(listOf(1), tag = "e" to ids)))
                        .forEach(::ingest)
                    flush()
                }
            }
        } catch (e: Exception) {
            message.value = e.message
        }
    }

    fun openSaved(ids: List<String>) = viewModelScope.launch {
        fetch(listOf(filter(ids = ids.take(100)))).forEach(::ingest)
        flush()
    }

    fun moreProfile(key: String, before: Long) = action {
        fetch(listOf(filter(listOf(1), listOf(key), until = before - 1))).forEach(::ingest)
        flush()
    }

    suspend fun publish(template: Event): Event {
        val key = account.value ?: error("Connect Amber to publish.")
        val generation = accountGeneration
        require(template.pubkey == key)
        val signed = signer.sign(template)
        require(account.value == key && generation == accountGeneration) {
            "Account changed; publication cancelled."
        }
        val (accepted, total) =
            transport.publish(signed, settings.value.write) {
                account.value == key && generation == accountGeneration
            }
        ingest(signed)
        flush()
        message.value = "Published: $accepted of $total relays confirmed."
        return signed
    }

    fun post(text: String, target: Event? = null, quote: Boolean = false, onDone: () -> Unit) =
        action {
            val key = account.value ?: error("Connect Amber first.")
            val content = text.trim()
            require(content.isNotBlank() && content.length <= 2800) {
                "Write a note up to 2,800 characters."
            }
            val suffix = if (quote && target != null) "\nnostr:${eventRef(target)}" else ""
            val mentions =
                Regex("nostr:(?:npub1|nprofile1)[a-z0-9]+")
                    .findAll(content)
                    .mapNotNull { pointer(it.value)?.takeIf { p -> p.kind == "profile" }?.key }
                    .distinct()
                    .map { listOf("p", it) }
                    .toList()
            val tags =
                if (target == null) mentions
                else if (quote)
                    listOf(listOf("q", target.id, "", target.pubkey), listOf("p", target.pubkey)) +
                        mentions
                else replyTags(target) + mentions
            publish(Event.template(key, 1, content + suffix, tags.distinct()))
            if (target == null) draft("")
            onDone()
        }

    fun zap(
        event: Event,
        sats: Long? = null,
        comment: String? = null,
        onInvoice: ((ZapOffer) -> Unit)? = null,
        onPaid: () -> Unit = {},
    ) = action {
        val key = account.value ?: error("Connect Amber first.")
        val generation = accountGeneration
        val amount =
            sats
                ?: storage.get(key, "zapAmount", "21").toLongOrNull()
                ?: error("Choose a valid zap default.")
        val text = comment ?: storage.get(key, "zapMessage")
        if (profile(event.pubkey).optString("lud16").isBlank()) {
            fetch(listOf(filter(listOf(0), listOf(event.pubkey)))).forEach(::ingest)
            flush()
        }
        val invoice =
            media.invoice(
                event,
                profile(event.pubkey),
                amount,
                text,
                key,
                settings.value.read,
                signer,
            )
        require(account.value == key && generation == accountGeneration) {
            "Account changed; zap cancelled."
        }
        val offer = ZapOffer(event, invoice, amount, text, key)
        val wallet = storage.secret(key)
        if (wallet.isBlank()) {
            if (onInvoice != null) onInvoice(offer) else zapOffer.value = offer
            message.value = "Invoice ready. Open your wallet to pay; no payment is confirmed yet."
        } else {
            media.pay(wallet, invoice)
            message.value = "Wallet confirmed payment."
            onPaid()
        }
    }

    fun like(e: Event) = action {
        val key = account.value ?: error("Connect Amber first.")
        if (
            events.value.any {
                it.kind == 7 && it.pubkey == key && e.id in it.values("e") && it.content == "+"
            }
        )
            return@action
        publish(
            Event.template(
                key,
                7,
                "+",
                listOf(listOf("e", e.id), listOf("p", e.pubkey), listOf("k", e.kind.toString())),
            )
        )
    }

    fun repost(e: Event) = action {
        val key = account.value ?: error("Connect Amber first.")
        if (events.value.any { it.kind == 6 && it.pubkey == key && e.id in it.values("e") })
            return@action
        publish(
            Event.template(
                key,
                6,
                e.json().toString(),
                listOf(listOf("e", e.id), listOf("p", e.pubkey)),
            )
        )
    }

    /** Re-fetch replacement records before changes; never replace an unresolved remote list. */
    private suspend fun freshest(key: String, kind: Int): Event? {
        require(transport.status.value.any { it.value }) {
            "Reconnect before editing a remote list."
        }
        val result =
            transport.fetchResult(
                listOf(filter(listOf(kind), listOf(key))),
                targets = settings.value.read.toSet(),
            )
        require(result.reliable) {
            "Read relays did not finish loading this record. Retry before changing it; existing data is untouched."
        }
        result.events.forEach(::ingest)
        flush()
        return latest(events.value, kind, key)
    }

    fun bookmark(e: Event) = action {
        changes.withLock {
            val key = account.value ?: error("Connect Amber first.")
            publish(bookmarkTemplate(freshest(key, 10003), key, e.id))
        }
    }

    fun follow(who: String) = action {
        changes.withLock {
            val key = account.value ?: error("Connect Amber first.")
            publish(followTemplate(freshest(key, 3), key, who))
            reconnect()
        }
    }

    suspend fun profileForEdit(key: String): JSONObject {
        require(account.value == key) { "Account changed." }
        return JSONObject(freshest(key, 0)?.content ?: "{}")
    }

    fun editProfile(fields: Map<String, String>, onDone: () -> Unit) = action {
        changes.withLock {
            val key = account.value ?: error("Connect Amber first.")
            val current = freshest(key, 0)
            val j = JSONObject(current?.content ?: "{}")
            fields.forEach { (name, value) ->
                if (name in listOf("picture", "banner", "website") && value.isNotBlank())
                    require(safeHttps(value)) { "$name requires a secure HTTPS URL." }
                if (value.isBlank()) j.remove(name) else j.put(name, value)
            }
            publish(replacement(current, key, 0, j.toString()))
            onDone()
        }
    }

    suspend fun loadBlossomList(key: String): BlossomSnapshot {
        val generation = accountGeneration
        require(account.value == key) { "Account changed; list loading cancelled." }
        val targets = (settings.value.read + settings.value.write).distinct()
        require(targets.isNotEmpty()) { "No relays configured." }
        val results = coroutineScope {
            targets.map { relay -> async {
                transport.fetchResult(listOf(filter(listOf(10063), listOf(key), limit = 100)), targets = setOf(relay))
            } }.awaitAll()
        }
        require(account.value == key && generation == accountGeneration) { "Account changed; list loading cancelled." }
        val usable = results.filter { it.reliable && it.events.size < 100 }
        val completed = usable.flatMap { it.completed }.toSet()
        val witnessed = usable.flatMap { it.events }
        results.flatMap { it.events }.forEach(::ingest)
        flush()
        require(completed.isNotEmpty()) {
            "No relay completed loading your Blossom list. Check your connection and retry; existing data is untouched."
        }
        val newest = latest(events.value, 10063, key)
        return BlossomSnapshot(newest, completed, targets.toSet() - completed,
            newest != null && witnessed.none { it.id == newest.id })

    }

    fun publishBlossomList(key: String, base: Event?, servers: List<String>, active: () -> Boolean, allowUncertain: Boolean = false, onDone: (Event) -> Unit) = action {
        changes.withLock {
            val generation = accountGeneration
            val writes = settings.value.write.toList()
            fun authorized() = active() && account.value == key && generation == accountGeneration
            require(authorized()) { "Account or editor changed; publication cancelled." }
            require(writes.isNotEmpty()) { "No write relays configured." }
            val template = blossomListTemplate(base, key, servers)
            val before = loadBlossomList(key)
            require(before.event?.id == base?.id) {
                "A newer Blossom list was found. Reload and review before publishing; your edits are retained."
            }
            require(!before.uncertain || allowUncertain) { "Relay coverage is now incomplete. Reload and review the warning before publishing." }
            require(authorized()) { "Account or editor changed; publication cancelled." }
            val signed = signer.sign(template)
            val after = loadBlossomList(key)
            require(after.event?.id == base?.id) {
                "A newer Blossom list arrived during signer approval. Reload and review before publishing."
            }
            require(authorized()) { "Account or editor changed; publication cancelled." }
            require(!after.uncertain || allowUncertain) { "Relay coverage is now incomplete. Reload and review the warning before publishing." }
            val (accepted, total) = transport.publish(signed, writes, ::authorized)
            ingest(signed)
            flush()
            if (authorized()) {
                if (storage.get(key, "network").isBlank()) {
                    settings.value = settings.value.copy(blossom = validateProfileServers(servers))
                }
                message.value = "Published Blossom list: $accepted of $total relays confirmed. Other relays may still be pending. Local overrides are unchanged."
                onDone(signed)
            }
        }
    }

    fun saveSettings(value: NetworkSettings) {
        account.value?.let {
            storage.put(it, "network", value.json())
            settings.value = value
            reconnect()
            message.value = "Settings saved on this device."
        }
    }

    fun resetSettings() {
        account.value?.let {
            storage.put(it, "network", "")
            settings.value = NetworkSettings.profile(events.value, it)
            reconnect()
        }
    }

    fun clearCache() = action {
        cache.clear()
        events.value = emptyList()
        message.value = "Public event cache cleared."
    }

    override fun onCleared() {
        signer.cancel()
        transport.close()
        cache.close()
    }
}
