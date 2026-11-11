package com.wingman.canopy

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * Kept by the activity ViewModel across rotation. Orphan results after process death are ignored.
 */
class AmberSigner(private val clock: () -> Long = { android.os.SystemClock.elapsedRealtime() }) {
    data class Pending(
        val id: String,
        val method: String,
        val account: String,
        val request: Event?,
        val started: Long,
        val result: CompletableDeferred<Intent>,
    )

    private var pending: Pending? = null
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    var launch: ((Intent) -> Unit)? = null

    fun result(result: ActivityResult) {
        val p = pending ?: return
        val data = result.data
        when {
            clock() - p.started > 120000 ->
                p.result.completeExceptionally(
                    IllegalStateException("Amber request expired. Please retry.")
                )
            result.resultCode != Activity.RESULT_OK ->
                p.result.completeExceptionally(
                    IllegalStateException("Amber request cancelled or signer closed.")
                )
            data == null ->
                p.result.completeExceptionally(IllegalStateException("Amber returned no result."))
            data.getBooleanExtra("rejected", false) || data.getStringExtra("rejected") == "true" ->
                p.result.completeExceptionally(IllegalStateException("Request declined in Amber."))
            data.getStringExtra("id") != p.id ->
                p.result.completeExceptionally(
                    IllegalStateException("Amber response did not match the pending request.")
                )
            else -> p.result.complete(data)
        }
    }

    fun cancel() {
        pending
            ?.result
            ?.completeExceptionally(
                IllegalStateException("Account changed; pending signer request discarded.")
            )
    }

    private suspend fun request(
        method: String,
        account: String = "",
        payload: String = "",
        peer: String? = null,
        event: Event? = null,
    ): Intent {
        check(pending == null) { "Finish the current Amber request first." }
        require(payload.length <= 200000)
        val id = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<Intent>()
        val p = Pending(id, method, account, event, clock(), deferred)
        pending = p
        _busy.value = true
        val intent =
            Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:$payload")).apply {
                setPackage("com.greenart7c3.nostrsigner")
                putExtra("type", method)
                putExtra("id", id)
                if (account.isNotBlank()) putExtra("current_user", account)
                peer?.let {
                    require(hexKey.matches(it))
                    putExtra("pubkey", it)
                }
            }
        try {
            val launcher = launch ?: error("Canopy must be visible to request Amber.")
            launcher(intent)
            return withTimeout(120000) { deferred.await() }
        } catch (e: android.content.ActivityNotFoundException) {
            throw IllegalStateException(
                "Amber is not installed. Install and unlock Amber, then retry."
            )
        } catch (e: TimeoutCancellationException) {
            throw IllegalStateException("Amber request timed out. Your draft is retained.")
        } finally {
            if (pending === p) {
                pending = null
                _busy.value = false
            }
        }
    }

    suspend fun login(): String {
        val data = request("get_public_key")
        val value = data.getStringExtra("result") ?: error("Amber returned no public key.")
        val key =
            if (hexKey.matches(value)) value
            else
                pointer(value)?.takeIf { it.kind == "profile" }?.key
                    ?: error("Amber returned an invalid public key.")
        require(
            data.getStringExtra("package").let { it == null || it == "com.greenart7c3.nostrsigner" }
        ) {
            "Unexpected signer package."
        }
        return key
    }

    suspend fun sign(event: Event): Event {
        val immutable = event.copy(tags = event.tags.map { it.toList() })
        val data =
            request("sign_event", event.pubkey, immutable.json().toString(), event = immutable)
        val raw = data.getStringExtra("event")
        val signed =
            if (!raw.isNullOrBlank()) Event.parse(JSONObject(raw))
            else
                immutable.copy(
                    sig = data.getStringExtra("result") ?: error("Amber returned no signature.")
                )
        return verifySigned(immutable, signed)
    }

    suspend fun encrypt(account: String, peer: String, text: String) =
        request("nip44_encrypt", account, text, peer).getStringExtra("result")?.takeIf {
            it.length in 100..200000
        } ?: error("Invalid NIP-44 encryption response.")

    suspend fun decrypt(account: String, peer: String, text: String) =
        request("nip44_decrypt", account, text, peer).getStringExtra("result")
            ?: error("Invalid NIP-44 decryption response.")
}
