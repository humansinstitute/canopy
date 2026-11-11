package com.wingman.canopy

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.vitorpamplona.quartz.nip04Dm.crypto.Nip04
import com.vitorpamplona.quartz.nip44Encryption.Nip44
import fr.acinq.secp256k1.Secp256k1
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class Gif(val title: String, val url: String, val source: String)

data class WalletConnection(val wallet: String, val relays: List<String>, val secret: ByteArray) {
    companion object {
        fun parse(value: String): WalletConnection {
            val uri = Uri.parse(value)
            require(uri.scheme in listOf("nostr+walletconnect", "nostrwalletconnect")) {
                "Use a Nostr Wallet Connect URI."
            }
            val wallet = uri.host ?: error("Wallet key missing.")
            val secret = uri.getQueryParameter("secret") ?: error("Wallet authorization missing.")
            val relays = uri.getQueryParameters("relay").distinct()
            require(
                hexKey.matches(wallet) &&
                    hexKey.matches(secret) &&
                    relays.isNotEmpty() &&
                    relays.all(::safeRelay)
            ) {
                "Invalid wallet connection."
            }
            val bytes = secret.bytes()
            require(Secp256k1.secKeyVerify(bytes))
            return WalletConnection(wallet, relays.take(4), bytes)
        }
    }
}

class NativeServices(private val relay: RelayTransport) {
    private val http =
        relay.http
            .newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(25, TimeUnit.SECONDS)
            .build()

    suspend fun json(url: String): JSONObject =
        withContext(Dispatchers.IO) {
            require(safeHttps(url)) { "An insecure endpoint was rejected." }
            http
                .newCall(
                    Request.Builder()
                        .url(url)
                        .header("Accept", "application/json")
                        .header(
                            "User-Agent",
                            "Canopy/${BuildConfig.VERSION_NAME} (https://github.com/humansinstitute/canopy)",
                        )
                        .build()
                )
                .execute()
                .use { response ->
                    require(response.isSuccessful) { "Server returned HTTP ${response.code}." }
                    val body = response.body ?: error("Empty response.")
                    val bytes = body.byteStream().readBounded(262145)
                    require(bytes.size <= 262144) { "Server response too large." }
                    JSONObject(bytes.toString(Charsets.UTF_8))
                }
        }

    suspend fun gifs(query: String): List<Gif> {
        val url =
            "https://commons.wikimedia.org/w/api.php"
                .toHttpUrl()
                .newBuilder()
                .addQueryParameter("action", "query")
                .addQueryParameter("generator", "search")
                .addQueryParameter("gsrsearch", "${query.take(100)} filemime:image/gif")
                .addQueryParameter("gsrnamespace", "6")
                .addQueryParameter("gsrlimit", "24")
                .addQueryParameter("prop", "imageinfo")
                .addQueryParameter("iiprop", "url|mime|size")
                .addQueryParameter("format", "json")
                .addQueryParameter("formatversion", "2")
                .build()
        val pages =
            json(url.toString()).optJSONObject("query")?.optJSONArray("pages") ?: return emptyList()
        return (0 until pages.length()).mapNotNull { i ->
            val page = pages.getJSONObject(i)
            val info = page.optJSONArray("imageinfo")?.optJSONObject(0) ?: return@mapNotNull null
            val url = info.optString("url")
            val source = info.optString("descriptionurl")
            if (
                info.optString("mime") != "image/gif" ||
                    info.optLong("size") > 20000000 ||
                    !safeHttps(url) ||
                    !safeHttps(source)
            )
                null
            else Gif(page.optString("title").removePrefix("File:"), url, source)
        }
    }

