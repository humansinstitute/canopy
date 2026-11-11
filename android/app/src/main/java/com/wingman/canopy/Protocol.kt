package com.wingman.canopy

import com.vitorpamplona.quartz.nip19Bech32.Nip19Parser
import com.vitorpamplona.quartz.nip19Bech32.entities.*
import fr.acinq.secp256k1.Secp256k1
import java.net.URI
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

fun String.bytes(): ByteArray {
    require(length % 2 == 0)
    return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}

fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)

val hexKey = Regex("[0-9a-f]{64}")

fun now() = System.currentTimeMillis() / 1000

fun jsonArray(values: Iterable<*>): JSONArray =
    JSONArray().apply { values.forEach { put(if (it is Iterable<*>) jsonArray(it) else it) } }

fun JSONArray.strings() =
    (0 until length()).map { get(it) as? String ?: error("Expected a string array.") }

data class Event(
    val id: String,
    val pubkey: String,
    val createdAt: Long,
    val kind: Int,
    val tags: List<List<String>>,
    val content: String,
    val sig: String = "",
) {
    fun json() =
        JSONObject()
            .put("id", id)
            .put("pubkey", pubkey)
            .put("created_at", createdAt)
            .put("kind", kind)
            .put("tags", jsonArray(tags))
            .put("content", content)
            .put("sig", sig)

    fun hash() =
        com.vitorpamplona.quartz.nip01Core.crypto.EventHasher.hashId(
            pubkey,
            createdAt,
            kind,
            tags.map { it.toTypedArray() }.toTypedArray(),
            content,
        )

    fun valid(): Boolean = runCatching {
        hexKey.matches(id) &&
            hexKey.matches(pubkey) &&
            sig.length == 128 &&
            kind in 0..65535 &&
            createdAt >= 0 &&
            id == hash() &&
            Secp256k1.verifySchnorr(sig.bytes(), id.bytes(), pubkey.bytes())
    }
        .getOrDefault(false)

    fun values(name: String) =
        tags.filter { it.firstOrNull() == name }.mapNotNull { it.getOrNull(1) }

    fun parent(): String? {
        val es = tags.filter {
            it.firstOrNull() == "e" && hexKey.matches(it.getOrNull(1) ?: "") && it[1] != id
        }
        return (es.find { it.getOrNull(3) == "reply" }
                ?: es.lastOrNull { it.getOrNull(3).isNullOrEmpty() || it.getOrNull(3) == "root" })
            ?.get(1)
    }

    fun root(): String? =
        tags
            .find {
                it.firstOrNull() == "e" &&
                    it.getOrNull(3) == "root" &&
                    hexKey.matches(it.getOrNull(1) ?: "") &&
                    it[1] != id
            }
            ?.get(1)
            ?: tags
                .firstOrNull {
                    it.firstOrNull() == "e" &&
                        it.getOrNull(3).isNullOrEmpty() &&
                        hexKey.matches(it.getOrNull(1) ?: "") &&
                        it[1] != id
                }
                ?.get(1)
            ?: parent()

    companion object {
        fun parse(o: JSONObject): Event {
            require(o.toString().length <= 262144)
            val timestamp = o.get("created_at")
            val eventKind = o.get("kind")
            require(timestamp is Long || timestamp is Int) { "Event time must be an integer." }
            require(eventKind is Long || eventKind is Int) { "Event kind must be an integer." }
            require(
                (timestamp as Number).toLong() >= 0 && (eventKind as Number).toLong() in 0..65535
            ) {
                "Invalid event time or kind."
            }
            fun text(name: String) = o.get(name) as? String ?: error("Invalid event $name.")
            val ts = o.getJSONArray("tags")
            require(ts.length() <= 2000)
            return Event(
                text("id"),
                text("pubkey"),
                (timestamp as Number).toLong(),
                (eventKind as Number).toInt(),
                (0 until ts.length()).map { ts.getJSONArray(it).strings().toList() },
                text("content"),
                if (o.has("sig")) text("sig") else "",
            )
        }

        fun template(
            pubkey: String,
            kind: Int,
            content: String = "",
            tags: List<List<String>> = emptyList(),
            time: Long = now(),
        ): Event {
            require(hexKey.matches(pubkey))
            val e = Event("", pubkey, time, kind, tags.map { it.toList() }, content)
            return e.copy(id = e.hash())
        }
    }
}

/** Reject every alteration, including a valid signature over a different request. */
fun verifySigned(request: Event, response: Event): Event {
    require(response.copy(sig = "") == request.copy(sig = "")) {
        "Amber changed the requested event or account."
    }
    require(response.valid()) { "Amber returned an invalid event signature." }
    return response
}

fun latest(events: List<Event>, kind: Int, author: String) =
    events
        .filter { it.kind == kind && it.pubkey == author }
        .sortedWith(compareByDescending<Event> { it.createdAt }.thenBy { it.id })
        .firstOrNull()

fun replacement(
    current: Event?,
    account: String,
    kind: Int,
    content: String = current?.content ?: "",
    tags: List<List<String>> = current?.tags ?: emptyList(),
) = Event.template(account, kind, content, tags, maxOf(now(), (current?.createdAt ?: 0) + 1))

fun replyTags(target: Event): List<List<String>> = buildList {
    add(listOf("e", target.root() ?: target.id, "", "root"))
    if (target.root() != null) add(listOf("e", target.id, "", "reply"))
    add(listOf("p", target.pubkey))
    target.values("p").distinct().filter { it != target.pubkey }.forEach { add(listOf("p", it)) }
}

