@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.wingman.canopy

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import coil3.compose.AsyncImage
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

val Accent = Color(0xffc8ff66)
val Muted = Color(0xff8e9c93)
val Background = Color(0xff0b110e)
private val Sans = FontFamily(Font(R.font.dm_sans))
private val Serif = FontFamily(Font(R.font.newsreader))

@Composable
fun CanopyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            darkColorScheme(
                primary = Accent,
                onPrimary = Color(0xff17200e),
                background = Background,
                surface = Color(0xff18221d),
                onSurface = Color(0xffecf1e9),
                surfaceVariant = Color(0xff213127),
                secondary = Accent,
                secondaryContainer = Color(0xff314427),
                onSecondaryContainer = Accent,
                primaryContainer = Color(0xff243b20),
                onPrimaryContainer = Accent,
                surfaceTint = Accent,
                inverseSurface = Color(0xff28422a),
                inverseOnSurface = Color(0xffecf1e9),
                inversePrimary = Accent,
                tertiary = Color(0xff8ee68f),
                onBackground = Color(0xffecf1e9),
                surfaceContainer = Color(0xff18221d),
                surfaceContainerLow = Color(0xff141e19),
                surfaceContainerHigh = Color(0xff1d2a22),
                surfaceContainerHighest = Color(0xff24352a),
                onSurfaceVariant = Color(0xffaab6ae),
                outline = Color(0xff4c5c50),
            ),
        typography =
            Typography(
                bodyLarge = Typography().bodyLarge.copy(fontFamily = Sans),
                bodyMedium = Typography().bodyMedium.copy(fontFamily = Sans),
                headlineLarge = Typography().headlineLarge.copy(fontFamily = Serif),
                headlineMedium = Typography().headlineMedium.copy(fontFamily = Serif),
            ),
        content = content,
    )
}

@Composable
fun CanopyMark(size: Int) {
    Canvas(Modifier.size(size.dp)) {
        val w = this.size.width
        val h = this.size.height
        listOf(0.18f to 0.6f, 0.46f to 0.95f, 0.74f to 0.43f).forEach { (x, height) ->
            drawLine(
                Accent,
                androidx.compose.ui.geometry.Offset(w * x, h * 0.9f),
                androidx.compose.ui.geometry.Offset(w * (x + 0.12f), h * (0.9f - height * 0.8f)),
                strokeWidth = w * 0.16f,
                cap = androidx.compose.ui.graphics.StrokeCap.Round,
            )
        }
    }
}

fun copy(context: Context, text: String) {
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(
        ClipData.newPlainText("Canopy", text)
    )
}

fun share(context: Context, text: String) {
    context.startActivity(
        Intent.createChooser(
            Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text),
            "Share Canopy",
        )
    )
}

fun external(context: Context, url: String, onError: (String) -> Unit) {
    if (
        !safeHttps(url) &&
            !Regex("lightning:ln(?:bc|tb|bcrt)[a-z0-9]+", RegexOption.IGNORE_CASE).matches(url)
    ) {
        onError("This link type is not supported.")
        return
    }
    runCatching {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
        )
    }
        .onFailure { onError("No app is installed to open this link.") }
}

