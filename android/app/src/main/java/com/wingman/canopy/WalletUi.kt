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
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*

@Composable
fun ZapDialog(model: CanopyModel, event: Event, initial: ZapOffer? = null, onClose: () -> Unit) {
    val accountUi by model.account.collectAsStateWithLifecycle()
    val account = accountUi ?: return
    var amount by rememberSaveable {
        mutableStateOf(initial?.sats?.toString() ?: model.storage.get(account, "zapAmount", "21"))
    }
    var comment by rememberSaveable {
        mutableStateOf(initial?.comment ?: model.storage.get(account, "zapMessage"))
    }
    var invoice by rememberSaveable { mutableStateOf(initial?.invoice) }
    var invoiceAmount by rememberSaveable { mutableStateOf(initial?.sats?.toString() ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    val message by model.message.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val context = LocalContext.current
    FullDialog("Zap ${model.name(event.pubkey)}", onClose) {
        Field(
            "Amount (sats)",
            amount,
            {
                amount = it
                invoice = null
            },
        )
        Field(
            "Message",
            comment,
            {
                comment = it.take(280)
                invoice = null
            },
        )
        Text(
            "A connected NWC wallet pays this amount after Amber approves. Otherwise, open the returned invoice in your external wallet.",
            color = Muted,
        )
        Button(
            onClick = {
                val sats = amount.toLongOrNull()
                if (sats == null || sats !in 1..1000000) error = "Choose 1 to 1,000,000 sats."
                else
                    model.zap(
                        event,
                        sats,
                        comment,
                        onInvoice = { offer ->
                            invoice = offer.invoice
                            invoiceAmount = offer.sats.toString()
                        },
                        onPaid = onClose,
                    )
            },
            enabled = !busy,
        ) {
            Text(if (busy) "Sending…" else "Send zap")
        }
        invoice?.let { bill ->
            Text("Invoice: $invoiceAmount sats", color = Accent)
            OutlinedButton(onClick = { external(context, "lightning:$bill") { error = it } }) {
                Text("Open in external wallet")
            }
            TextButton(onClick = { copy(context, bill) }) { Text("Copy invoice") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        message?.let { Text(it, color = Muted) }
    }
}
