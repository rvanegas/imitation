# Invite Flow Improvements

## Findings

1. **`WebSocketTransport.makeInviteLink` returns a bare PIN.** The app receives the PIN as plain text in a chat message — there's no tappable link, no share sheet, nothing ergonomic to hand to the other player.

2. **The app's join flow is fully manual.** The joiner opens `LoginScreen`, switches to "Join game," and types the PIN. The inviter has to communicate it out-of-band (verbally, copy-paste, etc.).

3. **`CombinedTransport.makeInviteLink` misbehaves for terminal clients when Telegram is running.** It produces a `https://t.me/...` URL which is useless to a socket client — they'd need to parse the token out of it manually.

## Plan

### 1. App deep link
Register a URL scheme (e.g. `imitation://join/1234`) in the Expo app. `WebSocketTransport.makeInviteLink` returns that URL. When the inviter's game chat shows the invite, the PIN is a tappable link that opens the app on the joiner's device and auto-populates the session token.

### 2. Share sheet
When the app generates an invite, surface a native share button alongside the PIN so the inviter can send it via iMessage, AirDrop, etc.

### 3. Fix terminal invite link
`CombinedTransport.makeInviteLink` should return the raw PIN regardless of whether Telegram is running. Telegram users get the bot URL via the bot's own `makeInviteLink`; terminal/socket users should always get just the PIN.
