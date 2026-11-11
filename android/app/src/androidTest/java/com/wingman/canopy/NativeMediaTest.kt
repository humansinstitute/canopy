package com.wingman.canopy

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import fr.acinq.secp256k1.Secp256k1
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeMediaTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test
    fun decodedNativeVideoFullscreenPickerAndBack() {
        val app = ui.activity.application as CanopyApplication
        val original = app.dependencies
        val certificate =
            okhttp3.tls.HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls =
            okhttp3.tls.HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls =
            okhttp3.tls.HandshakeCertificates.Builder()
                .addTrustedCertificate(certificate.certificate)
                .build()
        val bytes =
            InstrumentationRegistry.getInstrumentation().context.assets.open("playback.mp4").use {
                it.readBytes()
            }
        val server =
            okhttp3.mockwebserver.MockWebServer().apply {
                useHttps(serverTls.sslSocketFactory(), false)
                dispatcher =
                    object : okhttp3.mockwebserver.Dispatcher() {
                        override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest) =
                            okhttp3.mockwebserver
                                .MockResponse()
                                .setHeader("Content-Type", "video/mp4")
                                .setBody(okio.Buffer().write(bytes))
                    }
                start()
            }
        app.dependencies =
            NativeDependencies(
                okhttp3.OkHttpClient.Builder()
                    .sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
                    .addInterceptor { chain ->
                        val request = chain.request()
                        chain.proceed(
                            if (request.url.host == "media.example")
                                request
                                    .newBuilder()
                                    .url(server.url(request.url.encodedPath))
                                    .build()
                            else request
                        )
                    }
                    .build()
            )
        try {
            val m = ui.activity.model
            ui.waitUntil(10000) { m.initialized.value }
            val secret = ("0".repeat(63) + "1").bytes()
            val key = Secp256k1.pubkeyCreate(secret).copyOfRange(1, 33).hex()
            val unsigned =
                Event.template(
                    key,
                    1,
                    "Native media test\nhttps://media.example/playback.mp4",
                )
            val note =
                unsigned.copy(
                    sig = Secp256k1.signSchnorr(unsigned.id.bytes(), secret, ByteArray(32)).hex()
                )
            ui.runOnIdle {
                m.foreground(false)
                m.account.value = key
                m.events.value = listOf(note)
                m.loading.value = false
            }
            ui.onNodeWithText("Play video").performScrollTo().performClick()
            ui.onNodeWithText("Enter fullscreen").assertIsDisplayed()
            ui.waitUntil(45000) {
                ui.onAllNodesWithText("Loading video…").fetchSemanticsNodes().isEmpty()
            }
            ui.onNodeWithText("Video could not be played. Check the source or connection.")
                .assertDoesNotExist()
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            device.executeShellCommand("mkdir -p /data/local/tmp/canopy-native-validation")
            device.executeShellCommand(
                "screencap -p /data/local/tmp/canopy-native-validation/native-video-decoded.png"
            )
            ui.onNodeWithText("Enter fullscreen").performClick()
            ui.onNodeWithContentDescription("Exit fullscreen").assertIsDisplayed()
            device.pressBack()
            ui.onNodeWithText("Enter fullscreen").assertIsDisplayed()
            ui.onNodeWithContentDescription("Close").performClick()
            ui.onNodeWithContentDescription("Compose note").performClick()
            ui.onNodeWithText("Add image").performClick()
            device.wait(Until.gone(By.pkg(BuildConfig.APPLICATION_ID).depth(0)), 10000)
            assertNotEquals(BuildConfig.APPLICATION_ID, device.currentPackageName)
            device.executeShellCommand(
                "screencap -p /data/local/tmp/canopy-native-validation/native-image-picker.png"
            )
            device.pressBack()
            ui.onNodeWithText("What’s moving?").assertIsDisplayed()
            ui.onNodeWithContentDescription("Close").performClick()
        } finally {
            app.dependencies = original
            server.shutdown()
        }
    }
}
