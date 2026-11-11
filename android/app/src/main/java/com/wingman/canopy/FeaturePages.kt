@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.wingman.canopy

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import coil3.compose.AsyncImage

@Composable
fun SearchPage(model: CanopyModel, open: (Pointer) -> Unit) {
    val events by model.events.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    val busyUi by model.busy.collectAsStateWithLifecycle()
    val people =
        events
            .filter { it.kind == 0 }
            .groupBy { it.pubkey }
            .map { (key, _) -> key }
            .filter {
                query.isBlank() ||
                    model.profile(it).toString().contains(query, true) ||
                    npub(it).contains(query, true)
            }
            .take(50)
    val posts =
        if (query.isBlank()) emptyList()
        else events.filter { it.kind == 1 && it.content.contains(query, true) }.take(80)
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 80.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Heading("Search Canopy", "On this device · public people and notes")
            Field("Search names, npubs or post text", query, { query = it })
        }
        item {
            Text(
                "${events.count { it.kind==0 }} profiles · ${events.count { it.kind==1 }} notes · ${model.cache.bytes()/1024} KB public cache",
                color = Muted,
            )
        }
        item {
            OutlinedCard {
                Column(Modifier.padding(16.dp)) {
                    Text("Following cache", style = MaterialTheme.typography.headlineMedium)
                    Text(
                        "${model.followed().size} following. Profiles refresh every 24 hours while Canopy is active.",
                        color = Muted,
                    )
                    TextButton(onClick = model::refreshCache, enabled = !busyUi) {
                        Text("Refresh following and profiles")
                    }
                }
            }
        }
        pointer(query)?.let { p ->
            item { Button(onClick = { open(p) }) { Text("Open ${p.kind} from relays") } }
        }
        if (query.contains("nsec", true))
            item {
                Text(
                    "Canopy never accepts identity private keys.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
        item { Text("People", style = MaterialTheme.typography.headlineMedium) }
        items(people, key = { it }) { person ->
            ListItem(
                headlineContent = { Text(model.name(person)) },
                supportingContent = { Text(short(npub(person))) },
                leadingContent = { Avatar(model, person) },
                modifier = Modifier.clickable { open(Pointer("profile", person)) },
            )
        }
        if (people.isEmpty()) item { Text("No cached people match.", color = Muted) }
        item { Text("Posts", style = MaterialTheme.typography.headlineMedium) }
        items(posts, key = { it.id }) { post ->
            OutlinedCard(Modifier.fillMaxWidth().clickable { open(Pointer("event", post.id)) }) {
                Column(Modifier.padding(16.dp)) {
                    Text(model.name(post.pubkey), color = Accent)
                    Text(post.content.take(220))
                }
            }
        }
        if (posts.isEmpty())
            item {
                Text(
                    if (query.isBlank()) "Type a word or phrase to search cached posts."
                    else "No cached posts match.",
                    color = Muted,
                )
            }
        item {
            Text(
                "Only public text and identifiers are indexed. Images, signing authority and wallet secrets are never indexed.",
                color = Muted,
            )
        }
    }
}

@Composable
fun ActivityPage(model: CanopyModel, open: (Pointer) -> Unit) {
    val events by model.events.collectAsStateWithLifecycle()
    val accountUi by model.account.collectAsStateWithLifecycle()
    val key = accountUi ?: return
    val notifications = events.filter { notificationType(it, key) != null }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 80.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Heading("Activity", "Replies, mentions, reactions and reposts") }
        if (notifications.isEmpty())
            item {
                Empty("Nothing new yet", "Notifications from your active relays will appear here.")
            }
        items(notifications, key = { it.id }) { e ->
            OutlinedCard(
                Modifier.fillMaxWidth().clickable {
                    val target = if (e.kind == 1) e.id else e.values("e").lastOrNull()
                    if (target != null) open(Pointer("event", target))
                    else open(Pointer("profile", e.pubkey))
                }
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("${model.name(e.pubkey)} · ${notificationType(e,key)}", color = Accent)
                    Text(e.content.take(200))
                }
            }
        }
    }
}

