package com.wingman.canopy

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import fr.acinq.secp256k1.Secp256k1
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real Compose navigation over signed offline fixtures. Nothing is posted to public relays. */
@RunWith(AndroidJUnit4::class)
class NativeExperienceTest {
    @Test
    fun androidCanonicalUnicodeMatchesNostrTools() {
        CanonicalFixtures.verify()
    }

    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    private fun fixture(kind: Int, content: String, tags: List<List<String>> = emptyList()): Event {
        val secret = ("0".repeat(63) + "1").bytes()
        val key = Secp256k1.pubkeyCreate(secret).copyOfRange(1, 33).hex()
        val e = Event.template(key, kind, content, tags)
        return e.copy(sig = Secp256k1.signSchnorr(e.id.bytes(), secret, ByteArray(32)).hex())
    }

    @Test
    fun nativeOfflineNavigationSearchSavedThreadAndDraft() {
        ui.waitForIdle()
        val m = ui.activity.model
        ui.waitUntil(timeoutMillis = 10000) { m.initialized.value }
        val note = fixture(1, "Native controlled note: growing a calmer garden")
        val profile =
            fixture(
                0,
                "{\"name\":\"Native Tester\",\"display_name\":\"Native Tester\",\"about\":\"A local fixture\"}",
            )
        val saved = fixture(10003, "retained private content", listOf(listOf("e", note.id)))
        val reply = fixture(1, "Native controlled reply", replyTags(note))
        ui.runOnIdle {
            m.foreground(false)
            m.account.value = note.pubkey
            m.loading.value = false
            m.events.value = listOf(profile, note, saved, reply)
        }
        ui.onNodeWithText("Your feed").assertIsDisplayed()
        val device =
            androidx.test.uiautomator.UiDevice.getInstance(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            )
        device.executeShellCommand("mkdir -p /data/local/tmp/canopy-native-validation")
        device.executeShellCommand(
            "screencap -p /data/local/tmp/canopy-native-validation/native-feed.png"
        )
        ui.onNodeWithText(note.content).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Search", useUnmergedTree = true).performClick()
        ui.onNodeWithText("Search names, npubs or post text").performTextInput("calmer garden")
        ui.onNodeWithText(note.content).performScrollTo().assertIsDisplayed().performClick()
        ui.onNodeWithText("Thread", substring = false).assertIsDisplayed()
        ui.onNodeWithContentDescription("Back", useUnmergedTree = true).performClick()
        ui.onNodeWithText("Saved", useUnmergedTree = true).performClick()
        ui.onNodeWithText("Personal").assertIsDisplayed()
        ui.onNodeWithText(note.content).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Highlights").performClick()
        ui.onNodeWithText("No network highlights found").assertIsDisplayed()
        ui.onNodeWithText("LookMarks").performClick()
        ui.onNodeWithText("No LookMarks found").assertIsDisplayed()
        ui.onNodeWithText("Home", useUnmergedTree = true).performClick()
        ui.onNodeWithContentDescription("Compose note").performClick()
        ui.onNodeWithText("Note", substring = false)
            .performTextInput("Draft persists across dismissal")
        ui.onNodeWithContentDescription("Close", useUnmergedTree = true).performClick()
        assertEquals("Draft persists across dismissal", m.storage.get(note.pubkey, "draft"))
        ui.onNodeWithContentDescription("Compose note").performClick()
        ui.onNodeWithText("Draft persists across dismissal").assertIsDisplayed()
        ui.activityRule.scenario.recreate()
        ui.onNodeWithText("Draft persists across dismissal").assertIsDisplayed()
        ui.onNodeWithContentDescription("Close", useUnmergedTree = true).performClick()
        ui.runOnIdle {
            m.draft("")
            m.account.value = null
        }
    }

    @Test
    fun welcomeActionRemainsReachableAtLargeFont() {
        val m = ui.activity.model
        ui.waitUntil(10000) { m.initialized.value }
        ui.runOnUiThread {
            ui.activity.setContent {
                CanopyTheme {
                    val density = androidx.compose.ui.platform.LocalDensity.current.density
                    androidx.compose.runtime.CompositionLocalProvider(
                        androidx.compose.ui.platform.LocalDensity provides
                            androidx.compose.ui.unit.Density(density, 1.5f)
                    ) {
                        Welcome(m, false)
                    }
                }
            }
        }
        ui.onNodeWithText("Continue with Amber").performScrollTo().assertIsDisplayed()
        val device =
            androidx.test.uiautomator.UiDevice.getInstance(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            )
        device.executeShellCommand("mkdir -p /data/local/tmp/canopy-native-validation")
        device.executeShellCommand(
            "screencap -p /data/local/tmp/canopy-native-validation/native-welcome-large-font.png"
        )
    }

    @Test
    fun sqliteCacheSurvivesReopenAndWalletIsAccountBound() = runBlocking {
        val context = ui.activity.applicationContext
        val cache = EventCache(context)
        val note = fixture(1, "persistent public search text")
        cache.put(listOf(note))
        cache.close()
        val reopened = EventCache(context)
        assertTrue(reopened.load().any { it.id == note.id })
        reopened.close()
        val storage = AccountStorage(context)
        storage.secret(note.pubkey, "wallet scoped secret fixture")
        assertEquals("wallet scoped secret fixture", storage.secret(note.pubkey))
        assertEquals("", storage.secret("f".repeat(64)))
        val encoded = storage.get(note.pubkey, "wallet")
        assertFalse(encoded.contains("wallet scoped secret"))
        storage.secret(note.pubkey, "")
    }
}
