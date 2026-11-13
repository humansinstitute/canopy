@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.wingman.canopy

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*

@Composable
fun SettingsPage(model: CanopyModel) {
    val accountUi by model.account.collectAsStateWithLifecycle()
    val key = accountUi ?: return
    key(key) { AccountSettingsPage(model, key) }
}

@Composable
private fun AccountSettingsPage(model: CanopyModel, key: String) {
    val busyUi by model.busy.collectAsStateWithLifecycle()
    val settings by model.settings.collectAsStateWithLifecycle()
    val status by model.transport.status.collectAsStateWithLifecycle()
    var read by rememberSaveable(settings) { mutableStateOf(settings.read.joinToString("\n")) }
    var write by rememberSaveable(settings) { mutableStateOf(settings.write.joinToString("\n")) }
    var blossom by
        rememberSaveable(settings) { mutableStateOf(settings.blossom.joinToString("\n")) }
    var nwc by rememberSaveable { mutableStateOf("") }
    var wallet by remember {
        mutableStateOf(runCatching { model.storage.secret(key).isNotBlank() }.getOrDefault(false))
    }
    var amount by rememberSaveable { mutableStateOf(model.storage.get(key, "zapAmount", "21")) }
    var zapMessage by rememberSaveable { mutableStateOf(model.storage.get(key, "zapMessage")) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Heading("Settings", "Saved separately for your public account on this device")
        Field("Read relays", read, { read = it }, 3)
        Field("Write relays", write, { write = it }, 3)
        Field("Blossom upload servers (local override)", blossom, { blossom = it }, 2)
        Row {
            TextButton(onClick = model::resetSettings) { Text("Reset to profile") }
            Button(
                onClick = {
                    runCatching {
                        model.saveSettings(NetworkSettings.parse(read, write, blossom))
                        error = null
                    }
                        .onFailure { error = it.message }
                }
            ) {
                Text("Save settings")
            }
        }
        BlossomListEditor(model, key)
        status.forEach { (url, online) ->
            Text(
                "${if(online) "●" else "○"} $url · ${if(online) "connected" else "retrying/offline"}",
                color = Muted,
            )
        }
        HorizontalDivider()
        Text("One-tap zaps", style = MaterialTheme.typography.headlineMedium)
        Field("Default amount (sats)", amount, { amount = it })
        Field("Default zap message", zapMessage, { zapMessage = it.take(280) })
        Text(
            "A normal Zap tap uses your saved amount and message. Long-press Zap for a one-off choice. A connected NWC wallet pays after Amber approves the zap request.",
            color = Muted,
        )
        Button(
            onClick = {
                runCatching {
                    val sats = amount.toLongOrNull()
                    require(sats != null && sats in 1..1000000) {
                        "Choose a whole amount from 1 to 1,000,000 sats."
                    }
                    model.storage.put(key, "zapAmount", sats.toString())
                    model.storage.put(key, "zapMessage", zapMessage)
                    model.message.value = "Zap defaults saved."
                }
                    .onFailure { error = it.message }
            }
        ) {
            Text("Save zap defaults")
        }
        HorizontalDivider()
        Text("Nostr Wallet Connect", style = MaterialTheme.typography.headlineMedium)
        Text(
            "The wallet connection authorizes spending. It is encrypted with Android Keystore and is never part of the public cache or backup.",
            color = Muted,
        )
        if (wallet) {
            Text("Wallet connected")
            OutlinedButton(
                onClick = {
                    model.storage.secret(key, "")
                    wallet = false
                }
            ) {
                Text("Remove wallet")
            }
        } else {
            Field("NWC connection URI", nwc, { nwc = it }, secret = true)
            Button(
                onClick = {
                    runCatching {
                        val parsed = WalletConnection.parse(nwc)
                        parsed.secret.fill(0)
                        model.storage.secret(key, nwc)
                        nwc = ""
                        wallet = true
                    }
                        .onFailure { error = it.message }
                },
                enabled = nwc.isNotBlank(),
            ) {
                Text("Connect wallet")
            }
        }
        HorizontalDivider()
        Text("Settings backup", style = MaterialTheme.typography.headlineMedium)
        Text(
            "NStack backup is available on the website through its browser bridge. Native Canopy has no supported NStack authority; network preferences, drafts and wallet connections stay on this device.",
            color = Muted,
        )
        HorizontalDivider()
        Text("Storage", style = MaterialTheme.typography.headlineMedium)
        Text(
            "${model.cache.bytes()/1024} KB public event cache. Clearing it removes offline search data.",
            color = Muted,
        )
        OutlinedButton(onClick = model::clearCache, enabled = !busyUi) {
            Text("Clear public cache")
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Text(
            "Canopy ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · Native Kotlin",
            color = Muted,
        )
        Spacer(Modifier.height(30.dp))
    }
}
