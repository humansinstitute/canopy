package com.wingman.canopy

import fr.acinq.secp256k1.Secp256k1
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test
    fun signedFieldsAreNeverCoercedFromOtherJsonTypes() {
        val event = Event.template(key, 1, "strict event")
        for (value in listOf<Any>("1700000000", 1700000000.5)) assertThrows(
            IllegalArgumentException::class.java
        ) {
            Event.parse(event.json().put("created_at", value))
        }
        assertThrows(IllegalArgumentException::class.java) {
            Event.parse(event.json().put("kind", 1.0))
        }
        assertThrows(IllegalStateException::class.java) {
            Event.parse(
                event
                    .json()
                    .put("tags", org.json.JSONArray().put(org.json.JSONArray().put("p").put(123)))
            )
        }
    }

    @Test
    fun canonicalUnicodeMatchesNostrTools() {
        CanonicalFixtures.verify()
    }

    private val secret = "0".repeat(63) + "1"
    private val key = Secp256k1.pubkeyCreate(secret.bytes()).copyOfRange(1, 33).hex()

    private fun signed(e: Event) =
        e.copy(sig = Secp256k1.signSchnorr(e.id.bytes(), secret.bytes(), ByteArray(32)).hex())

    @Test
    fun signatureIntegrityIncludesExactImmutableRequest() {
        val e =
            Event.template(
                key,
                1,
                "Hello 🌱\nhttps://example.org/a",
                listOf(listOf("p", key)),
                1700000000,
            )
        val good = signed(e)
        assertTrue(good.valid())
        assertEquals(good, verifySigned(e, good))
        val altered = signed(Event.template(key, 1, "different", e.tags, e.createdAt))
        assertTrue(altered.valid())
        assertThrows(IllegalArgumentException::class.java) { verifySigned(e, altered) }
        assertFalse(good.copy(content = "tampered").valid())
        assertFalse(good.copy(sig = "0".repeat(128)).valid())
    }

    @Test
    fun bookmarkAndFollowPreserveUnknownPrivateContent() {
        val note = "b".repeat(64)
        val foreign = listOf(listOf("a", "30023:$key:article"), listOf("x", "extension"))
        val old = Event.template(key, 10003, "encrypted private list", foreign, now() + 10)
        val added = bookmarkTemplate(old, key, note)
        assertEquals(old.content, added.content)
        assertTrue(added.tags.containsAll(foreign))
        assertTrue(added.createdAt > old.createdAt)
        assertEquals(foreign, bookmarkTemplate(added, key, note).tags)
        val contact =
            Event.template(
                key,
                3,
                "legacy relay data",
                listOf(listOf("p", note, "wss://hint", "petname"), listOf("x", "extension")),
            )
        assertEquals(listOf(listOf("x", "extension")), followTemplate(contact, key, note).tags)
        assertEquals(contact.content, followTemplate(contact, key, note).content)
    }

    @Test
    fun threadContextAndCycleDoNotHideDisconnectedNotes() {
        val root = Event.template(key, 1, "root")
        val parent = Event.template(key, 1, "parent", listOf(listOf("e", root.id, "", "root")))
        val child = Event.template(key, 1, "child", replyTags(parent))
        assertEquals(root.id, child.root())
        assertEquals(parent.id, child.parent())
        val rows = threadRows(listOf(child, parent, root), root.id, child.id)
        assertEquals(listOf(root.id, parent.id, child.id), rows.map { it.first.id })
        assertEquals(listOf(0, 1, 2), rows.map { it.second })
        val orphan =
            Event.template(
                key,
                1,
                "orphan",
                listOf(listOf("e", root.id, "", "root"), listOf("e", "f".repeat(64), "", "reply")),
            )
        assertTrue(threadRows(listOf(root, orphan), root.id, orphan.id).any { it.first == orphan })
    }

    @Test
    fun notificationAndDiscoveryAreSourceBound() {
        val other = "b".repeat(64)
        val target = "c".repeat(64)
        val eyes = Event.template(other, 7, "👀", listOf(listOf("e", target), listOf("p", key)))
        val like = eyes.copy(content = "+")
        assertEquals("Reaction", notificationType(eyes, key))
        assertNull(notificationType(eyes, other))
        assertEquals(setOf(target), lookmarkTargets(listOf(eyes, like), setOf(other)).keys)
        assertTrue(lookmarkTargets(listOf(eyes), emptySet()).isEmpty())
    }

    @Test
    fun nip19RoundTripAndUnsafeLinks() {
        val e = Event.template(key, 1, "hello")
        assertEquals(Pointer("profile", key), pointer(npub(key)))
        assertEquals(e.id, pointer(eventUrl(e))?.key)
        assertNull(pointer("nsec1" + "a".repeat(60)))
        assertNull(pointer("https://evil.example/profile/${npub(key)}"))
        assertFalse(safeHttps("javascript:alert(1)"))
        assertFalse(safeRelay("ws://localhost"))
        assertFalse(safeHttps("https://user:pass@example.org"))
    }

    @Test
    fun relayFiltersRejectOffSubscriptionData() {
        val e = Event.template(key, 1, "hello", listOf(listOf("p", "b".repeat(64))))
        assertTrue(
            RelayTransport.matches(
                e,
                filter(listOf(1), listOf(key), tag = "p" to listOf("b".repeat(64))),
            )
        )
        assertFalse(RelayTransport.matches(e, filter(listOf(0), listOf(key))))
        assertFalse(RelayTransport.matches(e, filter(listOf(1), listOf("a".repeat(64)))))
    }

    @Test
    fun settingsDoNotAcceptPartialInvalidInput() {
        assertThrows(IllegalArgumentException::class.java) {
            NetworkSettings.parse("wss://good\nhttps://bad", "wss://good", "")
        }
        val s =
            NetworkSettings.parse(
                "wss://relay.example\nwss://relay.example",
                "wss://writer.example",
                "https://blossom.example",
            )
        assertEquals(1, s.read.size)
        assertEquals(s, NetworkSettings.fromJson(s.json()))
    }
}
