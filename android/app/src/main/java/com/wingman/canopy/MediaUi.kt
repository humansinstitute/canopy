@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.wingman.canopy

import android.graphics.Bitmap
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.navigation.compose.*
import coil3.compose.AsyncImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter

@Composable
fun ShareProfile(model: CanopyModel, key: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val uri = "nostr:${npub(key)}"
    val bitmap =
        remember(key) {
            val matrix = MultiFormatWriter().encode(uri, BarcodeFormat.QR_CODE, 512, 512)
            Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888).apply {
                for (y in 0 until 512) for (x in 0 until 512) setPixel(
                    x,
                    y,
                    if (matrix[x, y]) android.graphics.Color.BLACK
                    else android.graphics.Color.WHITE,
                )
            }
        }
    FullDialog("Share ${model.name(key)}", onClose) {
        Image(
            bitmap.asImageBitmap(),
            "Profile QR code",
            Modifier.fillMaxWidth().aspectRatio(1f).background(Color.White).padding(16.dp),
        )
        Text(npub(key))
        Button(onClick = { share(context, profileUrl(key)) }) { Text("Share public profile link") }
        OutlinedButton(onClick = { copy(context, profileUrl(key)) }) { Text("Copy profile link") }
        OutlinedButton(onClick = { copy(context, uri) }) { Text("Copy Nostr reference") }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun MediaViewer(url: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val video =
        Regex("\\.(mp4|webm|mov|m3u8)(\\?.*)?$", RegexOption.IGNORE_CASE).containsMatchIn(url)
    var fullscreen by rememberSaveable { mutableStateOf(false) }
    val player =
        remember(url) {
            if (video && safeHttps(url))
                ExoPlayer.Builder(context)
                    .setMediaSourceFactory(
                        androidx.media3.exoplayer.source.DefaultMediaSourceFactory(
                            androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(
                                (context.applicationContext as CanopyApplication)
                                    .dependencies
                                    .http
                                    .newBuilder()
                                    .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                                    .build()
                            )
                        )
                    )
                    .build()
                    .apply {
                        setMediaItem(MediaItem.fromUri(url))
                        prepare()
                        playWhenReady = true
                    }
            else null
        }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var firstFrame by remember(url) { mutableStateOf(false) }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val observer =
            androidx.lifecycle.LifecycleEventObserver { _, event ->
                if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) player?.pause()
            }
        val listener =
            object : androidx.media3.common.Player.Listener {
                override fun onRenderedFirstFrame() {
                    firstFrame = true
                }

                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    playbackError = "Video could not be played. Check the source or connection."
                }
            }
        lifecycle.addObserver(observer)
        player?.addListener(listener)
        onDispose {
            lifecycle.removeObserver(observer)
            player?.removeListener(listener)
            player?.release()
        }
    }
    if (fullscreen && player != null)
        Dialog(
            onDismissRequest = { fullscreen = false },
            properties =
                DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                AndroidView(
                    factory = {
                        PlayerView(it).apply {
                            this.player = player
                            useController = true
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                    onRelease = { it.player = null },
                )
                IconButton(
                    onClick = { fullscreen = false },
                    modifier = Modifier.align(Alignment.TopEnd).systemBarsPadding(),
                ) {
                    Icon(Icons.Outlined.Close, "Exit fullscreen", tint = Color.White)
                }
            }
        }
    else
        FullDialog(if (video) "Video" else "Image viewer", onClose) {
            if (!safeHttps(url)) Text("Untrusted media URL was rejected.")
            else if (player != null) {
                AndroidView(
                    factory = {
                        PlayerView(it).apply {
                            this.player = player
                            useController = true
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(360.dp),
                    onRelease = { it.player = null },
                )
                if (!firstFrame && playbackError == null) Text("Loading video…", color = Muted)
                TextButton(onClick = { fullscreen = true }) { Text("Enter fullscreen") }
                playbackError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(
                        onClick = {
                            playbackError = null
                            player.prepare()
                            player.play()
                        }
                    ) {
                        Text("Retry video")
                    }
                }
            } else {
                var failed by remember(url) { mutableStateOf(false) }
                AsyncImage(
                    url,
                    "Full-size image",
                    Modifier.fillMaxWidth().heightIn(min = 240.dp, max = 900.dp),
                    contentScale = ContentScale.Fit,
                    onError = { failed = true },
                )
                if (failed)
                    Text(
                        "Image could not load. You can open the source below.",
                        color = MaterialTheme.colorScheme.error,
                    )
            }
            TextButton(onClick = { external(context, url) {} }) { Text("Open source in browser") }
        }
}