@Composable
fun Heading(title: String, subtitle: String = "") {
    Column(Modifier.padding(vertical = 12.dp)) {
        Text(title, style = MaterialTheme.typography.headlineLarge)
        if (subtitle.isNotBlank())
            Text(subtitle, color = Muted, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
fun Empty(title: String, detail: String = "") {
    Column(
        Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("◇", fontSize = 30.sp, color = Accent)
        Text(title, style = MaterialTheme.typography.headlineMedium)
        if (detail.isNotBlank())
            Text(detail, color = Muted, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    lines: Int = 1,
    secret: Boolean = false,
) {
    OutlinedTextField(
        value,
        onChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        minLines = lines,
        visualTransformation =
            if (secret) PasswordVisualTransformation()
            else androidx.compose.ui.text.input.VisualTransformation.None,
        singleLine = lines == 1,
    )
}

@Composable
fun Avatar(model: CanopyModel, key: String, size: Int = 42) {
    val eventsUi by model.events.collectAsStateWithLifecycle()
    val profile = remember(eventsUi, key) { model.profile(key) }
    val picture = profile.optString("picture")
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(Color(0xff29382d)),
        contentAlignment = Alignment.Center,
    ) {
        Text(model.name(key).take(1).uppercase(), color = Accent)
        if (safeHttps(picture))
            AsyncImage(
                picture,
                "${model.name(key)} avatar",
                Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
    }
}

@Composable
fun CanopyApp(model: CanopyModel, links: MutableStateFlow<IncomingLink?>, consumeLink: () -> Unit) {
    val account by model.account.collectAsStateWithLifecycle()
    val events by model.events.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val signerBusy by model.signer.busy.collectAsStateWithLifecycle()
    val status by model.transport.status.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    val seen by model.seen.collectAsStateWithLifecycle()
    val zapOffer by model.zapOffer.collectAsStateWithLifecycle()
    val link by links.collectAsStateWithLifecycle()
    var pendingShare by rememberSaveable { mutableStateOf<String?>(null) }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "feed"
    var composeTargetJson by rememberSaveable { mutableStateOf<String?>(null) }
    val composeTarget =
        remember(composeTargetJson) {
            composeTargetJson?.let { runCatching { Event.parse(JSONObject(it)) }.getOrNull() }
        }
    var quote by rememberSaveable { mutableStateOf(false) }
    var composer by rememberSaveable { mutableStateOf(false) }
    var accountMenu by rememberSaveable { mutableStateOf(false) }
    var profileEdit by rememberSaveable { mutableStateOf(false) }
    var media by rememberSaveable { mutableStateOf<String?>(null) }
    var shareKey by rememberSaveable { mutableStateOf<String?>(null) }
    var zap by remember { mutableStateOf<Event?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    fun open(p: Pointer) {
        nav.navigate("${p.kind}/${p.key}")
        model.open(p)
    }
    LaunchedEffect(link) {
        link?.let { request ->
            val value = request.value
            if (request.shared) pendingShare = value.take(20000)
            else {
                val p = pointer(value)
                if (p != null) open(p)
                else model.message.value = "Canopy does not recognize this address."
            }
            consumeLink()
        }
    }
    LaunchedEffect(account, pendingShare) {
        val value = pendingShare
        if (account != null && value != null) {
            val previous = model.draft.value
            model.draft(previous + (if (previous.isBlank()) "" else "\n") + value)
            pendingShare = null
            composeTargetJson = null
            quote = false
            composer = true
        }
    }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            model.message.value = null
        }
    }
    Scaffold(
        containerColor = Background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CanopyMark(24)
                        Text("Canopy", fontFamily = Serif)
                    }
                },
                navigationIcon = {
                    if (
                        route.startsWith("profile/") ||
                            route.startsWith("event/") ||
                            route == "settings"
                    )
                        IconButton(onClick = { if (!nav.popBackStack()) nav.navigate("feed") }) {
                            Icon(Icons.Outlined.ArrowBack, "Back")
                        }
                },
                actions = {
                    Text(
                        if (status.values.any { it }) "Online" else "Offline",
                        color = Muted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    IconButton(onClick = { accountMenu = true }) {
                        Icon(Icons.Outlined.AccountCircle, "Account options")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
        bottomBar = {
            if (account != null)
                NavigationBar(containerColor = Background) {
                    listOf(
                            Triple("feed", "Home", Icons.Outlined.Home),
                            Triple("search", "Search", Icons.Outlined.Search),
                            Triple("saved", "Saved", Icons.Outlined.BookmarkBorder),
                            Triple("activity", "Activity", Icons.Outlined.Notifications),
                        )
                        .forEach { (path, label, icon) ->
                            NavigationBarItem(
                                selected = route == path,
                                onClick = {
                                    nav.navigate(path) {
                                        popUpTo("feed") { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                    if (path == "activity") model.markRead()
                                },
                                icon = {
                                    BadgedBox(
                                        badge = {
                                            val unread = events.count {
                                                notificationType(it, account!!) != null &&
                                                    it.createdAt > seen
                                            }
                                            if (path == "activity" && unread > 0)
                                                Badge { Text(unread.toString()) }
                                        }
                                    ) {
                                        Icon(icon, label)
                                    }
                                },
                                label = { Text(label) },
                            )
                        }
                }
        },
        floatingActionButton = {
            if (account != null && route != "settings")
                FloatingActionButton(
                    onClick = {
                        composeTargetJson = null
                        quote = false
                        composer = true
                    },
                    containerColor = Accent,
                ) {
                    Icon(Icons.Outlined.Edit, "Compose note")
                }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            if (busy || signerBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
            NavHost(nav, "feed", Modifier.weight(1f)) {
                composable("feed") {
                    if (account == null) Welcome(model, busy)
                    else
                        FeedPage(
                            model,
                            onProfile = { open(Pointer("profile", it)) },
                            onEvent = { open(Pointer("event", it)) },
                            onCompose = { e, q ->
                                composeTargetJson = e.json().toString()
                                quote = q
                                composer = true
                            },
                            onMedia = { media = it },
                            onZap = { zap = it },
                        )
                }
                composable("search") { SearchPage(model, ::open) }
                composable("saved") {
                    SavedPage(
                        model,
                        { open(Pointer("profile", it)) },
                        { open(Pointer("event", it)) },
                        { e, q ->
                            composeTargetJson = e.json().toString()
                            quote = q
                            composer = true
                        },
                        { media = it },
                        { zap = it },
                    )
                }
                composable("activity") { ActivityPage(model, ::open) }
                composable("settings") { SettingsPage(model) }
                composable("profile/{key}") { back ->
                    val key = back.arguments?.getString("key") ?: return@composable
                    ProfilePage(
                        model,
                        key,
                        { open(Pointer("profile", it)) },
                        { open(Pointer("event", it)) },
                        { e, q ->
                            composeTargetJson = e.json().toString()
                            quote = q
                            composer = true
                        },
                        { media = it },
                        { shareKey = key },
                        { profileEdit = true },
                        { zap = it },
                    )
                }
                composable("event/{key}") { back ->
                    val key = back.arguments?.getString("key") ?: return@composable
                    ThreadPage(
                        model,
                        key,
                        { open(Pointer("profile", it)) },
                        { open(Pointer("event", it)) },
                        { e, q ->
                            composeTargetJson = e.json().toString()
                            quote = q
                            composer = true
                        },
                        { media = it },
                        { zap = it },
                    )
                }
            }
        }
    }
    if (composer) ComposerDialog(model, composeTarget, quote) { composer = false }
    if (profileEdit && account != null) ProfileEditor(model, account!!) { profileEdit = false }
    if (media != null) MediaViewer(media!!) { media = null }
    if (shareKey != null) ShareProfile(model, shareKey!!) { shareKey = null }
    if (zap != null) ZapDialog(model, zap!!, onClose = { zap = null })
    if (zapOffer != null && zapOffer!!.account == account)
        ZapDialog(
            model,
            zapOffer!!.event,
            initial = zapOffer,
            onClose = { model.zapOffer.value = null },
        )
    if (accountMenu)
        AlertDialog(
            onDismissRequest = { accountMenu = false },
            title = { Text("Canopy account") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (account != null) {
                        Text(model.name(account!!))
                        Text(short(account!!), color = Muted)
                        TextButton(
                            onClick = {
                                accountMenu = false
                                open(Pointer("profile", account!!))
                            }
                        ) {
                            Text("My profile")
                        }
                        TextButton(
                            onClick = {
                                accountMenu = false
                                nav.navigate("settings")
                            }
                        ) {
                            Text("Settings and wallet")
                        }
                    }
                    model.storage
                        .accounts()
                        .filter { it != account }
                        .forEach { key ->
                            TextButton(
                                onClick = {
                                    model.switch(key)
                                    accountMenu = false
                                }
                            ) {
                                Text("Switch to ${model.name(key)}")
                            }
                        }
                    TextButton(
                        onClick = {
                            accountMenu = false
                            model.login()
                        },
                        enabled = !busy,
                    ) {
                        Text(
                            if (account == null) "Connect Amber" else "Choose another Amber account"
                        )
                    }
                    if (account != null)
                        TextButton(
                            onClick = {
                                model.logout()
                                accountMenu = false
                                nav.navigate("feed") { popUpTo("feed") { inclusive = true } }
                            }
                        ) {
                            Text("Log out")
                        }
                }
            },
            confirmButton = { TextButton(onClick = { accountMenu = false }) { Text("Close") } },
        )
}

@Composable
fun Welcome(model: CanopyModel, busy: Boolean) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        CanopyMark(50)
        Text("A CALMER NOSTR CLIENT", color = Accent, modifier = Modifier.padding(vertical = 24.dp))
        Text("Find your signal.", fontFamily = Serif, fontSize = 58.sp, lineHeight = 54.sp)
        Text(
            "A quick, image-first feed, built for Android.",
            color = Muted,
            modifier = Modifier.padding(vertical = 24.dp),
        )
        Card(colors = CardDefaults.cardColors(containerColor = Color(0xff18291e))) {
            Text(
                "◇ Your keys stay yours.\n\nCanopy asks Amber for a public key and signed events. It never asks for your identity private key.",
                Modifier.padding(20.dp),
            )
        }
        Button(
            onClick = model::login,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        ) {
            Text(if (busy) "Waiting for Amber…" else "Continue with Amber")
        }
        Text(
            "No account form. No password. No nsec.",
            color = Muted,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}
