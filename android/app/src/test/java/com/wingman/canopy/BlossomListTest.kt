package com.wingman.canopy

import org.junit.Assert.*
import org.junit.Test

class BlossomListTest {
    private val key = "a".repeat(64)
    private fun base() = Event.template(key, 10063, "unused", listOf(listOf("server", "https://one.example/path/", "extension"), listOf("custom", "keep"), listOf("server", "https://two.example")), now() - 10)

    @Test fun orderedReplacementPreservesUnknownAndServerFields() {
        val previous = base()
        val next = blossomListTemplate(previous, key, listOf("https://two.example", "https://one.example/path"))
        assertEquals(10063, next.kind)
        assertEquals("", next.content)
        assertEquals(listOf(listOf("server", "https://two.example"), listOf("server", "https://one.example/path", "extension"), listOf("custom", "keep")), next.tags)
        assertTrue(next.createdAt > previous.createdAt)
        assertEquals("https://example.com/a", normalizeProfileServer("https://EXAMPLE.com:443/a/"))
    }

    @Test fun refusesUnsafeDuplicateEmptyForeignAndFutureLists() {
        listOf("http://a.example", "https://user:secret@a.example", "https://a.example?token=secret", "https://a.example#x", "bad").forEach { url ->
            assertThrows(IllegalArgumentException::class.java) { validateProfileServers(listOf(url)) }
        }
        assertThrows(IllegalArgumentException::class.java) { validateProfileServers(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { validateProfileServers(listOf("https://a.example", "https://A.example/")) }
        assertThrows(IllegalArgumentException::class.java) { blossomListTemplate(base(), "b".repeat(64), listOf("https://a.example")) }
        assertThrows(IllegalArgumentException::class.java) { blossomListTemplate(base().copy(createdAt = now() + 600), key, listOf("https://a.example")) }
    }

    @Test fun newestListUsesTieBreakAndAccountIsolation() {
        val a = base().copy(id = "1".repeat(64))
        val b = a.copy(id = "2".repeat(64))
        assertEquals(a, latest(listOf(b, a.copy(pubkey = "b".repeat(64), createdAt = now() + 1), a), 10063, key))
        assertEquals(listOf("https://one.example/path", "https://two.example"), NetworkSettings.profile(listOf(a), key).blossom)
    }
}
