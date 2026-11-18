# Invite links in the terminal are app links

Noted 2026-11-10. `CombinedTransport.makeInviteLink` (`src/server.ts`) gives
a player connected over the WebSocket the app's `imitation://join/<token>`
link. Since `imitation terminal` connects that way, a terminal player's
`/invite` now prints an app link, which somebody on Telegram cannot open.
The terminal should show what anyone can use, the Telegram link or the bare
token, and leave the `imitation://` link to the app's invite event.