@Composable
fun SavedPage(
    model: CanopyModel,
    onProfile: (String) -> Unit,
    onEvent: (String) -> Unit,
    onCompose: (Event, Boolean) -> Unit,
    onMedia: (String) -> Unit,
    onZap: (Event) -> Unit,
) {
    val c = LocalContext.current
    val events by model.events.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val accountUi by model.account.collectAsStateWithLifecycle()
    val key = accountUi ?: return
    val list = latest(events, 10003, key)
    val ids = list?.values("e")?.distinct()?.reversed() ?: emptyList()
    val followed = model.followed()
    val highlights = events.filter { it.kind == 9802 && it.pubkey in followed }.take(80)
    val lookmarks = lookmarkTargets(events, followed)
    val requested =
        if (tab == 0) ids.take(100) else if (tab == 2) lookmarks.keys.toList() else emptyList()
    LaunchedEffect(requested) {
        val missing = requested.filter { id -> events.none { it.id == id } }
        if (missing.isNotEmpty()) model.openSaved(missing)
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 90.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Heading("Bookmarks", "Saved and spotted")
            PrimaryTabRow(tab) {
                listOf("Personal", "Highlights", "LookMarks").forEachIndexed { i, label ->
                    Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) })
                }
            }
        }
        if (tab == 0) {
            if (ids.isEmpty())
                item {
                    Empty(
                        "No public note bookmarks",
                        "Save a note using its bookmark control. Private list content and article addresses remain untouched.",
                    )
                }
            items(ids.take(100), key = { it }) { id ->
                events
                    .find { it.id == id }
                    ?.let { NoteCard(model, it, onProfile, onEvent, onCompose, onMedia, onZap) }
                    ?: OutlinedButton(onClick = { onEvent(id) }) {
                        Text("Open saved note ${short(id)}")
                    }
            }
            list?.values("a")?.distinct()?.forEach { address ->
                item {
                    OutlinedButton(
                        onClick = {
                            runCatching { articleSourceUrl(address) }
                                .onSuccess { external(c, it) { model.message.value = it } }
                                .onFailure { model.message.value = "Invalid article address." }
                        }
                    ) {
                        Text("Open saved article ↗")
                    }
                }
            }
        } else if (tab == 1) {
            item {
                Text(
                    "NIP-84 highlights from people you follow. Ordinary likes are excluded.",
                    color = Muted,
                )
            }
            if (highlights.isEmpty()) item { Empty("No network highlights found") }
            items(highlights, key = { it.id }) { e ->
                OutlinedCard {
                    Column(
                        Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Highlight by ${model.name(e.pubkey)}", color = Accent)
                        Text(e.content, style = MaterialTheme.typography.headlineMedium)
                        e.values("context").forEach { Text(it, color = Muted) }
                        e.values("comment").forEach { Text(it) }
                        e.values("e").firstOrNull()?.let { id ->
                            TextButton(onClick = { onEvent(id) }) { Text("Open source note →") }
                        }
                        e.values("r").filter(::safeHttps).forEach { url ->
                            val c = LocalContext.current
                            TextButton(
                                onClick = { external(c, url) { model.message.value = it } }
                            ) {
                                Text("Open external source ↗")
                            }
                        }
                        e.values("a").forEach { address ->
                            OutlinedButton(
                                onClick = {
                                    runCatching { articleSourceUrl(address) }
                                        .onSuccess { external(c, it) { model.message.value = it } }
                                        .onFailure {
                                            model.message.value = "Invalid article address."
                                        }
                                }
                            ) {
                                Text("Open source article ↗")
                            }
                        }
                    }
                }
            }
        } else {
            item {
                Text(
                    "Crowd bookmarks: 👀 reactions, threaded replies and quotes. Deduplicated targets from your followed network.",
                    color = Muted,
                )
            }
            if (lookmarks.isEmpty()) item { Empty("No LookMarks found") }
            items(lookmarks.entries.toList(), key = { it.key }) { (id, signals) ->
                Column {
                    Text(
                        "👀 ${model.name(signals.first().pubkey)} · ${signals.size} network signals",
                        Modifier.padding(8.dp),
                        color = Muted,
                    )
                    events
                        .find { it.id == id }
                        ?.let { NoteCard(model, it, onProfile, onEvent, onCompose, onMedia, onZap) }
                        ?: OutlinedButton(onClick = { onEvent(id) }) {
                            Text("Open target ${short(id)}")
                        }
                }
            }
        }
    }
}