fun bookmarkTemplate(current: Event?, account: String, id: String): Event {
    require(hexKey.matches(id))
    val has = current?.values("e")?.contains(id) == true
    return replacement(
        current,
        account,
        10003,
        tags =
            if (has) current!!.tags.filterNot { it.firstOrNull() == "e" && it.getOrNull(1) == id }
            else (current?.tags ?: emptyList()) + listOf(listOf("e", id)),
    )
}

fun followTemplate(current: Event?, account: String, who: String): Event {
    require(hexKey.matches(who))
    val has = current?.values("p")?.contains(who) == true
    return replacement(
        current,
        account,
        3,
        tags =
            if (has) current!!.tags.filterNot { it.firstOrNull() == "p" && it.getOrNull(1) == who }
            else (current?.tags ?: emptyList()) + listOf(listOf("p", who)),
    )
}

fun notificationType(e: Event, account: String): String? =
    if (e.pubkey == account || account !in e.values("p")) null
    else
        when (e.kind) {
            7 -> "Reaction"
            6,
            16 -> "Repost"
            1 -> if (e.parent() != null) "Reply" else "Mention"
            else -> null
        }

fun lookmarkTargets(events: List<Event>, followed: Set<String>): Map<String, List<Event>> =
    events
        .filter { it.pubkey in followed }
        .mapNotNull { e ->
            val id =
                when {
                    e.kind == 7 && e.content.trim() == "👀" -> e.values("e").lastOrNull()
                    e.kind == 1 -> e.values("q").firstOrNull() ?: e.parent()
                    else -> null
                }
            id?.takeIf { hexKey.matches(it) }?.let { it to e }
        }
        .groupBy({ it.first }, { it.second })
        .entries
        .sortedByDescending { it.value.maxOf { e -> e.createdAt } }
        .take(40)
        .associate { it.toPair() }

data class Pointer(val kind: String, val key: String, val relays: List<String> = emptyList())

fun pointer(value: String): Pointer? = runCatching {
    val text = value.trim()
    if (text.contains("nsec", true)) return null
    val raw =
        if (text.startsWith("https://")) {
            val u = URI(text)
            require(u.host == "zinc-pod-arch.rick.runwingman.com")
            u.path.substringAfterLast('/')
        } else text.removePrefix("nostr:").removePrefix("@")
    if (hexKey.matches(raw)) return Pointer("profile", raw)
    when (
        val e =
            Nip19Parser.uriToRoute(raw)
                ?.takeIf { it.nip19raw == raw && it.additionalChars == null }
                ?.entity
    ) {
        is NPub -> Pointer("profile", e.hex)
        is NProfile -> Pointer("profile", e.hex, e.relay.map { it.url }.filter(::safeRelay).take(4))
        is NNote -> Pointer("event", e.hex)
        is NEvent -> Pointer("event", e.hex, e.relay.map { it.url }.filter(::safeRelay).take(4))
        else -> null
    }
}
    .getOrNull()

fun npub(key: String) = NPub.create(key)

fun eventRef(e: Event) = NEvent.create(e.id, e.pubkey, e.kind, emptyList())

const val PUBLIC_ORIGIN = "https://zinc-pod-arch.rick.runwingman.com"

fun profileUrl(key: String) = "$PUBLIC_ORIGIN/profile/${npub(key)}"

fun eventUrl(e: Event) = "$PUBLIC_ORIGIN/event/${eventRef(e)}"

fun safeHttps(value: String): Boolean = runCatching {
    val u = URI(value)
    u.scheme == "https" &&
        !u.host.isNullOrBlank() &&
        u.userInfo == null &&
        u.port in listOf(-1, 443)
}
    .getOrDefault(false)

fun safeRelay(value: String): Boolean = runCatching {
    val u = URI(value)
    u.scheme == "wss" && !u.host.isNullOrBlank() && u.userInfo == null && u.fragment == null
}
    .getOrDefault(false)

fun short(key: String) = key.take(8) + "…" + key.takeLast(6)

/** A deterministic cycle-safe tree; missing ancestors remain visible. */
fun threadRows(events: List<Event>, root: String, focus: String): List<Pair<Event, Int>> {
    val candidates =
        events
            .filter {
                it.kind == 1 &&
                    (it.id == root || it.id == focus || it.root() == root || it.parent() == root)
            }
            .distinctBy { it.id }
    val result = mutableListOf<Pair<Event, Int>>()
    val visited = mutableSetOf<String>()
    fun visit(e: Event, depth: Int) {
        if (!visited.add(e.id)) return
        result.add(e to depth)
        if (depth >= 64) return // Bound recursion for adversarial but valid signed threads.
        candidates
            .filter { it.parent() == e.id }
            .sortedBy { it.createdAt }
            .forEach { visit(it, depth + 1) }
    }
    candidates.find { it.id == root }?.let { visit(it, 0) }
    candidates.sortedBy { it.createdAt }.forEach { visit(it, 0) }
    return result
}

fun articleSourceUrl(address: String): String {
    val parts = address.split(":", limit = 3)
    require(parts.size == 3 && parts[0].toIntOrNull() in 0..65535 && hexKey.matches(parts[1])) {
        "Invalid article address."
    }
    val naddr =
        com.vitorpamplona.quartz.nip19Bech32.entities.NAddress.createOrNull(
            parts[0].toInt(),
            parts[1],
            parts[2],
            emptyList(),
        ) ?: error("Article identifier is too long.")
    return "https://njump.me/$naddr"
}
