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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import coil3.compose.AsyncImage
import java.text.DateFormat
import java.util.Date

@Composable
fun FeedPage(
    model: CanopyModel,
    onProfile: (String) -> Unit,
    onEvent: (String) -> Unit,
    onCompose: (Event, Boolean) -> Unit,
    onMedia: (String) -> Unit,
    onZap: (Event) -> Unit,
) {
    val accountUi by model.account.collectAsStateWithLifecycle()
    val loading by model.loading.collectAsStateWithLifecycle()
    val eventsUi by model.events.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val feed = eventsUi.filter {
        it.kind == 1 && (it.pubkey in model.followed() || it.pubkey == accountUi)
    }
    val refreshing = loading
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = model::refresh) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 90.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Heading("Your feed", "Hello, ${accountUi?.let(model::name) ?: "friend"}")
                Row {
                    TextButton(onClick = model::refresh, enabled = !busy) { Text("Refresh") }
                    Text(
                        "${model.followed().size} following",
                        color = Muted,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
            if (feed.isEmpty())
                item {
                    Empty(
                        if (loading) "Loading your following feed" else "No posts yet",
                        if (model.followed().isEmpty())
                            "Follow a profile to bring their notes here. Your own notes also appear."
                        else "Your cached feed stays here when offline. Refresh when connected.",
                    )
                }
            items(feed, key = { it.id }) { e ->
                NoteCard(model, e, onProfile, onEvent, onCompose, onMedia, onZap)
            }
            if (feed.isNotEmpty())
                item {
                    OutlinedButton(
                        onClick = model::more,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Load older posts")
                    }
                }
        }
    }
}

