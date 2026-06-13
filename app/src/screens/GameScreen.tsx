import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  StyleSheet, KeyboardAvoidingView, Platform, Share, ActionSheetIOS, Alert,
} from 'react-native';
import { GameState, displayRound } from '../gameState';
import { Label } from '../ws';

interface Props {
  state: GameState;
  name: string;
  onSend: (text: string) => void;
  onCall: (label: Label) => void;
  onContinue: () => void;
  onNewGame: () => void;
  onJoin: (token: string) => void;
  onRestart: (player1: string, player2: string) => void;
  onInvite: () => void;
  onLeaderboard: () => void;
  onLeave: () => void;
  onSetName: (name: string) => void;
  onSignOut: () => void;
}

const C = {
  bg: '#f2f2f7',
  card: '#ffffff',
  border: '#e3e3e8',
  text: '#000000',
  muted: '#8e8e93',
  primary: '#007aff',
  good: '#34c759',
  bad: '#ff3b30',
  cardA: '#eef4ff',
  cardB: '#fff4ec',
};

// What the player should be doing right now, in one line.
function phaseHint(state: GameState): string {
  switch (state.phase) {
    case 'judge-ask':      return 'Ask the witness anything.';
    case 'judge-wait':     return 'Waiting for a reply…';
    case 'judge-decide':   return 'Tap the human — or keep probing.';
    case 'witness-answer': return 'Reply as yourself. The AI is impersonating you.';
    case 'witness-wait':   return lastAnswered(state) ? 'The judge is deciding…' : 'Waiting for the judge…';
    default:               return '';
  }
}

function lastAnswered(state: GameState): boolean {
  const last = state.exchanges[state.exchanges.length - 1];
  return !!last && last.a !== undefined;
}

// Body message for phases with no exchanges yet (start of a round).
function waitingMessage(state: GameState): string {
  const p = state.partner || 'your partner';
  switch (state.phase) {
    case 'judge-ask':    return `Your turn — ask ${p} a question to begin the round.`;
    case 'judge-wait':   return `Waiting for ${p} to reply…`;
    case 'witness-wait': return `Waiting for ${p} to ask the first question…`;
    case 'witness-answer': return `${p} asked a question — your reply is below.`;
    default:             return 'Waiting…';
  }
}

// Accept either a full deep link (imitation://join/123) or a bare numeric code.
function parseToken(raw: string): string | null {
  const text = raw.trim();
  const link = text.match(/imitation:\/\/join\/(\d+)/);
  if (link) return link[1];
  const digits = text.match(/^\d+$/);
  return digits ? digits[0] : null;
}

