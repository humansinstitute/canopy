package com.wingman.canopy

import android.content.Intent
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test

/**
 * OS intent navigation changes Activity.intent, so use UiAutomator instead of ActivityScenario's
 * intent-matching observer.
 */
class NativeLinksTest {
    @Test
    fun publicAndNostrLinksClipboardShareSheetAndIncomingText() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val key = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
        fun launch(intent: Intent) {
            context.startActivity(
                intent
                    .setPackage(BuildConfig.APPLICATION_ID)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        fun click(text: String) {
            val node = device.wait(Until.findObject(By.text(text)), 15000)
            assertNotNull("Native control: $text", node)
            node!!.click()
        }
        try {
            launch(Intent(Intent.ACTION_VIEW, Uri.parse(profileUrl(key))))
            click("Share profile")
            click("Copy profile link")
            val clipboard =
                context.getSystemService(android.content.Context.CLIPBOARD_SERVICE)
                    as android.content.ClipboardManager
            assertEquals(profileUrl(key), clipboard.primaryClip!!.getItemAt(0).text.toString())
            // Android clipboard preview temporarily intercepts taps over the dialog.
            android.os.SystemClock.sleep(6500)
            click("Share public profile link")
            assertTrue(device.wait(Until.hasObject(By.text("Sharing link")), 10000))
            device.executeShellCommand("mkdir -p /data/local/tmp/canopy-native-validation")
            device.executeShellCommand(
                "screencap -p /data/local/tmp/canopy-native-validation/native-share-sheet.png"
            )
            repeat(3) {
                if (device.currentPackageName != BuildConfig.APPLICATION_ID) {
                    device.pressBack()
                    device.waitForIdle(1000)
                }
            }
            assertEquals(BuildConfig.APPLICATION_ID, device.currentPackageName)
            device.wait(Until.findObject(By.desc("Close")), 10000)!!.click()
            launch(Intent(Intent.ACTION_VIEW, Uri.parse("nostr:${npub(key)}")))
            click("Share profile")
            assertNotNull(device.wait(Until.findObject(By.text(npub(key))), 10000))
            device.executeShellCommand(
                "screencap -p /data/local/tmp/canopy-native-validation/native-profile-qr.png"
            )
            device.findObject(By.desc("Close"))!!.click()
            val shared = "https://example.org/native-incoming-share"
            launch(
                Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, shared)
            )
            device.wait(Until.findObject(By.desc("Account options")), 10000)!!.click()
            click("Connect Amber")
            device
                .wait(Until.findObject(By.text("Manually approve each permission")), 5000)
                ?.click()
            click("Connect")
            assertNotNull(device.wait(Until.findObject(By.text(shared)), 15000))
            device.executeShellCommand(
                "screencap -p /data/local/tmp/canopy-native-validation/native-incoming-share.png"
            )
            device.wait(Until.findObject(By.desc("Close")), 10000)!!.click()
        } finally {
            device.pressHome()
        }
    }
}