    suspend fun upload(
        context: Context,
        uri: Uri,
        servers: List<String>,
        account: String,
        signer: AmberSigner,
    ): String {
        require(servers.isNotEmpty()) { "Add a Blossom server in Settings first." }
        val mime = context.contentResolver.getType(uri) ?: error("Image type unavailable.")
        require(mime.startsWith("image/")) { "Select an image." }
        val bytes =
            withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(uri)?.use {
                    it.readBounded(10 * 1024 * 1024 + 1)
                } ?: error("Image could not be opened.")
            }
        require(bytes.isNotEmpty() && bytes.size <= 10 * 1024 * 1024) {
            "Images must be at most 10 MB."
        }
        val hash = sha256(bytes).hex()
        var failure = "No upload server accepted this image."
        for (server in servers) {
            try {
                require(safeHttps(server))
                val auth =
                    signer.sign(
                        Event.template(
                            account,
                            24242,
                            "Upload image from Canopy",
                            listOf(
                                listOf("t", "upload"),
                                listOf("x", hash),
                                listOf("server", server),
                                listOf("expiration", (now() + 300).toString()),
                            ),
                        )
                    )
                val descriptor =
                    withContext(Dispatchers.IO) {
                        http
                            .newCall(
                                Request.Builder()
                                    .url(server.trimEnd('/') + "/upload")
                                    .header(
                                        "Authorization",
                                        "Nostr " +
                                            Base64.encodeToString(
                                                auth.json().toString().toByteArray(),
                                                Base64.NO_WRAP,
                                            ),
                                    )
                                    .put(bytes.toRequestBody(mime.toMediaType()))
                                    .build()
                            )
                            .execute()
                            .use { response ->
                                require(response.isSuccessful) {
                                    "Upload returned HTTP ${response.code}."
                                }
                                val raw =
                                    response.body?.byteStream()?.readBounded(65537)
                                        ?: error("Missing upload response.")
                                require(raw.size <= 65536)
                                JSONObject(raw.toString(Charsets.UTF_8))
                            }
                    }
                val url = descriptor.getString("url")
                require(safeHttps(url) && descriptor.optString("sha256", hash) == hash) {
                    "Upload returned invalid content."
                }
                return url
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                failure = e.message ?: failure
            }
        }
        error(failure)
    }

    suspend fun invoice(
        event: Event,
        profile: JSONObject,
        sats: Long,
        comment: String,
        account: String,
        relays: List<String>,
        signer: AmberSigner,
    ): String {
        require(sats in 1..1000000) { "Choose 1 to 1,000,000 sats." }
        val address = profile.optString("lud16").split('@')
        require(address.size == 2 && address.all { it.isNotBlank() }) {
            "This profile has no Lightning address."
        }
        val endpoint = "https://${address[1]}/.well-known/lnurlp/${Uri.encode(address[0])}"
        val info = json(endpoint)
        require(info.optBoolean("allowsNostr") && hexKey.matches(info.optString("nostrPubkey"))) {
            "Lightning provider does not support Nostr zaps."
        }
        val amount = sats * 1000
        require(amount >= info.optLong("minSendable") && amount <= info.optLong("maxSendable")) {
            "Amount outside the provider's allowed range."
        }
        val callback = info.getString("callback")
        require(safeHttps(callback))
        val request =
            signer.sign(
                Event.template(
                    account,
                    9734,
                    comment.take(280),
                    listOf(
                        listOf("p", event.pubkey),
                        listOf("e", event.id),
                        listOf("amount", amount.toString()),
                        listOf("relays") + relays,
                    ),
                )
            )
        val url =
            callback
                .toHttpUrl()
                .newBuilder()
                .addQueryParameter("amount", amount.toString())
                .addQueryParameter("nostr", request.json().toString())
                .build()
        val result = json(url.toString())
        require(result.optString("status") != "ERROR") {
            result.optString("reason", "Zap request rejected.")
        }
        return result.optString("pr").also {
            require(
                it.length <= 8000 &&
                    Regex("ln(?:bc|tb|bcrt)[0-9a-z]+", RegexOption.IGNORE_CASE).matches(it)
            ) {
                "Provider returned an invalid invoice."
            }
        }
    }

    /** Dedicated wallet pool; never send wallet events to the user's public relays. */
    suspend fun pay(uri: String, invoice: String) = coroutineScope {
        val connection = WalletConnection.parse(uri)
        val pool = RelayTransport(this, relay.http)
        try {
            pool.start(connection.relays)
            withTimeout(12000) { pool.status.first { it.values.any { online -> online } } }
            val walletInfo =
                pool
                    .fetch(listOf(filter(listOf(13194), listOf(connection.wallet))), 5000)
                    .maxByOrNull { it.createdAt }
            require(
                walletInfo != null && "pay_invoice" in walletInfo.content.split(Regex("\\s+"))
            ) {
                "Wallet did not advertise pay_invoice support."
            }
            val encryption =
                walletInfo.tags
                    .find { it.firstOrNull() == "encryption" }
                    ?.drop(1)
                    ?.flatMap { it.split(' ') } ?: listOf("nip04")
            val use44 = "nip44_v2" in encryption
            require(use44 || "nip04" in encryption) { "Unsupported wallet encryption." }
            val client = Secp256k1.pubkeyCreate(connection.secret).copyOfRange(1, 33).hex()
            val body =
                JSONObject()
                    .put("method", "pay_invoice")
                    .put("params", JSONObject().put("invoice", invoice))
                    .toString()
            val payload =
                if (use44)
                    Nip44.encrypt(body, connection.secret, connection.wallet.bytes())
                        .encodePayload()
                else Nip04.encrypt(body, connection.secret, connection.wallet.bytes())
            val unsigned =
                Event.template(
                    client,
                    23194,
                    payload,
                    buildList {
                        add(listOf("p", connection.wallet))
                        add(listOf("expiration", (now() + 75).toString()))
                        if (use44) add(listOf("encryption", "nip44_v2"))
                    },
                )
            val signed =
                unsigned.copy(
                    sig =
                        Secp256k1.signSchnorr(
                                unsigned.id.bytes(),
                                connection.secret,
                                java.security.SecureRandom().generateSeed(32),
                            )
                            .hex()
                )
            val result = CompletableDeferred<Event>()
            val close =
                pool.subscribe(
                    listOf(
                        filter(
                            listOf(23195),
                            listOf(connection.wallet),
                            tag = "p" to listOf(client),
                        )
                    ),
                    {
                        if (signed.id in it.values("e") && it.createdAt >= signed.createdAt - 5)
                            result.complete(it)
                    },
                )
            try {
                pool.publish(signed, connection.relays)
                val e = withTimeout(60000) { result.await() }
                val decoded =
                    if (use44)
                        Nip44.v2.decrypt(e.content, connection.secret, connection.wallet.bytes())
                    else Nip04.decrypt(e.content, connection.secret, connection.wallet.bytes())
                val j = JSONObject(decoded)
                require(j.optJSONObject("error") == null) {
                    j.optJSONObject("error")?.optString("message") ?: "Wallet rejected payment."
                }
                require(
                    j.optString("result_type") == "pay_invoice" &&
                        hexKey.matches(j.optJSONObject("result")?.optString("preimage") ?: "")
                ) {
                    "Wallet response was invalid."
                }
            } finally {
                close()
            }
        } finally {
            pool.close()
            connection.secret.fill(0)
            Nip04.clearCache()
            Nip44.clearCache()
        }
    }
}

/** Reads at most limit bytes on Android 11+, including chunked bodies. */
fun java.io.InputStream.readBounded(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(minOf(limit, 8192))
    val buffer = ByteArray(8192)
    while (output.size() < limit) {
        val n = read(buffer, 0, minOf(buffer.size, limit - output.size()))
        if (n < 0) break
        if (n == 0) continue
        output.write(buffer, 0, n)
    }
    return output.toByteArray()
}