export default function GameScreen(props: Props) {
  const { state } = props;
  const [input, setInput] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const awaitingShare = useRef(false);
  const prevInvite = useRef<string | null>(null);
  const wantedLeaderboard = useRef(false);

  // Open the share sheet once a fresh invite link arrives, but only when the
  // user actually asked to invite (avoids popping on cold-start state).
  useEffect(() => {
    if (state.inviteLink && state.inviteLink !== prevInvite.current && awaitingShare.current) {
      awaitingShare.current = false;
      shareLink(state.inviteLink);
    }
    prevInvite.current = state.inviteLink;
  }, [state.inviteLink]);

  // Show the leaderboard modal once data arrives after an explicit request.
  useEffect(() => {
    if (state.leaderboard && wantedLeaderboard.current) {
      wantedLeaderboard.current = false;
      setShowLeaderboard(true);
    }
  }, [state.leaderboard]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [state.exchanges]);

  function shareLink(link: string) {
    Share.share(Platform.OS === 'ios' ? { url: link } : { message: link });
  }

  function submit() {
    const text = input.trim();
    if (!text) return;
    props.onSend(text);
    setInput('');
  }

  function openMenu() {
    const labels = [
      ...(state.status === 'playing'
        ? ['Invite a player', 'New players…', 'Leaderboard', 'Set name…', 'Leave game']
        : ['New game', 'Join a game', 'Leaderboard', 'Set name…']),
      'Sign out',
      'Cancel',
    ];
    const cancelButtonIndex = labels.length - 1;
    const destructiveButtonIndex = state.status === 'playing' ? labels.indexOf('Leave game') : -1;
    const handle = (i: number) => {
      const choice = labels[i];
      if (choice === 'Invite a player') { awaitingShare.current = true; props.onInvite(); }
      else if (choice === 'New players…') setShowRestart(true);
      else if (choice === 'Leaderboard') { wantedLeaderboard.current = true; props.onLeaderboard(); }
      else if (choice === 'Set name…') promptName();
      else if (choice === 'Leave game') props.onLeave();
      else if (choice === 'New game') { awaitingShare.current = true; props.onNewGame(); }
      else if (choice === 'Join a game') promptJoin();
      else if (choice === 'Sign out') props.onSignOut();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: labels, cancelButtonIndex, destructiveButtonIndex }, handle,
      );
    } else {
      // Minimal fallback for non-iOS: just run the most common action.
      props.onInvite();
    }
  }

  function promptName() {
    if (Platform.OS === 'ios') {
      Alert.prompt('Set name', 'Choose a display name', (text) => {
        const n = (text ?? '').trim();
        if (n) props.onSetName(n);
      }, 'plain-text', state.you || props.name);
    }
  }

  function promptJoin() {
    if (Platform.OS === 'ios') {
      Alert.prompt('Join a game', 'Paste an invite link or code', (text) => {
        const token = parseToken(text ?? '');
        if (token) props.onJoin(token);
        else Alert.alert('That doesn’t look like a valid invite code.');
      });
    }
  }

  const displayName = state.you || props.name;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title={displayName} onMenu={openMenu} />

      {state.notice && (
        <Pressable style={styles.notice} onPress={() => { /* dismissed on next render */ }}>
          <Text style={styles.noticeText}>{state.notice}</Text>
        </Pressable>
      )}

      {state.status === 'playing' && state.role && <StatusHUD state={state} />}

      <View style={styles.body}>
        {state.phase === 'reveal' && state.reveal
          ? <Reveal state={state} onContinue={props.onContinue} />
          : state.status === 'lobby'
            ? <Lobby
                state={state}
                onNewGame={() => { awaitingShare.current = true; props.onNewGame(); }}
                onJoin={promptJoin}
                onRestart={props.onRestart}
                onShare={shareLink}
              />
            : <Thread ref={scrollRef} state={state} onCall={props.onCall} />}
      </View>

      {showCompose(state) && (
        <View style={styles.composeRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            returnKeyType="send"
            placeholder={composePlaceholder(state)}
            placeholderTextColor={C.muted}
            autoFocus={false}
          />
          <Pressable style={[styles.sendBtn, !input.trim() && styles.sendBtnOff]} onPress={submit} disabled={!input.trim()}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      )}

      <LeaderboardModal
        visible={showLeaderboard}
        entries={state.leaderboard}
        onClose={() => setShowLeaderboard(false)}
      />

      <RestartModal
        visible={showRestart}
        roster={state.roster}
        onRestart={(a, b) => { setShowRestart(false); props.onRestart(a, b); }}
        onClose={() => setShowRestart(false)}
      />
    </KeyboardAvoidingView>
  );
}

function showCompose(state: GameState): boolean {
  return state.phase === 'judge-ask' || state.phase === 'judge-decide' || state.phase === 'witness-answer';
}

function composePlaceholder(state: GameState): string {
  if (state.phase === 'witness-answer') return 'Your reply…';
  if (state.phase === 'judge-decide') return 'Ask another question…';
  return 'Ask a question…';
}

function Header({ title, onMenu }: { title: string; onMenu: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <Pressable onPress={onMenu} hitSlop={12}>
        <Text style={styles.headerMenu}>⋯</Text>
      </Pressable>
    </View>
  );
}

