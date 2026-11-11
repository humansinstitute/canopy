package com.wingman.canopy

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.test.platform.app.InstrumentationRegistry
import fr.acinq.secp256k1.Secp256k1
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class SignerSafetyTest {
    @Test
    fun missingMismatchExpiryTamperAndOrphanFailClosed() = runBlocking {
        val storage = AccountStorage(InstrumentationRegistry.getInstrumentation().targetContext)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        var elapsed = 1000L
        val signer = AmberSigner { elapsed }
        val secret = ("0".repeat(63) + "1").bytes()
        val key = Secp256k1.pubkeyCreate(secret).copyOfRange(1, 33).hex()
        val event = Event.template(key, 1, "immutable native signer request")
        try {
            withContext(Dispatchers.Main) {
                signer.launch = { throw android.content.ActivityNotFoundException() }
            }
            val missing = withContext(Dispatchers.Main) { runCatching { signer.login() } }
            assertTrue(missing.exceptionOrNull()?.message?.contains("not installed") == true)
            var request: Intent? = null
            withContext(Dispatchers.Main) { signer.launch = { request = it } }
            suspend fun pending(): Deferred<Result<Event>> {
                request = null
                val d = scope.async { runCatching { signer.sign(event) } }
                withTimeout(2000) { while (request == null) delay(10) }
                return d
            }
            val mismatch = pending()
            withContext(Dispatchers.Main) {
                signer.result(ActivityResult(Activity.RESULT_OK, Intent().putExtra("id", "wrong")))
            }
            assertTrue(mismatch.await().exceptionOrNull()?.message?.contains("match") == true)
            val expired = pending()
            elapsed += 120001
            withContext(Dispatchers.Main) {
                signer.result(
                    ActivityResult(
                        Activity.RESULT_OK,
                        Intent().putExtra("id", request!!.getStringExtra("id")),
                    )
                )
            }
            assertTrue(expired.await().exceptionOrNull()?.message?.contains("expired") == true)
            val tamper = pending()
            val changed =
                Event.template(key, 1, "different request").let {
                    it.copy(sig = Secp256k1.signSchnorr(it.id.bytes(), secret, ByteArray(32)).hex())
                }
            withContext(Dispatchers.Main) {
                signer.result(
                    ActivityResult(
                        Activity.RESULT_OK,
                        Intent()
                            .putExtra("id", request!!.getStringExtra("id"))
                            .putExtra("event", changed.json().toString()),
                    )
                )
            }
            assertTrue(tamper.await().isFailure)
            val active = pending()
            val overlap = withContext(Dispatchers.Main) { runCatching { signer.sign(event) } }
            assertTrue(overlap.isFailure)
            withContext(Dispatchers.Main) { signer.cancel() }
            assertTrue(active.await().isFailure)
            withContext(Dispatchers.Main) {
                AmberSigner()
                    .result(ActivityResult(Activity.RESULT_OK, Intent().putExtra("result", key)))
            }
            assertFalse(signer.busy.value)
        } finally {
            scope.cancel()
            secret.fill(0)
        }
    }
}
