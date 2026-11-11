package com.wingman.canopy

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Only verified public events enter this database; secrets never enter the search index. */
class EventCache(context: Context) : SQLiteOpenHelper(context, "public-events.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE events(id TEXT PRIMARY KEY, author TEXT NOT NULL, kind INTEGER NOT NULL, time INTEGER NOT NULL, content TEXT NOT NULL, json TEXT NOT NULL)"
        )
        db.execSQL("CREATE INDEX event_time ON events(time DESC)")
        db.execSQL("CREATE INDEX event_author_kind ON events(author,kind,time DESC)")
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit

    suspend fun load(): List<Event> =
        withContext(Dispatchers.IO) {
            readableDatabase
                .rawQuery("SELECT json FROM events ORDER BY time DESC LIMIT 24000", null)
                .use { c ->
                    buildList {
                        while (c.moveToNext()) runCatching {
                                Event.parse(JSONObject(c.getString(0)))
                            }
                            .getOrNull()
                            ?.let(::add)
                    }
                }
        }

    suspend fun put(events: List<Event>) =
        withContext(Dispatchers.IO) {
            val db = writableDatabase
            db.beginTransaction()
            try {
                db.compileStatement("INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)").use { s ->
                    events.forEach { e ->
                        s.clearBindings()
                        s.bindString(1, e.id)
                        s.bindString(2, e.pubkey)
                        s.bindLong(3, e.kind.toLong())
                        s.bindLong(4, e.createdAt)
                        s.bindString(5, e.content)
                        s.bindString(6, e.json().toString())
                        s.executeInsert()
                    }
                }
                db.execSQL(
                    "DELETE FROM events WHERE kind=1 AND id NOT IN (SELECT id FROM events WHERE kind=1 ORDER BY time DESC LIMIT 21256)"
                )
                db.execSQL(
                    "DELETE FROM events WHERE kind<>1 AND id NOT IN (SELECT id FROM events WHERE kind<>1 ORDER BY time DESC LIMIT 2744)"
                )
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        }

    suspend fun clear() =
        withContext(Dispatchers.IO) { writableDatabase.delete("events", null, null) }

    fun bytes(): Long = readableDatabase.path.let { java.io.File(it).length() }
}

/** Android Keystore AES-GCM protects local NWC credentials. Android backup is disabled. */
class AccountStorage(context: Context) {
    private val prefs = context.getSharedPreferences("native-accounts", Context.MODE_PRIVATE)
    private val key: SecretKey by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("canopy-settings", null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply {
                    init(
                        KeyGenParameterSpec.Builder(
                                "canopy-settings",
                                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                            )
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .build()
                    )
                }
                .generateKey()
    }

    fun get(account: String, name: String, fallback: String = "") =
        prefs.getString("$account.$name", fallback) ?: fallback

    fun put(account: String, name: String, value: String) {
        check(prefs.edit().putString("$account.$name", value).commit()) {
            "Local storage could not be saved."
        }
    }

    fun secret(account: String): String {
        val data = get(account, "wallet")
        if (data.isBlank()) return ""
        val bytes = Base64.decode(data, Base64.NO_WRAP)
        require(bytes.size > 28)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        c.updateAAD(account.toByteArray())
        return c.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
    }

    fun secret(account: String, value: String) {
        if (value.isBlank()) {
            put(account, "wallet", "")
            return
        }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key)
        c.updateAAD(account.toByteArray())
        put(
            account,
            "wallet",
            Base64.encodeToString(c.iv + c.doFinal(value.toByteArray()), Base64.NO_WRAP),
        )
    }

    fun accounts(): List<String> = runCatching {
        JSONArray(get("device", "accounts", "[]")).strings().filter { hexKey.matches(it) }
    }
        .getOrDefault(emptyList())

    fun remember(account: String) {
        put("device", "accounts", jsonArray((accounts() + account).distinct()).toString())
        put("device", "current", account)
    }
}

val DEFAULT_RELAYS = listOf("wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net")

data class NetworkSettings(
    val read: List<String> = DEFAULT_RELAYS,
    val write: List<String> = DEFAULT_RELAYS,
    val blossom: List<String> = emptyList(),
) {
    fun json() =
        JSONObject()
            .put("read", jsonArray(read))
            .put("write", jsonArray(write))
            .put("blossom", jsonArray(blossom))
            .toString()

    companion object {
        fun parse(read: String, write: String, blossom: String): NetworkSettings {
            fun lines(value: String) =
                value.trim().split(Regex("\\s+")).filter { it.isNotBlank() }.distinct()
            val r = lines(read)
            val w = lines(write)
            val b = lines(blossom)
            require(r.isNotEmpty() && w.isNotEmpty() && (r + w).all(::safeRelay)) {
                "Add valid secure wss:// read and write relays."
            }
            require(b.all(::safeHttps)) {
                "Blossom servers require HTTPS URLs without credentials."
            }
            require(r.size <= 12 && w.size <= 12 && b.size <= 8) {
                "Use at most 12 relays and 8 upload servers."
            }
            return NetworkSettings(
                r,
                w,
                b.map { value ->
                        val uri = java.net.URI(value)
                        "${uri.scheme}://${uri.rawAuthority}"
                    }
                    .distinct(),
            )
        }

        fun fromJson(text: String): NetworkSettings? = runCatching {
            val j = JSONObject(text)
            parse(
                j.getJSONArray("read").strings().joinToString("\n"),
                j.getJSONArray("write").strings().joinToString("\n"),
                j.getJSONArray("blossom").strings().joinToString("\n"),
            )
        }
            .getOrNull()

        fun profile(events: List<Event>, account: String): NetworkSettings {
            val r =
                latest(events, 10002, account)?.tags?.filter {
                    it.firstOrNull() == "r" && safeRelay(it.getOrNull(1) ?: "")
                } ?: emptyList()
            val read =
                r.filter { it.getOrNull(2) != "write" }
                    .map { it[1] }
                    .distinct()
                    .ifEmpty { DEFAULT_RELAYS }
            val write =
                r.filter { it.getOrNull(2) != "read" }
                    .map { it[1] }
                    .distinct()
                    .ifEmpty { DEFAULT_RELAYS }
            val b =
                latest(events, 10063, account)?.values("server")?.filter(::safeHttps)?.distinct()
                    ?: emptyList()
            return NetworkSettings(read.take(12), write.take(12), b.take(8))
        }
    }
}