function StatusHUD({ state }: { state: GameState }) {
  const s = state.score!;
  const role = state.role === 'judge' ? 'JUDGE' : 'WITNESS';
  return (
    <View style={styles.hud}>
      <View style={styles.hudRow}>
        <Text style={styles.hudRound}>Round {displayRound(state)}</Text>
        <Text style={styles.hudScore}>
          Humans <Text style={styles.hudStrong}>{s.humans}</Text> · AI <Text style={styles.hudStrong}>{s.model}</Text>
          {s.streak > 1 ? `  · 🔥${s.streak}` : ''}
        </Text>
      </View>
      <View style={styles.hudRow}>
        <Text style={styles.hudRole}>
          You are the <Text style={[styles.hudStrong, { color: C.primary }]}>{role}</Text>
          {state.partner ? <Text style={styles.hudVs}>  vs {state.partner}</Text> : null}
        </Text>
        <Text style={styles.hudHint}>{phaseHint(state)}</Text>
      </View>
    </View>
  );
}

const Thread = React.forwardRef<ScrollView, { state: GameState; onCall: (l: Label) => void }>(
  function Thread({ state, onCall }, ref) {
    const callable = state.phase === 'judge-decide';
    const isJudge = state.role === 'judge';
    if (state.exchanges.length === 0) {
      return (
        <View style={styles.waiting}>
          <Text style={styles.waitingBig}>{waitingMessage(state)}</Text>
          {state.partner ? <Text style={styles.waitingSub}>Playing against {state.partner}</Text> : null}
        </View>
      );
    }
    return (
      <ScrollView ref={ref} style={styles.thread} contentContainerStyle={styles.threadContent}>
        {state.exchanges.map((ex, i) => (
          <View key={i} style={styles.exchange}>
            {ex.question ? (
              <View style={[styles.qBubble, isJudge ? styles.qMine : styles.qTheirs]}>
                <Text style={styles.qLabel}>{isJudge ? 'You asked' : 'Judge asks'}</Text>
                <Text style={styles.qText}>{ex.question}</Text>
              </View>
            ) : null}
            {ex.a !== undefined && ex.b !== undefined ? (
              <View style={styles.cardRow}>
                <AnswerCard label="A" text={ex.a!} tint={C.cardA} callable={callable} onPress={() => onCall('A')}
                  badge={witnessBadge(state, ex, 'A')} />
                <AnswerCard label="B" text={ex.b!} tint={C.cardB} callable={callable} onPress={() => onCall('B')}
                  badge={witnessBadge(state, ex, 'B')} />
              </View>
            ) : ex.question && isJudge ? (
              <Text style={styles.pending}>…waiting for the reply</Text>
            ) : null}
          </View>
        ))}
        {callable && <Text style={styles.callHint}>Tap the column you believe is the real human.</Text>}
      </ScrollView>
    );
  },
);

// For the witness, mark which card was them vs the AI's imitation.
function witnessBadge(state: GameState, ex: { yourLabel?: Label; modelLabel?: Label }, label: Label): string | null {
  if (state.role !== 'witness') return null;
  if (ex.yourLabel === label) return 'you';
  if (ex.modelLabel === label) return 'the AI';
  return null;
}

function AnswerCard({ label, text, tint, callable, onPress, badge }: {
  label: Label; text: string; tint: string; callable: boolean; onPress: () => void; badge: string | null;
}) {
  const inner = (
    <View style={[styles.card, { backgroundColor: tint }, callable && styles.cardCallable]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel}>{label}</Text>
        {badge && <Text style={styles.cardBadge}>{badge}</Text>}
      </View>
      <Text style={styles.cardText}>{text}</Text>
      {callable && <Text style={styles.cardCall}>Call human</Text>}
    </View>
  );
  return callable ? <Pressable style={styles.cardWrap} onPress={onPress}>{inner}</Pressable> : <View style={styles.cardWrap}>{inner}</View>;
}

