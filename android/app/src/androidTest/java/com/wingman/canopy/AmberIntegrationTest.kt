package com.wingman.canopy

import androidx.lifecycle.lifecycleScope
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.File
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicit opt-in on an emulator with a disposable identity. Never publishes an identity event. */
class AmberIntegrationTest {
    @Test
    fun realAmberLoginSignRejectAndNip44RoundTrip() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("realAmber") == "true")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var signer: AmberSigner? = null
            lateinit var model: CanopyModel
            var evidence: File? = null
            scenario.onActivity {
                model = it.model
                signer = model.signer
                evidence =
                    File(it.getExternalFilesDir(null), "native-validation").apply { mkdirs() }
            }
            fun <T> start(block: suspend (AmberSigner) -> T): CompletableDeferred<Result<T>> {
                val result = CompletableDeferred<Result<T>>()
                scenario.onActivity { activity ->
                    activity.lifecycleScope.launch {
                        result.complete(runCatching { block(signer!!) })
                    }
                }
                return result
            }
            fun approve(name: String, connect: Boolean = false) {
                if (connect) {
                    device
                        .wait(Until.findObject(By.text("Manually approve each permission")), 10000)
                        ?.click()
                    device.wait(Until.findObject(By.text("Connect")), 10000)?.click()
                } else {
                    val accept = device.wait(Until.findObject(By.text("Accept")), 15000)
                    assertNotNull("Amber must show explicit approval for $name", accept)
                    device.takeScreenshot(File(evidence, "amber-$name.png"))
                    accept!!.click()
                }
            }
            fun <T> await(result: CompletableDeferred<Result<T>>): T = runBlocking {
                withTimeout(25000) { result.await().getOrThrow() }
            }
            runBlocking { withTimeout(10000) { while (!model.initialized.value) delay(10) } }
            var connect = device.wait(Until.findObject(By.text("Continue with Amber")), 5000)
            if (connect == null) {
                device
                    .findObject(By.scrollable(true))
                    ?.scroll(androidx.test.uiautomator.Direction.DOWN, 0.8f)
                connect = device.wait(Until.findObject(By.text("Continue with Amber")), 5000)
            }
            assertNotNull("Native Amber login button", connect)
            connect!!.click()
            approve("login", true)
            runBlocking {
                withTimeout(15000) {
                    while (model.account.value == null || model.busy.value) delay(10)
                }
            }
            val key = model.account.value!!
            assertTrue(hexKey.matches(key))
            val unsigned =
                Event.template(key, 1, "Canopy native validation: signature only, never published.")
            val signing = start { it.sign(unsigned) }
            approve("sign")
            val signed = await(signing)
            assertEquals(unsigned.id, signed.id)
            assertTrue(signed.valid())
            val rejecting = start {
                it.sign(Event.template(key, 1, "Canopy native rejection check: never published."))
            }
            val reject = device.wait(Until.findObject(By.text("Reject")), 15000)
            assertNotNull(reject)
            device.takeScreenshot(File(evidence, "amber-rejection.png"))
            reject!!.click()
            val rejection = runBlocking { withTimeout(25000) { rejecting.await() } }
            assertTrue(rejection.isFailure)
            assertTrue(rejection.exceptionOrNull()?.message?.contains("declined") == true)
            val plaintext = "Canopy native NIP-44 round trip"
            val encrypting = start { it.encrypt(key, key, plaintext) }
            approve("encrypt")
            val ciphertext = await(encrypting)
            val decrypting = start { it.decrypt(key, key, ciphertext) }
            approve("decrypt")
            assertEquals(plaintext, await(decrypting))
            File(evidence, "amber-result.json")
                .writeText(
                    JSONObject()
                        .put("package", BuildConfig.APPLICATION_ID)
                        .put("version", BuildConfig.VERSION_NAME)
                        .put("code", BuildConfig.VERSION_CODE)
                        .put("account", key)
                        .put("loginViaNativeUi", true)
                        .put("signedEvent", signed.json())
                        .put("rejection", true)
                        .put("nip44RoundTrip", true)
                        .put("published", false)
                        .toString(2)
                )
            device.executeShellCommand("mkdir -p /data/local/tmp/canopy-native-validation")
            device.executeShellCommand(
                "cp -R ${evidence!!.absolutePath} /data/local/tmp/canopy-native-validation/amber"
            )
        }
    }
}