@Composable
fun NoteCard(
    model: CanopyModel,
    event: Event,
    onProfile: (String) -> Unit,
    onEvent: (String) -> Unit,
    onCompose: (Event, Boolean) -> Unit,
    onMedia: (String) -> Unit,
    onZap: (Event) -> Unit,
    depth: Int = 0,
) {
    val eventsUi by model.events.collectAsStateWithLifecycle()
    val accountUi by model.account.collectAsStateWithLifecycle()
    val busyUi by model.busy.collectAsStateWithLifecycle()
    var expanded by rememberSaveable(event.id) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val links =
        remember(event.content) {
            Regex("https://[^\\s<>]+", RegexOption.IGNORE_CASE)
                .findAll(event.content)
                .map { it.value.trimEnd('.', ',', ')') }
                .filter(::safeHttps)
                .distinct()
                .toList()
        }
    val images =
        links
            .filter {
                Regex("\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$", RegexOption.IGNORE_CASE)
                    .containsMatchIn(it)
            }
            .take(4)
    val videos =
        links
            .filter {
                Regex("\\.(mp4|webm|mov|m3u8)(\\?.*)?$", RegexOption.IGNORE_CASE)
                    .containsMatchIn(it)
            }
            .take(4)
    val refs =
        remember(event.content) {
            Regex("nostr:(?:npub1|nprofile1|note1|nevent1)[a-z0-9]+", RegexOption.IGNORE_CASE)
                .findAll(event.content)
                .mapNotNull { pointer(it.value) }
                .distinct()
                .take(8)
                .toList()
        }
    Card(
        Modifier.fillMaxWidth().padding(start = minOf(depth, 6).times(10).dp),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xff18221d)),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.weight(1f).clickable { onProfile(event.pubkey) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Avatar(model, event.pubkey)
                    Column {
                        Text(model.name(event.pubkey))
                        Text(
                            DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                                .format(Date(event.createdAt * 1000)),
                            style = MaterialTheme.typography.labelSmall,
                            color = Muted,
                        )
                    }
                }
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Outlined.MoreHoriz, "Note options")
                    }
                    DropdownMenu(menu, { menu = false }) {
                        listOf(
                                "Share Canopy link" to eventUrl(event),
                                "Copy Canopy link" to eventUrl(event),
                                "Copy event reference" to "nostr:${eventRef(event)}",
                                "Copy raw event ID" to event.id,
                            )
                            .forEachIndexed { i, p ->
                                DropdownMenuItem(
                                    text = { Text(p.first) },
                                    onClick = {
                                        if (i == 0) share(context, p.second)
                                        else copy(context, p.second)
                                        menu = false
                                    },
                                )
                            }
                    }
                }
            }
            if (event.parent() != null)
                TextButton(onClick = { onEvent(event.parent()!!) }) {
                    Text("↳ Reply context · ${short(event.parent()!!)}")
                }
            val prose =
                remember(event.content, images, videos) {
                    var value =
                        (images + videos).fold(event.content) { text, url -> text.replace(url, "") }
                    value =
                        Regex("nostr:(?:note1|nevent1)[a-z0-9]+", RegexOption.IGNORE_CASE).replace(
                            value
                        ) { match ->
                            if (pointer(match.value)?.kind == "event") "" else match.value
                        }
                    value.trim()
                }
            val text = if (expanded || prose.length <= 700) prose else prose.take(700) + "…"
            if (text.isNotBlank())
                RichText(
                    text,
                    onProfile,
                    onEvent,
                    { external(context, it) { model.message.value = it } },
                    { ref ->
                        if (ref.kind == "profile") "@${model.name(ref.key)}" else "Referenced note"
                    },
                )
            if (prose.length > 700)
                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "Show less" else "Read more")
                }
            refs.forEach { ref ->
                val target = eventsUi.find { it.id == ref.key }
                OutlinedCard(
                    Modifier.fillMaxWidth().clickable {
                        if (ref.kind == "profile") onProfile(ref.key) else onEvent(ref.key)
                    }
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            if (ref.kind == "profile") model.name(ref.key)
                            else target?.let { model.name(it.pubkey) } ?: "Referenced event",
                            color = Accent,
                        )
                        Text(target?.content?.take(160) ?: short(ref.key), color = Muted)
                    }
                }
            }
            images.forEachIndexed { i, url ->
                AsyncImage(
                    url,
                    "Image attached to note ${i+1}",
                    Modifier.fillMaxWidth()
                        .heightIn(min = 180.dp, max = 360.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .clickable { onMedia(url) },
                    contentScale = ContentScale.Crop,
                )
            }
            videos.forEach { url ->
                OutlinedButton(onClick = { onMedia(url) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.PlayArrow, null)
                    Text("Play video")
                }
            }
            val account = accountUi
            if (account == null) TextButton(onClick = model::login) { Text("Log in to interact") }
            else {
                val liked = eventsUi.any {
                    it.kind == 7 &&
                        it.pubkey == account &&
                        event.id in it.values("e") &&
                        it.content == "+"
                }
                val saved =
                    latest(eventsUi, 10003, account)?.values("e")?.contains(event.id) == true
                FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    Action(
                        if (liked) "Liked" else "Like",
                        Icons.Outlined.FavoriteBorder,
                        enabled = !busyUi && !liked,
                    ) {
                        model.like(event)
                    }
                    Action("Reply", Icons.Outlined.ChatBubbleOutline) { onCompose(event, false) }
                    Action("Quote", Icons.Outlined.FormatQuote) { onCompose(event, true) }
                    Action("Repost", Icons.Outlined.Repeat, enabled = !busyUi) {
                        model.repost(event)
                    }
                    Row(
                        Modifier.defaultMinSize(minHeight = 48.dp)
                            .combinedClickable(
                                enabled = !busyUi,
                                onClick = { model.zap(event) },
                                onLongClick = { onZap(event) },
                                onLongClickLabel = "Choose custom zap",
                                role = androidx.compose.ui.semantics.Role.Button,
                            )
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(Icons.Outlined.Bolt, null, Modifier.size(18.dp), tint = Accent)
                        Text("Zap", color = Accent, style = MaterialTheme.typography.labelMedium)
                    }
                    Action(
                        if (saved) "Saved" else "Save",
                        Icons.Outlined.BookmarkBorder,
                        enabled = !busyUi,
                    ) {
                        model.bookmark(event)
                    }
                }
            }
            TextButton(onClick = { onEvent(event.id) }, contentPadding = PaddingValues(0.dp)) {
                Text("Open thread →")
            }
        }
    }
}

@Composable
fun Action(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = enabled, contentPadding = PaddingValues(8.dp)) {
        Icon(icon, null, Modifier.size(18.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
fun RichText(
    text: String,
    onProfile: (String) -> Unit,
    onEvent: (String) -> Unit,
    onExternal: (String) -> Unit,
    referenceLabel: (Pointer) -> String = { short(it.key) },
) {
    val annotated = buildAnnotatedString {
        val pattern =
            Regex(
                "(?:https://[^\\s<>]+|nostr:(?:npub1|nprofile1|note1|nevent1)[a-z0-9]+)",
                RegexOption.IGNORE_CASE,
            )
        var start = 0
        pattern.findAll(text).forEach { match ->
            append(text.substring(start, match.range.first))
            val raw = match.value
            val p = pointer(raw)
            if (p != null || safeHttps(raw)) {
                pushLink(
                    LinkAnnotation.Clickable(
                        raw,
                        TextLinkStyles(style = SpanStyle(color = Accent)),
                    ) {
                        if (p?.kind == "profile") onProfile(p.key)
                        else if (p != null) onEvent(p.key) else onExternal(raw)
                    }
                )
                append(if (p != null) referenceLabel(p) else raw)
                pop()
            } else append(raw)
            start = match.range.last + 1
        }
        append(text.substring(start))
    }
    SelectionContainerText(annotated)
}

@Composable
private fun SelectionContainerText(text: AnnotatedString) {
    androidx.compose.foundation.text.selection.SelectionContainer {
        Text(text, style = MaterialTheme.typography.bodyLarge, lineHeight = 25.sp)
    }
}
