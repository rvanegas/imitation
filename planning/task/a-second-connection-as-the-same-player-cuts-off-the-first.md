# A second connection as the same player cuts off the first

Noted 2026-11-10, when `imitation terminal` began signing in over the public
WebSocket, the same way the app does.

`WebSocketTransport` (`src/websocket.ts`) keeps one socket per player, so the
app and a terminal signed in as the same person do not both receive messages:
the later `register` wins, and the earlier socket stays open but hears
nothing. Worse, when that earlier socket closes, its `close` handler calls
`unregister(userId)`, which removes the *newer* socket, and the player stops
receiving anything until they reconnect.

The least that is owed: `unregister` removes the entry only if it is still
the socket that is closing. Beyond that, decide whether a player may hold
several connections (send to all of them) or the newer one ends the older
(close it, with a frame saying why).
