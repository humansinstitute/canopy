package com.wingman.canopy

import android.app.Application
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/**
 * Process-local dependency container. No intent, network or persisted configuration can replace it.
 */
data class NativeDependencies(
    val http: OkHttpClient =
        OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .callTimeout(25, TimeUnit.SECONDS)
            .build()
)

class CanopyApplication : Application(), coil3.SingletonImageLoader.Factory {
    var dependencies = NativeDependencies()

    override fun newImageLoader(context: android.content.Context) =
        coil3.ImageLoader.Builder(context)
            .components {
                add(coil3.gif.AnimatedImageDecoder.Factory())
                add(coil3.svg.SvgDecoder.Factory())
                add(
                    coil3.network.okhttp.OkHttpNetworkFetcherFactory(
                        callFactory = { dependencies.http }
                    )
                )
            }
            .build()
}
