package com.wingman.canopy

/** Independent nostr-tools 2.25.2 getEventHash vectors, executed on JVM and Android. */
object CanonicalFixtures {
    fun verify() {
        val text =
            java.util.Base64.getDecoder()
                .decode(
                    "W3sicHVia2V5IjoiNzliZTY2N2VmOWRjYmJhYzU1YTA2Mjk1Y2U4NzBiMDcwMjliZmNkYjJkY2UyOGQ5NTlmMjgxNWIxNmY4MTc5OCIsImNyZWF0ZWRfYXQiOjE3MDAwMDAwMDAsImtpbmQiOjEsInRhZ3MiOltbInAiLCI3OWJlNjY3ZWY5ZGNiYmFjNTVhMDYyOTVjZTg3MGIwNzAyOWJmY2RiMmRjZTI4ZDk1OWYyODE1YjE2ZjgxNzk4Il0sWyJ4IiwiYS9iXFxjIiwiZW1vamkg8J+MsSJdXSwiY29udGVudCI6IuOBk+OCk+OBq+OBoeOBryDOms6xzrvOt868zq3Pgc6xINmF2LHYrdio2Kcg8J+MsfCfp6EiLCJpZCI6IjY4YjNiNzExZjdiZWNkOThiYWU1MzMzM2ZkOWJkMmFiZDNiM2I4YjRkMWJiMTc0NmZhZWUyOTNhNzhiN2MwY2MiLCJzaWciOiIifSx7InB1YmtleSI6Ijc5YmU2NjdlZjlkY2JiYWM1NWEwNjI5NWNlODcwYjA3MDI5YmZjZGIyZGNlMjhkOTU5ZjI4MTViMTZmODE3OTgiLCJjcmVhdGVkX2F0IjoxNzAwMDAwMDAxLCJraW5kIjoxLCJ0YWdzIjpbWyJwIiwiNzliZTY2N2VmOWRjYmJhYzU1YTA2Mjk1Y2U4NzBiMDcwMjliZmNkYjJkY2UyOGQ5NTlmMjgxNWIxNmY4MTc5OCJdLFsieCIsImEvYlxcYyIsImVtb2ppIPCfjLEiXV0sImNvbnRlbnQiOiJsaW5lIG9uZVxubGluZSB0d29cclxuXHR0YWIiLCJpZCI6IjI5YmE4M2Q4MjY3NzRhYzExNjdhMWI4YmUyNWVlNzdmNDE4ZGZkNWM4YWVhMWYwZTU0OTQ3ZmRiZmY2YjNhODIiLCJzaWciOiIifSx7InB1YmtleSI6Ijc5YmU2NjdlZjlkY2JiYWM1NWEwNjI5NWNlODcwYjA3MDI5YmZjZGIyZGNlMjhkOTU5ZjI4MTViMTZmODE3OTgiLCJjcmVhdGVkX2F0IjoxNzAwMDAwMDAyLCJraW5kIjoxLCJ0YWdzIjpbWyJwIiwiNzliZTY2N2VmOWRjYmJhYzU1YTA2Mjk1Y2U4NzBiMDcwMjliZmNkYjJkY2UyOGQ5NTlmMjgxNWIxNmY4MTc5OCJdLFsieCIsImEvYlxcYyIsImVtb2ppIPCfjLEiXV0sImNvbnRlbnQiOiJRdW90ZXM6IFwidGVzdFwiOyBiYWNrc2xhc2ggXFw7IHNsYXNoIC87IGNsb3NlIDwvc2NyaXB0PjsgbGl0ZXJhbCBcXC8iLCJpZCI6ImJiY2FlMDE5ODYyZDZiYjM4YmIwZDIyNmY3ODE2YTUyNjk3MjgyYjAxYWEwZGEwOGE4MGEwNDBkZTRhZGVjYzUiLCJzaWciOiIifSx7InB1YmtleSI6Ijc5YmU2NjdlZjlkY2JiYWM1NWEwNjI5NWNlODcwYjA3MDI5YmZjZGIyZGNlMjhkOTU5ZjI4MTViMTZmODE3OTgiLCJjcmVhdGVkX2F0IjoxNzAwMDAwMDAzLCJraW5kIjoxLCJ0YWdzIjpbWyJwIiwiNzliZTY2N2VmOWRjYmJhYzU1YTA2Mjk1Y2U4NzBiMDcwMjliZmNkYjJkY2UyOGQ5NTlmMjgxNWIxNmY4MTc5OCJdLFsieCIsImEvYlxcYyIsImVtb2ppIPCfjLEiXV0sImNvbnRlbnQiOiJzZXBhcmF0b3Jz4oCocGFyYWdyYXBo4oCpZW5kIiwiaWQiOiJhMjAxYjE0YWJhNDY3M2FhMjYwMmIxYzAxYzhhNjAyNDI1MGEwMjYyNjNlZGI2MTNlMDcyNGVhYWVkY2U0NDQxIiwic2lnIjoiIn0seyJwdWJrZXkiOiI3OWJlNjY3ZWY5ZGNiYmFjNTVhMDYyOTVjZTg3MGIwNzAyOWJmY2RiMmRjZTI4ZDk1OWYyODE1YjE2ZjgxNzk4IiwiY3JlYXRlZF9hdCI6MTcwMDAwMDAwNCwia2luZCI6MSwidGFncyI6W1sicCIsIjc5YmU2NjdlZjlkY2JiYWM1NWEwNjI5NWNlODcwYjA3MDI5YmZjZGIyZGNlMjhkOTU5ZjI4MTViMTZmODE3OTgiXSxbIngiLCJhL2JcXGMiLCJlbW9qaSDwn4yxIl1dLCJjb250ZW50IjoiY29udHJvbHMgXHUwMDAwIFxiIFxmIGVtb2ppIPCfmIAgYW5kIGNhZsOpIGXMgSIsImlkIjoiNGY1N2RmMWU0ZTIyNGIyZGZlZGEzNjllNjdlZmFkNWE1MTZmMmFiZTA0MDdiNzU0Y2NkZmE5Y2VjNTA4NTI2OSIsInNpZyI6IiJ9XQ=="
                )
                .toString(Charsets.UTF_8)
        val array = org.json.JSONArray(text)
        for (i in 0 until array.length()) {
            val event = Event.parse(array.getJSONObject(i))
            check(
                runCatching {
                        Event.parse(event.json().put("created_at", event.createdAt.toString()))
                    }
                    .isFailure
            ) {
                "Android must not coerce a signed timestamp from text"
            }
            check(event.id == event.hash()) {
                "Canonical Unicode vector $i disagrees with nostr-tools"
            }
        }
    }
}
