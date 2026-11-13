package com.wingman.canopy

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun BlossomListEditor(model: CanopyModel, account: String) {
    val busy by model.busy.collectAsStateWithLifecycle()
    var base by remember(account) { mutableStateOf<Event?>(null) }
    var loaded by remember(account) { mutableStateOf(false) }
    var servers by rememberSaveable(account) { mutableStateOf(arrayListOf<String>()) }
    var confirm by remember(account) { mutableStateOf(false) }
    var reload by remember(account) { mutableStateOf(false) }
    var error by remember(account) { mutableStateOf<String?>(null) }
    val active = remember(account) { mutableStateOf(true) }
    DisposableEffect(account) { active.value = true; onDispose { active.value = false } }
    fun load() {
        model.action {
            loaded = false
            val found = model.loadBlossomList(account)
            if (active.value) {
                base = found
                servers = ArrayList(found?.tags?.filter { it.firstOrNull() == "server" }?.map { it.getOrNull(1) ?: "" } ?: emptyList())
                loaded = true
                error = null
                model.message.value = if (found == null) "No published Blossom list found. Add at least one server." else "Published Blossom list loaded; first server is preferred."
            }
        }
    }
    fun edit(next: List<String>) { if (busy) return; servers = ArrayList(next); confirm = false; error = null }
    HorizontalDivider()
    Text("Published Blossom server list", style = MaterialTheme.typography.headlineMedium)
    Text("Public BUD-03 list for this Nostr account, separate from the local upload override. HTTPS only; at least one server is required. Amber approves kind 10063.", color = Muted)
    OutlinedButton(onClick = { if (loaded) reload = true else load() }, enabled = !busy) {
        Text(if (loaded) "Reload published list" else "Load published list")
    }
    if (loaded) {
        servers.forEachIndexed { index, server ->
            Field("Profile server ${index + 1}", server, { value -> edit(servers.mapIndexed { i, old -> if (i == index) value else old }) })
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TextButton(onClick = {
                    val next = servers.toMutableList(); java.util.Collections.swap(next, index, index - 1); edit(next)
                }, enabled = !busy && index > 0) { Text("Up ${index + 1}") }
                TextButton(onClick = {
                    val next = servers.toMutableList(); java.util.Collections.swap(next, index, index + 1); edit(next)
                }, enabled = !busy && index < servers.lastIndex) { Text("Down ${index + 1}") }
                TextButton(onClick = { edit(servers.filterIndexed { i, _ -> i != index }) }, enabled = !busy) { Text("Remove ${index + 1}") }
            }
        }
        OutlinedButton(onClick = { edit(servers + "") }, enabled = !busy && servers.size < 8) { Text("Add profile server") }
        Button(onClick = {
            runCatching { validateProfileServers(servers) }.onSuccess { servers = ArrayList(it); confirm = true; error = null }.onFailure { error = it.message }
        }, enabled = !busy) { Text("Publish profile list") }
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    if (reload) AlertDialog(
        onDismissRequest = { reload = false },
        title = { Text("Reload published list?") },
        text = { Text("This discards your profile-list edits and loads the newest list from your configured relays. Local overrides are unchanged.") },
        confirmButton = { TextButton(onClick = { reload = false; load() }) { Text("Reload") } },
        dismissButton = { TextButton(onClick = { reload = false }) { Text("Cancel") } },
    )
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Publish Blossom list?") },
        text = { Text("Replace your public list with these ${servers.size} servers, in order:\n\n${servers.joinToString("\n")}\n\nLocal overrides are unchanged. Amber will ask for approval.") },
        confirmButton = { TextButton(onClick = {
            confirm = false
            model.publishBlossomList(account, base, servers.toList(), { active.value }) { published -> base = published }
        }) { Text("Confirm publish") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
    )
}
