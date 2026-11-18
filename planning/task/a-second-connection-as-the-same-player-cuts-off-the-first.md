# A second connection as the same player cuts off the first

Noted 2026-11-10, when `imitation terminal` began signing in over the public
WebSocket, the same way the app does.

`WebSocketTransport` (`src/websocket.ts`) keeps one socket per player, so the
app and a terminal signed in as the same person do not both receive messages:
the later `register` wins, and the earlier socket stays open but hears
nothing, with nothing said to it.

Decide whether a player may hold several connections (send to all of them)
or the newer one ends the older (close it, with a frame saying why).

The worse half was fixed on 2026-11-18: the older socket's close used to
unregister the newer one, leaving the player receiving nothing anywhere.
