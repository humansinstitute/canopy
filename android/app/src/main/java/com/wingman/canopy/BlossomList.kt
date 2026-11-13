package com.wingman.canopy

import java.net.URI
import java.util.Locale

/** BUD-03 server URLs retain their path; secrets and ambiguous URL components are refused. */
fun normalizeProfileServer(value: String): String {
    val raw = value.trim()
    val uri = runCatching { URI(raw) }.getOrElse { error("Use a full HTTPS server URL.") }
    require(
        raw.length <= 2048 && raw.startsWith("https://", ignoreCase = true) &&
            uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            uri.port in -1..65535 && uri.port != 0
    ) { "Use HTTPS server URLs without credentials, query strings or fragments." }
    val host = uri.host.lowercase(Locale.ROOT)
    val port = if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
    val path = (uri.normalize().rawPath ?: "").trimEnd('/')
    return "https://$host$port$path"
}

fun validateProfileServers(values: List<String>): List<String> {
    require(values.size in 1..8) {
        "BUD-03 requires 1–8 servers. Empty published lists are not supported."
    }
    val normalized = values.map(::normalizeProfileServer)
    require(normalized.distinct().size == normalized.size) { "Remove duplicate server URLs." }
    return normalized
}

fun blossomListTemplate(current: Event?, account: String, servers: List<String>): Event {
    require(current == null || (current.pubkey == account && current.kind == 10063)) {
        "Blossom list belongs to another account."
    }
    require(current == null || current.createdAt <= now()) {
        "The current list is future-dated. Wait until its timestamp before replacing it."
    }
    return replacement(
        current,
        account,
        10063,
        "",
        validateProfileServers(servers).map { url ->
            val retained = current?.tags?.firstOrNull { tag ->
                tag.firstOrNull() == "server" && runCatching { normalizeProfileServer(tag.getOrNull(1) ?: "") }.getOrNull() == url
            }
            listOf("server", url) + (retained?.drop(2) ?: emptyList())
        } +
            (current?.tags ?: emptyList()).filter { it.firstOrNull() != "server" },
    )
}
