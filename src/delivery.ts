import { Telegraf } from 'telegraf';
import { GameSession, MessagePair } from './types';

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

export async function deliverReveal(bot: Telegraf, session: GameSession): Promise<void> {
  const reveal = session.imitationFirst
    ? 'A was always the AI. B was always human.'
    : 'A was always human. B was always the AI.';

  await bot.telegram.sendMessage(session.user1, reveal);
  await bot.telegram.sendMessage(session.user2, reveal);
}
