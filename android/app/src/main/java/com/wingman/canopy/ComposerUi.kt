@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.wingman.canopy

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
fun FullDialog(title: String, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(
        onDismissRequest = onClose,
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize().systemBarsPadding().imePadding(), color = Background) {
            Column {
                Row(
                    Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Close") }
                    Text(title, style = MaterialTheme.typography.headlineMedium)
                }
                Column(
                    Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    content = content,
                )
            }
        }
    }
}

@Composable
fun ComposerDialog(model: CanopyModel, target: Event?, quote: Boolean, onClose: () -> Unit) {
    val accountUi by model.account.collectAsStateWithLifecycle()
    val eventsUi by model.events.collectAsStateWithLifecycle()
    val account = accountUi ?: return
    val draftKey =
        if (target == null) "draft" else "draft.${if(quote) "quote" else "reply"}.${target.id}"
    var text by
        rememberSaveable(account, draftKey) { mutableStateOf(model.storage.get(account, draftKey)) }
    var images by rememberSaveable { mutableStateOf(listOf<String>()) }
    var tool by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var gifs by remember { mutableStateOf<List<Gif>>(emptyList()) }
    var gifLoading by remember { mutableStateOf(false) }
    var upload by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val messageUi by model.message.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val signerBusy by model.signer.busy.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    fun update(value: String) {
        text = value
        model.storage.put(account, draftKey, value)
        if (target == null) model.draft(value)
    }
    fun uploadImage(uri: Uri) {
        if (upload || images.size >= 4) return
        upload = true
        scope.launch {
            try {
                val url =
                    model.media.upload(
                        context,
                        uri,
                        model.settings.value.blossom,
                        account,
                        model.signer,
                    )
                images = images + url
                update(text.trimEnd() + "\n" + url)
            } catch (e: Exception) {
                error = e.message
            } finally {
                upload = false
            }
        }
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            uri?.let(::uploadImage)
        }
    FullDialog(
        if (target == null) "What’s moving?" else if (quote) "Add your take" else "Reply",
        onClose,
    ) {
        if (target != null)
            OutlinedCard {
                Column(Modifier.padding(14.dp)) {
                    Text(model.name(target.pubkey), color = Accent)
                    Text(target.content.take(180), color = Muted)
                }
            }
        OutlinedTextField(
            text,
            { if (it.length <= 20000) update(it) },
            label = { Text(if (quote) "Quote comment" else "Note") },
            minLines = 5,
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy && !upload && !signerBusy,
        )
        Text(
            "${2800-text.length} characters remaining",
            color = if (text.length > 2800) MaterialTheme.colorScheme.error else Muted,
        )
        FlowRow {
            TextButton(
                onClick = { picker.launch("image/*") },
                enabled = !upload && !busy && images.size < 4,
            ) {
                Text(if (upload) "Uploading…" else "Add image")
            }
            listOf("Mention", "Emoji", "GIF").forEach { name ->
                TextButton(
                    onClick = {
                        tool = if (tool == name) "" else name
                        query = ""
                    }
                ) {
                    Text(name)
                }
            }
        }
        images.forEach { url ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(url, "Uploaded image", Modifier.size(56.dp))
                Text(short(url), Modifier.weight(1f))
                IconButton(
                    onClick = {
                        images = images - url
                        update(text.replace(url, "").trim())
                    }
                ) {
                    Icon(Icons.Outlined.Close, "Remove image")
                }
            }
        }
        val clipboard =
            LocalContext.current.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.primaryClip?.getItemAt(0)?.uri?.let { uri ->
            if (uri.scheme == "content")
                TextButton(onClick = { uploadImage(uri) }, enabled = !upload) {
                    Text("Paste image from clipboard")
                }
        }
        if (tool.isNotBlank()) {
            Field("Search $tool", query, { query = it })
            when (tool) {
                "Mention" -> {
                    eventsUi
                        .filter { it.kind == 0 }
                        .map { it.pubkey }
                        .distinct()
                        .filter {
                            model.name(it).contains(query, true) || npub(it).contains(query, true)
                        }
                        .take(8)
                        .forEach { key ->
                            TextButton(
                                onClick = {
                                    update(text + " nostr:${npub(key)} ")
                                    tool = ""
                                }
                            ) {
                                Text("@${model.name(key)}")
                            }
                        }
                    Text(
                        "Mentions insert a public Nostr reference and add a p tag when published.",
                        color = Muted,
                    )
                }
                "Emoji" ->
                    FlowRow {
                        emojiChoices
                            .filter { it.second.contains(query, true) }
                            .take(40)
                            .forEach { (emoji, _) ->
                                TextButton(
                                    onClick = {
                                        update(text + emoji)
                                        tool = ""
                                    }
                                ) {
                                    Text(emoji, fontSize = 24.sp)
                                }
                            }
                    }
                "GIF" -> {
                    Button(
                        onClick = {
                            gifLoading = true
                            scope.launch {
                                try {
                                    gifs = model.media.gifs(query)
                                    if (gifs.isEmpty()) error = "No GIFs found."
                                } catch (e: Exception) {
                                    error = e.message
                                } finally {
                                    gifLoading = false
                                }
                            }
                        },
                        enabled = !gifLoading && query.isNotBlank(),
                    ) {
                        Text(if (gifLoading) "Searching Commons…" else "Search Wikimedia Commons")
                    }
                    gifs.forEach { gif ->
                        OutlinedCard(
                            Modifier.fillMaxWidth().clickable {
                                update(text + "\n" + gif.url)
                                tool = ""
                            }
                        ) {
                            Row(
                                Modifier.padding(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AsyncImage(gif.url, gif.title, Modifier.size(80.dp))
                                Text(gif.title, Modifier.padding(8.dp))
                            }
                        }
                    }
                    Text(
                        "GIFs link to Wikimedia Commons. Check their source license before reusing.",
                        color = Muted,
                    )
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        messageUi?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = {
                model.post(text, target, quote) {
                    model.storage.put(account, draftKey, "")
                    onClose()
                }
            },
            enabled = !busy && !upload && !signerBusy && text.isNotBlank() && text.length <= 2800,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (busy) "Publishing…"
                else if (quote) "Publish quote"
                else if (target != null) "Publish reply" else "Post note"
            )
        }
        Text(
            "Your draft is saved for this account on this device. Amber must approve the exact event; publication waits for relay confirmation.",
            color = Muted,
        )
    }
}

val emojiChoices =
    listOf(
        "😀" to "smile happy",
        "😂" to "laugh joy",
        "😊" to "happy blush",
        "😍" to "love heart",
        "🤔" to "think",
        "😎" to "cool",
        "😢" to "cry sad",
        "👍" to "yes like",
        "👎" to "no dislike",
        "👏" to "clap",
        "🙏" to "thanks pray",
        "👀" to "eyes look",
        "❤️" to "heart love",
        "🧡" to "bitcoin heart",
        "🔥" to "fire",
        "✨" to "sparkles",
        "⚡" to "zap lightning",
        "🎉" to "party celebrate",
        "🚀" to "rocket launch",
        "🌱" to "plant grow",
        "₿" to "bitcoin",
        "☕" to "coffee",
        "✅" to "done yes",
        "💯" to "hundred perfect",
    )

@Composable
fun ProfileEditor(model: CanopyModel, key: String, onClose: () -> Unit) {
    val fields =
        listOf(
            "display_name" to "Display name",
            "name" to "Username",
            "about" to "Bio",
            "picture" to "Picture URL",
            "banner" to "Banner URL",
            "website" to "Website",
            "nip05" to "NIP-05 address",
            "lud16" to "Lightning address",
        )
    var values by
        rememberSaveable(key) {
            mutableStateOf(fields.associate { it.first to model.profile(key).optString(it.first) })
        }
    var resolved by rememberSaveable(key) { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var loadError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(key, revision) {
        if (!resolved)
            try {
                val profile = model.profileForEdit(key)
                values = fields.associate { it.first to profile.optString(it.first) }
                resolved = true
                loadError = null
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                loadError = e.message ?: "Profile could not load."
            }
    }
    val messageUi by model.message.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    FullDialog("Edit profile", onClose) {
        if (!resolved) {
            Text(loadError ?: "Loading profile before editing…", color = Muted)
            TextButton(onClick = { revision++ }) { Text("Retry loading profile") }
        }

        messageUi?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Text("Unknown profile fields are preserved. Blank fields are removed.", color = Muted)
        if (resolved)
            fields.forEach { (name, label) ->
                Field(
                    label,
                    values[name] ?: "",
                    { value ->
                        val limit =
                            when (name) {
                                "about" -> 5000
                                "display_name" -> 80
                                "name" -> 50
                                else -> 2048
                            }
                        values = values + (name to value.take(limit))
                    },
                    if (name == "about") 3 else 1,
                )
            }
        Button(
            onClick = { model.editProfile(values, onClose) },
            enabled = resolved && !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (busy) "Saving…" else "Save profile")
        }
    }
}
