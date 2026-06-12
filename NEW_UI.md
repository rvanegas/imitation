# iOS UI Redesign Brief

## The Game

Two players play the Imitation Game (Turing Test). One is the **judge**, one is the **witness**. An AI also generates a fake response impersonating the witness.

**Each round has four phases:**
1. **Judge asks** — judge types a question/message
2. **Witness responds** — witness types their reply; AI simultaneously generates a blind prediction
3. **Judge chooses** — judge sees two anonymous responses (A and B, one human, one AI) and calls which is human: `/human A` or `/human B`
4. **Reveal** — correct/wrong verdict shown, score updated, roles swap

**Scoring:** `teamScores: { humans, model }` — both players are on the human team against the model. Win streaks tracked. A leaderboard (per pair, persistent across sessions) is shown on session start.

**Commands in-game:** `/human A|B`, `/a`, `/b`, `/status`, `/invite`, `/leave`, `/restart`, `/setname`, `/help`, `/leaderboard`

---

## Current App Structure

```
app/
  App.tsx                        # Root: handles auth state, WebSocket lifecycle
  src/
    ws.ts                        # WebSocket client; ServerMessage types
    store.ts                     # SecureStore token persistence
    screens/
      LoginScreen.tsx            # Two tabs: join by session token, or link Telegram account
      GameScreen.tsx             # The main game screen (currently a flat chat list)
```

**Tech:** Expo ~54, React Native 0.81.5, React 19, TypeScript strict, `newArchEnabled: true`. No UI library — plain `StyleSheet`. This is intentional: NativeWind was tried and caused layout failures with complex RN components (FlatList, KeyboardAvoidingView). Stick with StyleSheet.

**WebSocket message types** (from `src/ws.ts`):
```ts
type ServerMessage =
  | { type: 'ready';      name: string; token?: string }
  | { type: 'msg';        text: string }
  | { type: 'nameUpdate'; name: string }
  | { type: 'error';      text: string }
```

All game content arrives as `{ type: 'msg', text: string }` — plain text, no structured game-state messages. The app can parse text heuristically, or we can add structure to the server protocol.

---

## Current GameScreen (what to replace)

- Flat `FlatList` of chat bubbles (iMessage-style: gray incoming left, blue outgoing right)
- Small header row: "Playing as {name}" + "Sign out"
- TextInput + "Send" Button at bottom
- No role awareness, no phase awareness, no game context visible

**Known working pattern for FlatList scroll:**
```tsx
<FlatList
  ref={listRef}
  onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
  onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
  style={{ flex: 1 }}   // must be style={}, not className
  ...
/>
```
Use `style={}` (not `className`) for layout-critical props on FlatList, KeyboardAvoidingView, SafeAreaView.

---

## Design Direction

The user wants to move away from the Telegram/iMessage chat metaphor toward something better suited to the Turing Test. Key ideas discussed:

- **Role-aware UI**: the screen should change based on whether you're the judge or witness, and what phase the round is in
- **Phase-based layout**: judge asking (compose), judge choosing A/B (decision cards), witness waiting (anticipation state), reveal (visual moment)
- **The A/B choice as a deliberate act**: not just two lines of text, but two cards to compare and commit to
- **The reveal as a moment**: not another chat line, but a visual event — flip, score animation, etc.
- **Identity and uncertainty as motifs**: the whole game is about not knowing who you're talking to

The user did not specify a visual style preference (dark/light, minimal/dramatic, etc.) — that's open.

---

## What the Server Sends (examples of actual text)

System/status messages the app currently receives as plain `msg` text:
- `"Game started! You are the judge — take the first turn."`
- `"Game started! Your partner is the judge. Wait for their first turn."`
- `"A: [text]\nB: [text]"` — the A/B choice presented to the judge
- `"You: [text]\nModel: [text]"` — sender sees their message + AI's prediction
- `"Correct! Humans point — A was the human, B was the model. Humans: 3 (50%) | Model: 3 (50%) | Streak: 0"`
- Leaderboard text block on session start
- Help text on join

**Option:** Add a `kind: 'chat' | 'system'` field to the server's WebSocket output (server changes are minor — `Transport.send()` and `websocket.ts`) to let the app distinguish game-content messages from status messages. This was designed but reverted with the NativeWind rollback.

---

## Implementation Notes

- The server is at `src/server.ts`, `src/websocket.ts`, `src/transport.ts`, `src/delivery.ts`
- Adding protocol fields requires updating `Transport` interface, `WebSocketTransport.send()`, and tagging call sites in `delivery.ts`
- The app's `ChatMessage` type is in `GameScreen.tsx`; `ServerMessage` is in `ws.ts`
- `App.tsx` manages auth state and passes messages down to `GameScreen`
- Deep link: `imitation://join/{token}` opens directly into a game