function Reveal({ state, onContinue }: { state: GameState; onContinue: () => void }) {
  const r = state.reveal!;
  const caller = r.self ? 'You called' : 'Your partner called';
  const next = r.nextRole === 'judge' ? "You're the judge next" : "You're the witness next";
  return (
    <View style={styles.revealWrap}>
      <Text style={[styles.revealVerdict, { color: r.correct ? C.good : C.bad }]}>
        {r.correct ? 'Correct' : 'Wrong'}
      </Text>
      <Text style={styles.revealSub}>{caller} {r.call} · {r.humanLabel} was the human</Text>

      <View style={styles.revealCards}>
        <RevealCard label="A" text={r.aText} human={r.humanLabel === 'A'} />
        <RevealCard label="B" text={r.bText} human={r.humanLabel === 'B'} />
      </View>

      {state.score && (
        <Text style={styles.revealScore}>
          Humans {state.score.humans} · AI {state.score.model}
          {state.score.streak > 1 ? `  · 🔥${state.score.streak}` : ''}
        </Text>
      )}

      <Pressable style={styles.continueBtn} onPress={onContinue}>
        <Text style={styles.continueText}>{next}  →</Text>
      </Pressable>
    </View>
  );
}

function RevealCard({ label, text, human }: { label: Label; text: string; human: boolean }) {
  return (
    <View style={[styles.revealCard, human ? styles.revealHuman : styles.revealModel]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={[styles.cardBadge, { color: human ? C.good : C.muted }]}>{human ? 'human' : 'AI'}</Text>
      </View>
      <Text style={styles.cardText}>{text}</Text>
    </View>
  );
}

function Lobby({ state, onNewGame, onJoin, onRestart, onShare }: {
  state: GameState; onNewGame: () => void; onJoin: () => void; onRestart: (a: string, b: string) => void; onShare: (l: string) => void;
}) {
  const inSession = state.roster.length > 0;
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(name: string) {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(n => n !== name)
      : prev.length < 2 ? [...prev, name]
      : [prev[1], name],   // already two picked → drop the oldest, keep order
    );
  }

  // In a session that's waiting for players: tap two people, then start.
  if (inSession && state.waiting) {
    return (
      <View style={styles.lobby}>
        <Text style={styles.lobbyTitle}>Waiting for players</Text>
        <Text style={styles.lobbyBlurb}>Tap two people to play. The first pick judges first; the rest watch.</Text>
        <View style={styles.roster}>
          {state.roster.map((r, i) => {
            const pick = selected.indexOf(r.name);
            return (
              <Pressable key={i} style={[styles.rosterRow, pick >= 0 && styles.rosterRowSel]} onPress={() => toggle(r.name)}>
                <Text style={styles.rosterName}>{r.name}</Text>
                {pick >= 0
                  ? <Text style={styles.rosterPick}>{pick === 0 ? 'Player 1' : 'Player 2'}</Text>
                  : <Text style={styles.rosterTag}>{r.seated ? 'player' : 'watching'}</Text>}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          style={[styles.primaryBtn, selected.length !== 2 && styles.primaryBtnOff]}
          disabled={selected.length !== 2}
          onPress={() => onRestart(selected[0], selected[1])}
        >
          <Text style={styles.primaryText}>{selected.length === 2 ? 'Start a game' : 'Pick two players'}</Text>
        </Pressable>
        {state.inviteLink && (
          <Pressable style={styles.secondaryBtn} onPress={() => onShare(state.inviteLink!)}>
            <Text style={styles.secondaryText}>Invite more</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.lobby}>
      <Text style={styles.lobbyTitle}>The Imitation Game</Text>
      <Text style={styles.lobbyBlurb}>
        Two of you play against an AI that tries to impersonate whoever is answering. Start a game and invite a friend.
      </Text>
      {state.inviteLink ? (
        <>
          <Text style={styles.lobbyWaiting}>Waiting for someone to join…</Text>
          <Pressable style={styles.primaryBtn} onPress={() => onShare(state.inviteLink!)}>
            <Text style={styles.primaryText}>Share invite</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={styles.primaryBtn} onPress={onNewGame}>
            <Text style={styles.primaryText}>New game</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={onJoin}>
            <Text style={styles.secondaryText}>Join a game</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function LeaderboardModal({ visible, entries, onClose }: {
  visible: boolean; entries: GameState['leaderboard']; onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle}>Leaderboard</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={styles.modalClose}>Done</Text></Pressable>
        </View>
        <ScrollView>
          {(entries ?? []).map((e) => (
            <View key={e.rank} style={styles.lbRow}>
              <Text style={styles.lbRank}>{e.rank}</Text>
              <Text style={styles.lbName} numberOfLines={1}>{e.name}</Text>
              <Text style={styles.lbStat}>{e.wins}W · {e.losses}L · {e.pct}%</Text>
              <Text style={styles.lbStreak}>🔥{e.bestStreak}</Text>
            </View>
          ))}
          {(!entries || entries.length === 0) && (
            <Text style={styles.lbEmpty}>No games recorded yet.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function RestartModal({ visible, roster, onRestart, onClose }: {
  visible: boolean;
  roster: GameState['roster'];
  onRestart: (a: string, b: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(name: string) {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(n => n !== name)
      : prev.length < 2 ? [...prev, name]
      : [prev[1], name],
    );
  }

  function handleClose() {
    setSelected([]);
    onClose();
  }

  function handleStart() {
    if (selected.length === 2) {
      setSelected([]);
      onRestart(selected[0], selected[1]);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.modal}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle}>New players</Text>
          <Pressable onPress={handleClose} hitSlop={12}><Text style={styles.modalClose}>Cancel</Text></Pressable>
        </View>
        <View style={styles.restartBody}>
          <Text style={styles.restartBlurb}>Tap two people to play. The first pick judges first.</Text>
          <View style={styles.roster}>
            {roster.map((r, i) => {
              const pick = selected.indexOf(r.name);
              return (
                <Pressable key={i} style={[styles.rosterRow, pick >= 0 && styles.rosterRowSel]} onPress={() => toggle(r.name)}>
                  <Text style={styles.rosterName}>{r.name}</Text>
                  {pick >= 0
                    ? <Text style={styles.rosterPick}>{pick === 0 ? 'Player 1' : 'Player 2'}</Text>
                    : <Text style={styles.rosterTag}>{r.seated ? 'player' : 'watching'}</Text>}
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[styles.primaryBtn, selected.length !== 2 && styles.primaryBtnOff]}
            disabled={selected.length !== 2}
            onPress={handleStart}
          >
            <Text style={styles.primaryText}>{selected.length === 2 ? 'Start game' : 'Pick two players'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg, paddingTop: 56 },

  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  headerTitle:  { fontSize: 17, fontWeight: '600', color: C.text, flex: 1 },
  headerMenu:   { fontSize: 24, color: C.primary, paddingHorizontal: 6 },

  notice:       { backgroundColor: '#fff3cd', marginHorizontal: 12, borderRadius: 10, padding: 10, marginBottom: 6 },
  noticeText:   { color: '#664d03', fontSize: 13 },

  hud:          { backgroundColor: C.card, marginHorizontal: 12, borderRadius: 12, padding: 12, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  hudRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hudRound:     { fontSize: 13, fontWeight: '600', color: C.muted },
  hudScore:     { fontSize: 13, color: C.muted },
  hudStrong:    { fontWeight: '700', color: C.text },
  hudRole:      { fontSize: 15, color: C.text },
  hudVs:        { fontSize: 13, color: C.muted },
  hudHint:      { fontSize: 13, color: C.muted, flexShrink: 1, textAlign: 'right', marginLeft: 8 },

  body:         { flex: 1 },

  thread:        { flex: 1 },
  threadContent: { padding: 12, gap: 12 },
  waiting:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  waitingBig:    { fontSize: 18, color: C.text, textAlign: 'center', lineHeight: 25 },
  waitingSub:    { fontSize: 14, color: C.muted },
  exchange:      { gap: 8 },
  qBubble:       { borderRadius: 12, padding: 10, maxWidth: '85%' },
  qMine:         { backgroundColor: '#dCe7ff', alignSelf: 'flex-end' },
  qTheirs:       { backgroundColor: C.card, alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  qLabel:        { fontSize: 11, color: C.muted, marginBottom: 2 },
  qText:         { fontSize: 16, color: C.text },
  pending:       { fontSize: 13, color: C.muted, fontStyle: 'italic', alignSelf: 'flex-start' },

  cardRow:       { flexDirection: 'row', gap: 8 },
  cardWrap:      { flex: 1 },
  card:          { borderRadius: 12, padding: 12, minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  cardCallable:  { borderColor: C.primary, borderWidth: 1.5 },
  cardHead:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardLabel:     { fontSize: 13, fontWeight: '700', color: C.muted },
  cardBadge:     { fontSize: 11, color: C.muted },
  cardText:      { fontSize: 15, color: C.text },
  cardCall:      { fontSize: 12, color: C.primary, fontWeight: '600', marginTop: 8 },
  callHint:      { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 4 },

  revealWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  revealVerdict: { fontSize: 40, fontWeight: '800' },
  revealSub:     { fontSize: 15, color: C.text },
  revealCards:   { flexDirection: 'row', gap: 10, marginVertical: 8 },
  revealCard:    { flex: 1, borderRadius: 12, padding: 12, minHeight: 80, borderWidth: 1.5 },
  revealHuman:   { borderColor: C.good, backgroundColor: '#eefaf0' },
  revealModel:   { borderColor: C.border, backgroundColor: C.card },
  revealScore:   { fontSize: 15, color: C.muted, marginTop: 4 },
  continueBtn:   { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 12 },
  continueText:  { color: '#fff', fontSize: 16, fontWeight: '600' },

  lobby:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  lobbyTitle:   { fontSize: 26, fontWeight: '800', color: C.text },
  lobbyBlurb:   { fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 21 },
  lobbyWaiting: { fontSize: 15, color: C.text, marginTop: 8 },
  primaryBtn:   { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 6 },
  primaryBtnOff:{ backgroundColor: '#b9d6ff' },
  primaryText:  { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 32 },
  secondaryText:{ color: C.primary, fontSize: 16, fontWeight: '600' },
  roster:       { alignSelf: 'stretch', gap: 6, marginVertical: 8 },
  rosterRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  rosterRowSel: { borderColor: C.primary, backgroundColor: C.cardA },
  rosterName:   { fontSize: 16, color: C.text },
  rosterTag:    { fontSize: 12, color: C.muted },
  rosterPick:   { fontSize: 13, color: C.primary, fontWeight: '700' },

  composeRow:   { flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center', backgroundColor: C.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  input:        { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: C.bg, color: C.text },
  sendBtn:      { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtnOff:   { backgroundColor: '#b9d6ff' },
  sendText:     { color: '#fff', fontSize: 15, fontWeight: '600' },

  modal:        { flex: 1, backgroundColor: C.bg, paddingTop: 16 },
  modalHead:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  modalTitle:   { fontSize: 20, fontWeight: '700', color: C.text },
  modalClose:   { fontSize: 16, color: C.primary },
  lbRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10, backgroundColor: C.card, marginHorizontal: 12, marginBottom: 6, borderRadius: 10 },
  lbRank:       { fontSize: 15, fontWeight: '700', color: C.muted, width: 22 },
  lbName:       { fontSize: 15, color: C.text, flex: 1 },
  lbStat:       { fontSize: 13, color: C.muted },
  lbStreak:     { fontSize: 13, color: C.muted },
  lbEmpty:      { textAlign: 'center', color: C.muted, marginTop: 24 },

  restartBody:  { flex: 1, padding: 20, gap: 12 },
  restartBlurb: { fontSize: 15, color: C.muted, lineHeight: 21 },
});
