import { Telegraf } from 'telegraf';
import { GameSession, MessagePair, UserId } from './types';

async function sendToSpectators(bot: Telegraf, session: GameSession, text: string): Promise<void> {
  const blocked: UserId[] = [];
  await Promise.all(
    session.spectators.map(async (id: UserId) => {
      try {
        await bot.telegram.sendMessage(id, text);
      } catch (err: any) {
        if (err?.response?.error_code === 403) {
          blocked.push(id);
        } else {
          throw err;
        }
      }
    })
  );
  if (blocked.length > 0) {
    session.spectators = session.spectators.filter(id => !blocked.includes(id));
  }
}

export async function deliverToSender(
  bot: Telegraf,
  senderId: number,
  text: string,
  prediction: string
): Promise<void> {
  await bot.telegram.sendMessage(senderId, `You: ${text}`);
  await bot.telegram.sendMessage(senderId, `Model: ${prediction}`);
}

export async function deliverToReceiver(
  bot: Telegraf,
  receiverId: number,
  pair: MessagePair,
  imitationFirst: boolean
): Promise<void> {
  const [msgA, msgB] = imitationFirst
    ? [pair.prediction, pair.human]
    : [pair.human, pair.prediction];

  await bot.telegram.sendMessage(receiverId, `A: ${msgA}`);
  await bot.telegram.sendMessage(receiverId, `B: ${msgB}`);
}

export async function deliverToSpectators(
  bot: Telegraf,
  session: GameSession,
  senderLabel: string,
  human: string,
  prediction: string
): Promise<void> {
  if (session.spectators.length === 0) return;
  const text = `${senderLabel}: ${human}\n${senderLabel} (imitation): ${prediction}`;
  await sendToSpectators(bot, session, text);
}

export async function deliverRoundResultToSpectators(
  bot: Telegraf,
  session: GameSession,
  guesserLabel: string,
  correct: boolean,
  reveal: string,
  scores: { user1: number; user2: number },
  teamScores?: { humans: number; model: number }
): Promise<void> {
  if (session.spectators.length === 0) return;
  const verdict = correct ? 'correctly' : 'incorrectly';
  const scoreStr = teamScores
    ? `Humans: ${teamScores.humans} | Model: ${teamScores.model}`
    : `User 1: ${scores.user1} | User 2: ${scores.user2}`;
  const text =
    `${guesserLabel} guessed ${verdict}. ${reveal}\n` +
    `Score — ${scoreStr}\n\n` +
    `Use /leave to stop watching.`;
  await sendToSpectators(bot, session, text);
}

export async function deliverReveal(bot: Telegraf, session: GameSession): Promise<void> {
  const reveal = session.imitationFirst
    ? 'A was always the AI. B was always human.'
    : 'A was always human. B was always the AI.';

  await bot.telegram.sendMessage(session.user1, reveal);
  await bot.telegram.sendMessage(session.user2, reveal);
}