@Composable
fun ProfilePage(
    model: CanopyModel,
    key: String,
    onProfile: (String) -> Unit,
    onEvent: (String) -> Unit,
    onCompose: (Event, Boolean) -> Unit,
    onMedia: (String) -> Unit,
    onShare: () -> Unit,
    onEdit: () -> Unit,
    onZap: (Event) -> Unit,
) {
    val events by model.events.collectAsStateWithLifecycle()
    val accountUi by model.account.collectAsStateWithLifecycle()
    val busyUi by model.busy.collectAsStateWithLifecycle()
    val profile = model.profile(key)
    val notes = events.filter { it.kind == 1 && it.pubkey == key }
    val context = LocalContext.current
    LaunchedEffect(key) { model.open(Pointer("profile", key)) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 90.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            profile.optString("banner").takeIf(::safeHttps)?.let {
                AsyncImage(
                    it,
                    "Profile banner",
                    Modifier.fillMaxWidth().height(130.dp).clip(RoundedCornerShape(16.dp)),
                    contentScale = ContentScale.Crop,
                )
            }
            Row(
                Modifier.padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(model, key, 64)
                Column(Modifier.weight(1f)) {
                    Text(model.name(key), style = MaterialTheme.typography.headlineMedium)
                    Text(short(npub(key)), color = Muted)
                }
            }
            if (profile.optString("about").isNotBlank())
                Text(profile.optString("about"), Modifier.padding(vertical = 12.dp))
            listOf("nip05", "lud16").forEach { field ->
                profile.optString(field).takeIf { it.isNotBlank() }?.let { Text(it, color = Muted) }
            }
            profile.optString("website").takeIf(::safeHttps)?.let { url ->
                TextButton(onClick = { external(context, url) { model.message.value = it } }) {
                    Text(url)
                }
            }
            FlowRow {
                if (accountUi == key) TextButton(onClick = onEdit) { Text("Edit profile") }
                else if (accountUi != null)
                    Button(onClick = { model.follow(key) }, enabled = !busyUi) {
                        Text(if (key in model.followed()) "Unfollow" else "Follow")
                    }
                TextButton(onClick = onShare) { Text("Share profile") }
                TextButton(onClick = { model.open(Pointer("profile", key)) }) { Text("Refresh") }
            }
        }
        if (notes.isEmpty())
            item {
                Empty(
                    "No posts found",
                    "No recent notes from this profile on your read relays. You can refresh when connected.",
                )
            }
        items(notes, key = { it.id }) {
            NoteCard(model, it, onProfile, onEvent, onCompose, onMedia, onZap)
        }
        if (notes.isNotEmpty())
            item {
                OutlinedButton(
                    onClick = { model.moreProfile(key, notes.minOf { it.createdAt }) },
                    enabled = !busyUi,
                ) {
                    Text("Load older profile posts")
                }
            }
    }
}

@Composable
fun ThreadPage(
    model: CanopyModel,
    key: String,
    onProfile: (String) -> Unit,
    onEvent: (String) -> Unit,
    onCompose: (Event, Boolean) -> Unit,
    onMedia: (String) -> Unit,
    onZap: (Event) -> Unit,
) {
    val events by model.events.collectAsStateWithLifecycle()
    val focus = events.find { it.id == key }
    val root = focus?.root() ?: key
    val thread = threadRows(events, root, key)
    var collapsed by rememberSaveable(key) { mutableStateOf(listOf<String>()) }
    LaunchedEffect(key) { model.open(Pointer("event", key)) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 90.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Heading("Thread", "${thread.size} loaded notes · focused context")
            TextButton(onClick = { model.open(Pointer("event", key)) }) { Text("Refresh thread") }
        }
        if (focus == null)
            item {
                Empty(
                    "Note not available",
                    "This note is missing from your cache or read relays. Refresh when connected.",
                )
            }
        if (root != key && events.none { it.id == root })
            item {
                OutlinedButton(onClick = { onEvent(root) }) {
                    Text("Root note unavailable · retry")
                }
            }
        val hidden = mutableSetOf<String>()
        thread.forEach { (e, depth) ->
            if (e.parent() in collapsed || e.parent() in hidden) hidden.add(e.id)
        }
        items(thread.filter { it.first.id !in hidden }, key = { it.first.id }) { (e, depth) ->
            Column {
                if (e.id == key) Text("Focused note", Modifier.padding(8.dp), color = Accent)
                NoteCard(model, e, onProfile, onEvent, onCompose, onMedia, onZap, depth)
                val children = events.count { it.parent() == e.id }
                if (children > 0)
                    TextButton(
                        onClick = {
                            collapsed =
                                if (e.id in collapsed) collapsed - e.id else collapsed + e.id
                        }
                    ) {
                        Text(if (e.id in collapsed) "Show $children replies" else "Collapse branch")
                    }
            }
        }
    }
}
