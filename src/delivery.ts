import { Transport } from './transport';
import { GameSession, MessagePair, UserId } from './types';

async function sendToSpectators(transport: Transport, session: GameSession, text: string): Promise<void> {
  const failed: UserId[] = [];
  await Promise.all(
    session.spectators.map(async (id: UserId) => {
      try {
        await transport.send(id, text);
      } catch {
        failed.push(id);
      }
    })
  );
  if (failed.length > 0) {
    session.spectators = session.spectators.filter(id => !failed.includes(id));
  }
}

export async function deliverToSender(
  transport: Transport,
  senderId: UserId,
  text: string,
  prediction: string,
): Promise<void> {
  await transport.send(senderId, `You: ${text}`);
  await transport.send(senderId, `Model: ${prediction}`);
}

export async function deliverToReceiver(
  transport: Transport,
  receiverId: UserId,
  pair: MessagePair,
  imitationFirst: boolean,
): Promise<void> {
  const [msgA, msgB] = imitationFirst
    ? [pair.prediction, pair.human]
    : [pair.human, pair.prediction];

  await transport.send(receiverId, `A: ${msgA}`);
  await transport.send(receiverId, `B: ${msgB}`);
}

export async function deliverToSpectators(
  transport: Transport,
  session: GameSession,
  senderLabel: string,
  human: string,
  prediction: string,
): Promise<void> {
  if (session.spectators.length === 0) return;
  const text = `${senderLabel}: ${human}\n${senderLabel} (imitation): ${prediction}`;
  await sendToSpectators(transport, session, text);
}

export async function deliverRoundResultToSpectators(
  transport: Transport,
  session: GameSession,
  callerLabel: string,
  correct: boolean,
  reveal: string,
  scoreStr: string,
): Promise<void> {
  if (session.spectators.length === 0) return;
  const verdict = correct ? 'correctly' : 'incorrectly';
  const text =
    `${callerLabel} called ${verdict}. ${reveal}\n` +
    `Score — ${scoreStr}\n\n` +
    `Use /leave to stop watching.`;
  await sendToSpectators(transport, session, text);
}

export async function deliverReveal(transport: Transport, session: GameSession): Promise<void> {
  const reveal = session.imitationFirst
    ? 'A was always the AI. B was always human.'
    : 'A was always human. B was always the AI.';
  const players = [session.user1, session.user2].filter((id): id is UserId => id !== null);
  await Promise.all(players.map(id => transport.send(id, reveal)));
}
