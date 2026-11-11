package com.wingman.canopy

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

data class IncomingLink(val value: String, val shared: Boolean = false)

private fun incoming(intent: Intent?): IncomingLink? =
    if (intent?.action == Intent.ACTION_SEND)
        intent.getStringExtra(Intent.EXTRA_TEXT)?.let { IncomingLink(it, true) }
    else intent?.dataString?.let { IncomingLink(it) }

class MainActivity : ComponentActivity() {
    val model: CanopyModel by viewModels()
    private val links = MutableStateFlow<IncomingLink?>(null)
    private val amber =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            model.signer.result(it)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle =
                androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle =
                androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        model.signer.launch = { amber.launch(it) }
        if (savedInstanceState == null) links.value = incoming(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                model.foreground(true)
                try {
                    awaitCancellation()
                } finally {
                    model.foreground(false)
                }
            }
        }
        setContent { CanopyTheme { CanopyApp(model, links) { links.value = null } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        links.value = incoming(intent)
    }

    override fun onDestroy() {
        model.signer.launch = null
        super.onDestroy()
    }
}
